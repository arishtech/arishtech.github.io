import { state } from "./state.js";
import { STALL_WATCHDOG_MS, STALL_WATCHDOG_BOOT_DEFER_MAX, CUSTOM_PLAYER_STUB_URL } from "./constants.js";
import { asObject, readSenderCandidateIndex, serializeReceiverError } from "./util.js";
import { debugLog, applyDebugConfigFromContract } from "./logger.js";
import { setStatus, showLoader, hideLoader, setBrandingVisible, updateCastChannelNameUi, safeAddPlayerEventListener } from "./dom.js";
import { normalizeContract } from "./contract.js";
import {
  normalizeCandidateUrl,
  buildCompatibilityCandidates,
  getPlaybackStrategy,
  isLikelyLiveStream,
  auditNetworkEnvironment,
  pickInitialUaIndex,
} from "./url.js";
import { createPlaybackConfig, ensureShakaRequestFilters, rotateIptvUserAgent } from "./network.js";
import {
  destroyHls,
  destroyDash,
  destroyMpegts,
  clearCustomPlayer,
  prepareLoadForCandidate,
  prepareCustomPlayerStubLoad,
  mpegtsIsAvailable,
  startMpegtsPlayback,
  startHlsJsPlayback,
  startDashJsPlayback,
  handleCustomInterceptorFailure,
} from "./players.js";

export function clearStallWatchdog() {
  if (state.stallWatchdogTimer) {
    clearTimeout(state.stallWatchdogTimer);
    state.stallWatchdogTimer = null;
  }
}

export function armStallWatchdog(source) {
  clearStallWatchdog();
  const serial = ++state.stallWatchdogSerial;
  state.stallWatchdogTimer = setTimeout(() => {
    if (serial !== state.stallWatchdogSerial) return;
    if (state.candidatesExhausted) return;
    const castVideoEl = document.getElementById("castVideo");
    if (state.pendingCustomPlayerBoot) {
      state.stallWatchdogBootDeferCount += 1;
      if (state.stallWatchdogBootDeferCount >= STALL_WATCHDOG_BOOT_DEFER_MAX) {
        state.stallWatchdogBootDeferCount = 0;
        debugLog("candidate.watchdog.boot_cap", {
          source,
          pendingCustomPlayerBoot: state.pendingCustomPlayerBoot,
          index: state.activeCandidateIndex,
          defers: STALL_WATCHDOG_BOOT_DEFER_MAX,
        });
        destroyHls();
        destroyDash();
        destroyMpegts();
        clearCustomPlayer();
        state.pendingCustomPlayerBoot = null;
        void tryLoadNextCandidateOnReceiverError("watchdog_js_boot_cap");
        return;
      }
      debugLog("candidate.watchdog.deferred_boot", {
        source,
        pendingCustomPlayerBoot: state.pendingCustomPlayerBoot,
        index: state.activeCandidateIndex,
        bootDeferCount: state.stallWatchdogBootDeferCount,
      });
      armStallWatchdog("js_boot_defer");
      return;
    }
    state.stallWatchdogBootDeferCount = 0;
    if (state.activeCustomPlayer && castVideoEl && (!castVideoEl.paused || castVideoEl.readyState >= 3)) return;
    debugLog("candidate.watchdog", { source, index: state.activeCandidateIndex });
    void tryLoadNextCandidateOnReceiverError("watchdog");
  }, STALL_WATCHDOG_MS);
}

export function markCandidatesExhausted(reason) {
  if (state.candidatesExhausted) return;
  state.candidatesExhausted = true;
  hideLoader();
  setBrandingVisible(true);
  updateCastChannelNameUi("");
  setStatus("All receiver fallback candidates exhausted");
  debugLog("candidate.exhausted", { reason, activeCandidateIndex: state.activeCandidateIndex, candidateCount: state.activeCandidates.length });
}

export async function tryLoadNextCandidateOnReceiverError(reason) {
  clearStallWatchdog();
  state.stallWatchdogBootDeferCount = 0;
  destroyHls();
  destroyDash();
  destroyMpegts();
  clearCustomPlayer();

  if (!state.lastLoadTemplate || state.candidatesExhausted) return;

  async function attemptReceiverCandidateLoad(url, index, sourceTag) {
    const load = prepareLoadForCandidate(state.lastLoadTemplate, url, index);
    const isRewind = sourceTag === "rewind";
    const label = isRewind
      ? `Trying earlier format (${index + 1}/${state.activeCandidates.length})…`
      : `Retrying ${index + 1}/${state.activeCandidates.length}…`;
    showLoader(label);
    setStatus(label);
    debugLog(isRewind ? "candidate.rewind" : "candidate.retry", {
      reason,
      nextIndex: index,
      nextUrl: url,
      strategy: getPlaybackStrategy(url),
    });
    armStallWatchdog(isRewind ? "candidate.rewind" : "candidate.retry");
    const req = state.playerManager.load(load);
    if (req && typeof req.then === "function") await req;
  }

  if (state.activeCandidateIndex >= state.activeCandidates.length - 1) {
    if (!state.receiverBackwardFallbackUsed && state.loadSessionPreferredStartIndex > 0 && state.activeCandidates.length > 1) {
      state.receiverBackwardFallbackUsed = true;
      state.activeCandidateIndex = 0;
      rotateIptvUserAgent("candidate_rewind");
      try {
        await attemptReceiverCandidateLoad(state.activeCandidates[0], 0, "rewind");
      } catch (_e) {
        markCandidatesExhausted("candidate_rewind_failed");
      }
      return;
    }
    markCandidatesExhausted(reason);
    return;
  }

  state.activeCandidateIndex += 1;
  rotateIptvUserAgent("candidate_retry");
  const nextUrl = state.activeCandidates[state.activeCandidateIndex];
  try {
    await attemptReceiverCandidateLoad(nextUrl, state.activeCandidateIndex, "forward");
  } catch (e) {
    setStatus(`Receiver retry failed: ${serializeReceiverError(e)}`);
    if (state.activeCandidateIndex >= state.activeCandidates.length - 1) markCandidatesExhausted("candidate_retry_failed");
  }
}

