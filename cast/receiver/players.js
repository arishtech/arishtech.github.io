/* global Hls, dashjs, mpegts */
import { state } from "./state.js";
import { CUSTOM_PLAYER_STUB_URL, HLS_BOOT_TIMEOUT_MS, MPEGTS_BOOT_WALL_MS, IPTV_USER_AGENTS } from "./constants.js";
import { serializeReceiverError, isPlayInterruptedError, asObject } from "./util.js";
import { debugLog } from "./logger.js";
import { getCastVideoEl, setStatus, onPlaybackStartedUi } from "./dom.js";
import {
  resolveFetchUrl,
  applyNetworkPolicy,
  classifyHlsRequestType,
  rotateIptvUserAgent,
  installIptvNetworkShim,
  removeIptvNetworkShim,
  buildIptvRequestHeaders,
} from "./network.js";
import { normalizeCandidateUrl, inferContentType, isHlsCandidate, isTsCandidate } from "./url.js";

function stopPlaybackKeepalive() {}

export function destroyHls() {
  if (state.hlsInstance) {
    try {
      state.hlsInstance.destroy();
    } catch (_e) {}
    state.hlsInstance = null;
  }
}

export function destroyDash() {
  if (state.dashInstance) {
    try {
      state.dashInstance.off(dashjs.MediaPlayer.events.ERROR);
    } catch (_e) {}
    try {
      state.dashInstance.reset();
    } catch (_e) {}
    state.dashInstance = null;
  }
}

export function destroyMpegts() {
  removeIptvNetworkShim();
  if (state.mpegtsInstance) {
    try {
      state.mpegtsInstance.off(mpegts.Events.ERROR);
    } catch (_e) {}
    try {
      state.mpegtsInstance.pause();
    } catch (_e) {}
    try {
      state.mpegtsInstance.unload();
    } catch (_e) {}
    try {
      state.mpegtsInstance.detachMediaElement();
    } catch (_e) {}
    try {
      state.mpegtsInstance.destroy();
    } catch (_e) {}
    state.mpegtsInstance = null;
  }
}

export function clearCustomPlayer() {
  state.activeCustomPlayer = null;
  state.activeCustomPlayerUrl = "";
  stopPlaybackKeepalive();
}

export function readVideoBlobUrl() {
  const castVideoEl = getCastVideoEl();
  if (!castVideoEl) return "";
  const mediaSrc = castVideoEl.currentSrc || castVideoEl.src || "";
  return mediaSrc.startsWith("blob:") ? mediaSrc : "";
}

export function buildMpegtsPlayerConfig() {
  return {
    enableWorker: false,
    lazyLoad: false,
    enableStashBuffer: true,
    stashInitialSize: 2048 * 1024,
    liveBufferLatencyChasing: true,
    liveBufferLatencyMaxLatency: 5,
    liveBufferLatencyMinRemain: 0.8,
    liveSync: true,
    liveSyncMaxLatency: 5,
    liveSyncTargetLatency: 2.5,
    autoCleanupSourceBuffer: true,
    fixAudioTimestampGap: true,
  };
}

export function buildHlsJsConfig() {
  return {
    enableWorker: false,
    lowLatencyMode: false,
    manifestLoadingTimeOut: 28000,
    fragLoadingTimeOut: 28000,
    maxBufferLength: 45,
    liveSyncDurationCount: 3,
    xhrSetup(xhr, requestUrl) {
      const info = { url: String(requestUrl || ""), headers: {} };
      applyNetworkPolicy(info, classifyHlsRequestType(info.url));
      const h = /** @type {Record<string, string>} */ (info.headers || {});
      Object.keys(h).forEach((k) => {
        try {
          xhr.setRequestHeader(k, h[k]);
        } catch (_e) {}
      });
    },
  };
}

export function hlsIsAvailable() {
  const castVideoEl = getCastVideoEl();
  return castVideoEl && typeof Hls !== "undefined" && Hls.isSupported();
}

export function dashIsAvailable() {
  const castVideoEl = getCastVideoEl();
  return castVideoEl && typeof dashjs !== "undefined";
}

export function mpegtsIsAvailable() {
  const castVideoEl = getCastVideoEl();
  return castVideoEl && typeof mpegts !== "undefined" && mpegts.isSupported();
}

/**
 * @param {unknown} loadRequestData
 * @param {string} candidateUrl
 * @param {number} [retryIndex]
 */
export function prepareLoadForCandidate(loadRequestData, candidateUrl, retryIndex) {
  const cloned = Object.assign({}, loadRequestData);
  cloned.media = Object.assign({}, asObject(loadRequestData && loadRequestData.media));
  const cd = asObject(loadRequestData && loadRequestData.customData);
  const streamReq = asObject(cd.streamRequest);
  const srUrl = normalizeCandidateUrl(String(streamReq.url || "").trim());
  const normalizedCandidate = normalizeCandidateUrl(candidateUrl);
  const srCt = String(streamReq.contentType || "").trim();
  const contentType =
    srUrl && normalizedCandidate === srUrl && srCt ? srCt : inferContentType(candidateUrl);
  cloned.media.contentId = candidateUrl;
  cloned.media.contentUrl = candidateUrl;
  cloned.media.contentType = contentType;
  if (retryIndex !== undefined) {
    const originalCustomData = asObject(loadRequestData && loadRequestData.customData);
    const originalMedia = asObject(loadRequestData && loadRequestData.media);
    const originalBaseUrl = String(
      originalCustomData._retryBaseUrl || originalMedia.contentUrl || originalMedia.contentId || ""
    );
    cloned.customData = Object.assign({}, originalCustomData, {
      _retryBaseUrl: originalBaseUrl,
      _retryCandidateIndex: retryIndex,
      candidateIndex: retryIndex,
    });
  }
  return cloned;
}

export function prepareCustomPlayerStubLoad(selectedLoad, sourceUrl, playerType) {
  const cast = window.cast;
  const stub = Object.assign({}, selectedLoad);
  stub.media = Object.assign({}, asObject(selectedLoad.media));
  stub.media.contentId = sourceUrl;
  stub.media.contentUrl = CUSTOM_PLAYER_STUB_URL;
  stub.media.contentType = playerType === "dashjs" ? "application/dash+xml" : "video/mp4";
  stub.media.streamType = cast.framework.messages.StreamType.LIVE;
  stub.customData = Object.assign({}, /** @type {Record<string, unknown>} */ (selectedLoad.customData || {}), {
    _customPlayer: playerType,
    _customPlayerUrl: sourceUrl,
  });
  state.pendingCustomPlayerBoot = playerType;
  return stub;
}

export function finalizeCustomPlayerLoad(selectedLoad, sourceUrl, playerType) {
  const cast = window.cast;
  state.activeCustomPlayer = playerType;
  state.activeCustomPlayerUrl = sourceUrl;
  state.pendingCustomPlayerBoot = null;
  if (!selectedLoad.media) selectedLoad.media = {};
  selectedLoad.media.contentId = sourceUrl;
  selectedLoad.media.contentUrl = CUSTOM_PLAYER_STUB_URL;
  selectedLoad.media.contentType = playerType === "dashjs" ? "application/dash+xml" : "video/mp4";
  selectedLoad.media.streamType = cast.framework.messages.StreamType.LIVE;
  selectedLoad.customData = Object.assign({}, /** @type {Record<string, unknown>} */ (selectedLoad.customData || {}), {
    _customPlayer: playerType,
    _customPlayerUrl: sourceUrl,
    _customPlayerActive: true,
  });
  onPlaybackStartedUi();
  debugLog("playback.custom_started", { playerType });
  return selectedLoad;
}

export function buildCafNativeTsLoad(selectedLoad, sourceUrl) {
  const cast = window.cast;
  const nativeLoad = Object.assign({}, selectedLoad);
  const normalized = normalizeCandidateUrl(sourceUrl);
  nativeLoad.media = Object.assign({}, asObject(selectedLoad.media), {
    contentId: normalized,
    contentUrl: normalized,
    contentType: "video/mp2t",
    streamType: cast.framework.messages.StreamType.LIVE,
  });
  return nativeLoad;
}

function hlsLive() {
  return state.hlsInstance && state.hlsInstance.__preetInvocation === state.hlsJsInvocationCounter;
}

function safeHlsLoadSource(url, label) {
  if (!state.hlsInstance || !hlsLive()) {
    debugLog("hlsjs.loadSource.skipped", { label, url });
    return false;
  }
  try {
    state.hlsInstance.loadSource(url);
    debugLog("hlsjs.loadSource", { label, url });
    return true;
  } catch (e) {
    debugLog("hlsjs.loadSource.error", { label, message: e && e.message ? e.message : "unknown" });
    return false;
  }
}