export async function advanceCandidateAfterCustomFailure(reason) {
  if (state.candidateAdvanceInFlight || state.candidatesExhausted) return false;
  state.candidateAdvanceInFlight = true;
  state.pendingCustomPlayerBoot = null;
  try {
    if (state.activeCandidateIndex >= state.activeCandidates.length - 1) {
      markCandidatesExhausted(reason);
      return false;
    }
    await tryLoadNextCandidateOnReceiverError(reason);
    return true;
  } finally {
    state.candidateAdvanceInFlight = false;
  }
}

function makeFailureHandler(stubLoad, selectedUrl) {
  return (playerType, err) =>
    void handleCustomInterceptorFailure(playerType, err, stubLoad, selectedUrl, advanceCandidateAfterCustomFailure);
}

export function installCastPipeline() {
  const cast = window.cast;
  if (!state.playerManager) return;

  state.playerManager.setMessageInterceptor(cast.framework.messages.MessageType.LOAD, (loadRequestData) => {
    try {
      const media = loadRequestData.media || {};
      const customData = asObject(loadRequestData.customData);
      const streamFromCustom = String(customData.streamUrl || "").trim();
      const rawBaseUrl = String(
        customData._retryBaseUrl || media.contentUrl || media.contentId || streamFromCustom || ""
      );
      if (!rawBaseUrl) {
        debugLog("load.rejected_empty_url", { hasCustomData: Object.keys(customData).length > 0 });
        return loadRequestData;
      }

      const baseUrl = normalizeCandidateUrl(rawBaseUrl);
      state.activeContract = normalizeContract(customData);
      state.activeContract.channelName = String(customData.channelName || state.activeContract.channelName || "");
      applyDebugConfigFromContract(state.activeContract, customData);
      updateCastChannelNameUi(state.activeContract.channelName);

      showLoader("Loading stream…");
      state.stallWatchdogBootDeferCount = 0;
      state.candidatesExhausted = false;
      state.receiverBackwardFallbackUsed = false;
      state.activeIptvUaIndex = pickInitialUaIndex(baseUrl);

      debugLog("load.received", {
        mediaContentUrl: baseUrl,
        preferReceiverEngine: state.activeContract.playback && state.activeContract.playback.preferReceiverEngine,
        audit: auditNetworkEnvironment(baseUrl),
      });

      if (state.playerManager && typeof state.playerManager.setPlaybackConfig === "function") {
        state.playerManager.setPlaybackConfig(createPlaybackConfig());
      }
      ensureShakaRequestFilters();

      state.activeCandidates = buildCompatibilityCandidates(baseUrl, customData).map((c) => normalizeCandidateUrl(c));
      if (state.activeCandidates.length === 0) state.activeCandidates = [baseUrl];

      if (customData._retryCandidateIndex != null) {
        const ri = readSenderCandidateIndex(customData._retryCandidateIndex);
        state.activeCandidateIndex =
          ri != null ? Math.max(0, Math.min(ri, state.activeCandidates.length - 1)) : 0;
      } else {
        const normalizedBase = normalizeCandidateUrl(baseUrl);
        const matchIdx = state.activeCandidates.findIndex((c) => normalizeCandidateUrl(c) === normalizedBase);
        if (matchIdx >= 0) state.activeCandidateIndex = matchIdx;
        else {
          const ci = readSenderCandidateIndex(customData.candidateIndex);
          state.activeCandidateIndex =
            ci != null ? Math.max(0, Math.min(ci, state.activeCandidates.length - 1)) : 0;
        }
      }
      state.loadSessionPreferredStartIndex = state.activeCandidateIndex;

      const selectedUrl = normalizeCandidateUrl(state.activeCandidates[state.activeCandidateIndex] || baseUrl);
      state.activeCandidates[state.activeCandidateIndex] = selectedUrl;
      const selectedLoad = prepareLoadForCandidate(loadRequestData, selectedUrl);
      if ((selectedUrl || "").toLowerCase().includes("/live.php") || isLikelyLiveStream(selectedUrl)) {
        selectedLoad.media.streamType = cast.framework.messages.StreamType.LIVE;
      }
      selectedLoad.customData = Object.assign({}, asObject(selectedLoad.customData), { _retryBaseUrl: baseUrl });
      state.lastLoadTemplate = loadRequestData;

      let strategy = getPlaybackStrategy(selectedUrl);
      if (strategy === "caf-ts" && mpegtsIsAvailable()) {
        strategy = "mpegts";
        debugLog("load.strategy.ts_use_mpegts", { selectedUrl });
      }
      debugLog("load.candidates", {
        selectedIndex: state.activeCandidateIndex,
        selectedUrl,
        candidateCount: state.activeCandidates.length,
        strategy,
      });

      const hooks = {
        clearStallWatchdog,
        armStallWatchdog,
        onFatal: () => {},
      };

      if (strategy === "caf-ts") {
        destroyHls();
        destroyDash();
        destroyMpegts();
        clearCustomPlayer();
        selectedLoad.media.contentId = selectedUrl;
        selectedLoad.media.contentUrl = selectedUrl;
        selectedLoad.media.contentType = "video/mp2t";
        selectedLoad.media.streamType = cast.framework.messages.StreamType.LIVE;
        armStallWatchdog("caf-ts");
        return selectedLoad;
      }

      if (strategy === "mpegts") {
        const stubLoad = prepareCustomPlayerStubLoad(selectedLoad, selectedUrl, "mpegts");
        void startMpegtsPlayback(selectedUrl, stubLoad, hooks).catch((err) => {
          void handleCustomInterceptorFailure("mpegts", err, stubLoad, selectedUrl, advanceCandidateAfterCustomFailure);
        });
        return stubLoad;
      }

      if (strategy === "hlsjs") {
        const stubLoad = prepareCustomPlayerStubLoad(selectedLoad, selectedUrl, "hlsjs");
        void startHlsJsPlayback(selectedUrl, stubLoad, hooks).catch((err) => {
          void handleCustomInterceptorFailure("hlsjs", err, stubLoad, selectedUrl, advanceCandidateAfterCustomFailure);
        });
        return stubLoad;
      }

      if (strategy === "dashjs") {
        const stubLoad = prepareCustomPlayerStubLoad(selectedLoad, selectedUrl, "dashjs");
        hooks.onFatal = (err) => {
          void handleCustomInterceptorFailure("dashjs", err, stubLoad, selectedUrl, advanceCandidateAfterCustomFailure);
        };
        void startDashJsPlayback(selectedUrl, stubLoad, hooks).then((fin) => {
          if (fin && fin.media && fin.media.contentUrl === CUSTOM_PLAYER_STUB_URL) {
            void state.playerManager.load(fin).catch((e) => debugLog("dashjs.load.error", { message: serializeReceiverError(e) }));
          }
        });
        return stubLoad;
      }

      if (strategy === "caf-hls") {
        destroyHls();
        destroyDash();
        destroyMpegts();
        clearCustomPlayer();
        armStallWatchdog("caf-hls");
        return selectedLoad;
      }

      destroyHls();
      destroyDash();
      destroyMpegts();
      clearCustomPlayer();
      armStallWatchdog("native");
      return selectedLoad;
    } catch (e) {
      setStatus(`LOAD interceptor error: ${e && e.message ? e.message : "unknown"}`);
      debugLog("load.interceptor.error", { message: e && e.message ? e.message : "unknown" });
      return loadRequestData;
    }
  });

  safeAddPlayerEventListener(cast.framework.events.EventType.ERROR, (event) => {
    const detailCode = event && event.detailedErrorCode ? event.detailedErrorCode : "";
    const errorCode = Number(detailCode) || 0;
    if (state.candidatesExhausted || state.candidateAdvanceInFlight) return;
    if (state.pendingCustomPlayerBoot) {
      debugLog("player.error.suppressed_pending_boot", {
        errorCode,
        pendingCustomPlayerBoot: state.pendingCustomPlayerBoot,
        reason: event && event.reason ? String(event.reason) : "",
      });
      return;
    }
    if (state.activeCustomPlayer && (errorCode === 905 || errorCode === 104 || errorCode === 301 || errorCode === 101)) {
      debugLog("player.error.suppressed_custom", { errorCode, activeCustomPlayer: state.activeCustomPlayer });
      return;
    }
    debugLog("player.error", { errorCode, reason: event && event.reason ? event.reason : "" });
    void tryLoadNextCandidateOnReceiverError("player_error_" + errorCode);
  }, "ERROR");
}

export function registerUnhandledRejection() {
  window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev && ev.reason;
    const message = reason && reason.message ? reason.message : String(reason || "unknown");
    debugLog("receiver.unhandledrejection", { reason: message });
    if (message === "HttpStatusCodeInvalid" || message.includes("HttpStatusCodeInvalid")) {
      if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
    }
  });
}