/**
 * @param {string} rawSourceUrl
 * @param {unknown} selectedLoad
 * @param {{ clearStallWatchdog: () => void, armStallWatchdog: (s: string) => void, onFatal: (err: Error) => void }} hooks
 */
export function startHlsJsPlayback(rawSourceUrl, selectedLoad, hooks) {
  const castVideoEl = getCastVideoEl();
  const sourceUrl = normalizeCandidateUrl(rawSourceUrl);
  return new Promise((resolve, reject) => {
    destroyHls();
    destroyDash();
    destroyMpegts();
    clearCustomPlayer();
    state.pendingCustomPlayerBoot = "hlsjs";

    if (!hlsIsAvailable()) {
      state.pendingCustomPlayerBoot = null;
      reject(new Error("hlsjs unavailable"));
      return;
    }

    const myId = ++state.hlsJsInvocationCounter;
    let settled = false;
    let hlsUaAttempts = 0;
    let mediaAttached = false;
    let manifestParsed = false;
    const bootDeadline = setTimeout(() => {
      if (settled) return;
      failPreload("hlsjs boot timeout (no manifest/blob)");
    }, HLS_BOOT_TIMEOUT_MS);

    function failPreload(reason) {
      if (settled) return;
      settled = true;
      clearTimeout(bootDeadline);
      state.pendingCustomPlayerBoot = null;
      hooks.clearStallWatchdog();
      destroyHls();
      reject(new Error(reason || "hlsjs preload failed"));
    }

    function settle(finalized) {
      if (settled) return;
      settled = true;
      clearTimeout(bootDeadline);
      state.pendingCustomPlayerBoot = null;
      hooks.clearStallWatchdog();
      resolve(finalized);
    }

    function trySettleAfterReady() {
      if (!hlsLive() || settled) return;
      if (!mediaAttached || !manifestParsed) return;

      function completeSettle() {
        const finalized = finalizeCustomPlayerLoad(selectedLoad, sourceUrl, "hlsjs");
        debugLog("hlsjs.ready", {
          url: sourceUrl,
          mediaSrc: readVideoBlobUrl(),
          index: state.activeCandidateIndex,
        });
        if (castVideoEl) {
          castVideoEl.play().catch((e) => {
            debugLog("hlsjs.play.error", { message: e && e.message ? e.message : "unknown" });
          });
        }
        setStatus("Playing (HLS.js)");
        settle(finalized);
      }

      if (readVideoBlobUrl()) {
        completeSettle();
        return;
      }
      let attempts = 0;
      const waitForBlob = () => {
        if (settled) return;
        if (!hlsLive()) return;
        if (readVideoBlobUrl() || attempts >= 40) {
          completeSettle();
          return;
        }
        attempts += 1;
        setTimeout(waitForBlob, 50);
      };
      waitForBlob();
    }

    state.hlsInstance = new Hls(buildHlsJsConfig());
    state.hlsInstance.__preetInvocation = myId;

    state.hlsInstance.on(Hls.Events.ERROR, (_evt, data) => {
      if (!data || !data.fatal || !hlsLive()) return;
      debugLog("hlsjs.fatal_error", { url: sourceUrl, details: data.details, type: data.type });

      const isManifestNet =
        String(data.type || "").toLowerCase() === "networkerror" &&
        String(data.details || "").toLowerCase().indexOf("manifest") >= 0;

      if (!settled && isManifestNet && hlsUaAttempts < IPTV_USER_AGENTS.length - 1) {
        hlsUaAttempts += 1;
        rotateIptvUserAgent("hlsjs_manifest_retry");
        if (safeHlsLoadSource(resolveFetchUrl(sourceUrl, "manifest"), "hlsjs_ua_retry")) return;
      }

      if (!settled) {
        failPreload(data.details || "hlsjs fatal");
        return;
      }
      void hooks.onFatal(new Error(data.details || "fatal"));
    });

    state.hlsInstance.once(Hls.Events.MEDIA_ATTACHED, () => {
      mediaAttached = true;
      debugLog("hlsjs.media_attached", { url: sourceUrl });
      trySettleAfterReady();
    });

    state.hlsInstance.once(Hls.Events.MANIFEST_PARSED, () => {
      manifestParsed = true;
      debugLog("hlsjs.manifest_parsed", { url: sourceUrl });
      trySettleAfterReady();
    });

    hooks.armStallWatchdog("hlsjs.start");
    state.hlsInstance.attachMedia(castVideoEl);
    if (!safeHlsLoadSource(resolveFetchUrl(sourceUrl, "manifest"), "hlsjs_immediate")) {
      failPreload("hlsjs loadSource failed");
    }
  });
}

/**
 * @param {string} rawSourceUrl
 * @param {unknown} selectedLoad
 * @param {{ clearStallWatchdog: () => void, armStallWatchdog: (s: string) => void, onFatal: (err: Error) => void }} hooks
 */
export function startMpegtsPlayback(rawSourceUrl, selectedLoad, hooks) {
  const castVideoEl = getCastVideoEl();
  const sourceUrl = normalizeCandidateUrl(rawSourceUrl);
  return new Promise((resolve, reject) => {
    destroyHls();
    destroyDash();
    destroyMpegts();
    clearCustomPlayer();
    state.pendingCustomPlayerBoot = "mpegts";

    let settled = false;
    let mpegtsUaAttempts = 0;
    let mpegtsBootWallTimer = null;
    function clearMpegtsBootWallTimer() {
      if (mpegtsBootWallTimer) {
        clearTimeout(mpegtsBootWallTimer);
        mpegtsBootWallTimer = null;
      }
    }
    mpegtsBootWallTimer = setTimeout(() => {
      if (settled) return;
      debugLog("mpegts.boot_wall_timeout", { url: sourceUrl, index: state.activeCandidateIndex });
      failPreload("mpegts boot timeout (no playing/canplay within 55s)");
    }, MPEGTS_BOOT_WALL_MS);

    if (!mpegtsIsAvailable()) {
      clearMpegtsBootWallTimer();
      state.pendingCustomPlayerBoot = null;
      reject(new Error("mpegts unavailable"));
      return;
    }

    function failPreload(reason) {
      if (settled) return;
      settled = true;
      clearMpegtsBootWallTimer();
      state.pendingCustomPlayerBoot = null;
      hooks.clearStallWatchdog();
      destroyMpegts();
      reject(new Error(reason || "mpegts preload failed"));
    }

    function settle() {
      if (settled) return;
      settled = true;
      clearMpegtsBootWallTimer();
      state.pendingCustomPlayerBoot = null;
      hooks.clearStallWatchdog();
      resolve(undefined);
    }

    function beginMpegtsSession() {
      const playbackUrl = resolveFetchUrl(sourceUrl, "segment");
      const headers = buildIptvRequestHeaders(sourceUrl);
      destroyMpegts();
      installIptvNetworkShim(sourceUrl);
      state.mpegtsInstance = mpegts.createPlayer(
        {
          type: "mpegts",
          isLive: true,
          url: playbackUrl,
          headers: headers,
          hasAudio: true,
          hasVideo: true,
        },
        buildMpegtsPlayerConfig()
      );

      state.mpegtsInstance.on(mpegts.Events.ERROR, (errorType, errorDetail) => {
        const invalidStatus = String(errorDetail || "").indexOf("HttpStatusCodeInvalid") >= 0;
        debugLog("mpegts.error", { errorType, errorDetail, url: sourceUrl });
        if (!settled && invalidStatus && mpegtsUaAttempts < IPTV_USER_AGENTS.length - 1) {
          mpegtsUaAttempts += 1;
          rotateIptvUserAgent("mpegts_status_retry");
          try {
            beginMpegtsSession();
          } catch (e) {
            failPreload(e && e.message ? e.message : "mpegts retry");
          }
          return;
        }
        if (!settled) {
          failPreload(String(errorDetail || errorType || "mpegts fatal"));
          return;
        }
        void hooks.onFatal(new Error(String(errorDetail || errorType)));
      });

      hooks.armStallWatchdog("mpegts.start");
      state.mpegtsInstance.attachMediaElement(castVideoEl);
      state.mpegtsInstance.load();
      const pr = state.mpegtsInstance.play();
      if (pr && typeof pr.catch === "function") {
        pr.catch((playErr) => {
          const message = playErr && playErr.message ? playErr.message : "mpegts play failed";
          if (isPlayInterruptedError(message)) return;
          failPreload(message);
        });
      }
    }

    const onPlaying = () => {
      if (settled) return;
      finalizeCustomPlayerLoad(selectedLoad, sourceUrl, "mpegts");
      setStatus("Playing (MPEG-TS)");
      settle();
    };

    if (castVideoEl) {
      castVideoEl.addEventListener("playing", onPlaying, { once: true });
      castVideoEl.addEventListener("canplay", onPlaying, { once: true });
      castVideoEl.addEventListener("loadeddata", onPlaying, { once: true });
    }

    try {
      beginMpegtsSession();
    } catch (e) {
      failPreload(e && e.message ? e.message : "mpegts attach");
    }
  });
}

/**
 * @param {string} sourceUrl
 * @param {unknown} selectedLoad
 * @param {{ clearStallWatchdog: () => void, armStallWatchdog: (s: string) => void, onFatal: (err: Error) => void }} hooks
 */
export function startDashJsPlayback(sourceUrl, selectedLoad, hooks) {
  const castVideoEl = getCastVideoEl();
  return new Promise((resolve) => {
    destroyHls();
    destroyDash();
    destroyMpegts();
    clearCustomPlayer();

    if (!dashIsAvailable()) {
      debugLog("dashjs.unavailable", { url: sourceUrl });
      resolve(selectedLoad);
      return;
    }

    let settled = false;
    state.dashInstance = dashjs.MediaPlayer().create();
    state.dashInstance.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
      if (settled) return;
      settled = true;
      hooks.clearStallWatchdog();
      const finalized = finalizeCustomPlayerLoad(selectedLoad, sourceUrl, "dashjs");
      state.dashInstance.play();
      setStatus("Playing (DASH)");
      resolve(finalized);
    });
    state.dashInstance.on(dashjs.MediaPlayer.events.ERROR, () => {
      if (settled) return;
      settled = true;
      hooks.clearStallWatchdog();
      void hooks.onFatal(new Error("dash error"));
      resolve(selectedLoad);
    });
    hooks.armStallWatchdog("dashjs.start");
    state.dashInstance.attachView(castVideoEl);
    state.dashInstance.attachSource(resolveFetchUrl(sourceUrl, "manifest"));
  });
}

export async function tryNativeCafHlsReload(sourceUrl) {
  if (!state.lastLoadTemplate || !state.playerManager) throw new Error("missing_template");
  destroyHls();
  destroyDash();
  destroyMpegts();
  clearCustomPlayer();
  state.pendingCustomPlayerBoot = null;
  const cast = window.cast;
  const normalized = normalizeCandidateUrl(sourceUrl);
  const sel = prepareLoadForCandidate(state.lastLoadTemplate, normalized, state.activeCandidateIndex);
  sel.media = Object.assign({}, sel.media, {
    contentId: normalized,
    contentUrl: normalized,
    contentType: "application/x-mpegURL",
    streamType: cast.framework.messages.StreamType.LIVE,
  });
  const req = state.playerManager.load(sel);
  if (req && typeof req.then === "function") await req;
}

export async function tryNativeCafTsReload(sourceUrl) {
  if (!state.lastLoadTemplate || !state.playerManager) throw new Error("missing_template");
  destroyHls();
  destroyDash();
  destroyMpegts();
  clearCustomPlayer();
  state.pendingCustomPlayerBoot = null;
  const nativeLoad = buildCafNativeTsLoad(
    prepareLoadForCandidate(state.lastLoadTemplate, normalizeCandidateUrl(sourceUrl), state.activeCandidateIndex),
    sourceUrl
  );
  const req = state.playerManager.load(nativeLoad);
  if (req && typeof req.then === "function") await req;
}

/**
 * @param {string} playerType
 * @param {unknown} err
 * @param {unknown} selectedLoad
 * @param {string} sourceUrl
 * @param {(reason: string) => Promise<void>} advanceCandidate
 */
export async function handleCustomInterceptorFailure(playerType, err, selectedLoad, sourceUrl, advanceCandidate) {
  debugLog(playerType + ".failure", { message: serializeReceiverError(err), url: sourceUrl });
  destroyHls();
  destroyDash();
  destroyMpegts();
  clearCustomPlayer();

  try {
    if (playerType === "hlsjs" && isHlsCandidate(sourceUrl)) {
      await tryNativeCafHlsReload(sourceUrl);
      return;
    }
    if (playerType === "mpegts" && isTsCandidate(sourceUrl) && state.useCastReceiver) {
      await tryNativeCafTsReload(sourceUrl);
      return;
    }
  } catch (e) {
    debugLog(playerType + ".native_fallback_failed", { message: serializeReceiverError(e) });
  }

  await advanceCandidate(playerType + "_failed");
}
