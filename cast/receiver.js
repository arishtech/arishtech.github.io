/* global cast, Hls */

const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();
const statusEl = document.getElementById("status");

// Register the custom <video> element so Cast uses it instead of its own internal element.
// This lets us attach HLS.js to the same element that Cast manages state for.
const castVideoEl = document.getElementById("castVideo");
if (castVideoEl) {
  playerManager.setMediaElement(castVideoEl);
}

const DEBUG_QUERY_FLAG = (() => {
  try {
    const query = new URLSearchParams(window.location.search || "");
    const value = String(query.get("debug") || "").trim().toLowerCase();
    return value === "1" || value === "true" || value === "yes" || value === "verbose";
  } catch (_e) {
    return false;
  }
})();

let debugEnabled = DEBUG_QUERY_FLAG;
let debugSequence = 0;
const debugHistory = [];
const DEBUG_HISTORY_LIMIT = 200;
const DEFAULT_DEBUG_ENABLED = true;

// Expose log buffer immediately so index.html can render even if later init fails.
window.__preettvDebug = debugHistory;

// Keep debug on by default so receiver issues are visible without inspect tooling.
debugEnabled = DEFAULT_DEBUG_ENABLED || DEBUG_QUERY_FLAG;

let activeCandidates = [];
let activeCandidateIndex = 0;
let lastLoadTemplate = null;
let stallWatchdogTimer = null;
let stallWatchdogSerial = 0;
const STALL_WATCHDOG_MS = 12000;

// HLS.js instance for IPTV stream playback (mirrors test-browser.html logic).
let hlsInstance = null;

function destroyHls() {
  if (hlsInstance) {
    try { hlsInstance.destroy(); } catch (_e) {}
    hlsInstance = null;
  }
}

function isHlsCandidate(url) {
  const s = (url || "").toLowerCase();
  return s.includes("extension=m3u8") || s.includes(".m3u8") || s.includes("type=m3u8");
}

function hlsIsAvailable() {
  return castVideoEl && typeof Hls !== "undefined" && Hls.isSupported();
}

// Phase 2 / 2.1 hardening state derived from sender customData.
// Backend proxy contract: see cast-receiver/BACKEND_PROXY_REFERENCE.md
// Receiver emits X-PreetTV-Schema: 2.1 header label via proxy rewrite (server reads it for routing).
let activeContract = {
  schemaVersion: 1,
  auth: {},
  token: {},
  proxy: {},
  networkPolicy: {},
};

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
  console.log("[PreetTV Receiver]", text);
}

function serializeForDebug(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_e) {
    return String(value);
  }
}

function debugLog(event, payload) {
  if (!debugEnabled) return;
  const entry = {
    seq: ++debugSequence,
    ts: new Date().toISOString(),
    event,
    payload: serializeForDebug(payload),
  };
  debugHistory.push(entry);
  if (debugHistory.length > DEBUG_HISTORY_LIMIT) {
    debugHistory.splice(0, debugHistory.length - DEBUG_HISTORY_LIMIT);
  }
  window.__preettvDebug = debugHistory;
  console.log("[PreetTV Receiver][DEBUG]", entry);
}

function safeAddPlayerEventListener(eventType, handler, label) {
  try {
    if (!eventType) {
      debugLog("player.event.unsupported", { label });
      return;
    }
    playerManager.addEventListener(eventType, handler);
  } catch (e) {
    debugLog("player.event.register_error", {
      label,
      message: e && e.message ? e.message : "unknown",
    });
  }
}

function clearStallWatchdog() {
  if (stallWatchdogTimer) {
    clearTimeout(stallWatchdogTimer);
    stallWatchdogTimer = null;
  }
}

function armStallWatchdog(source) {
  clearStallWatchdog();
  const serial = ++stallWatchdogSerial;
  const currentUrl = activeCandidates[activeCandidateIndex] || "";
  debugLog("candidate.watchdog.armed", {
    source,
    serial,
    timeoutMs: STALL_WATCHDOG_MS,
    currentIndex: activeCandidateIndex,
    candidateCount: activeCandidates.length,
    currentUrl,
  });
  stallWatchdogTimer = setTimeout(() => {
    if (serial !== stallWatchdogSerial) return;
    setStatus(`Loading timeout on ${activeCandidateIndex + 1}/${activeCandidates.length}, trying next candidate`);
    debugLog("candidate.watchdog.timeout", {
      source,
      serial,
      currentIndex: activeCandidateIndex,
      candidateCount: activeCandidates.length,
      currentUrl: activeCandidates[activeCandidateIndex] || "",
    });
    void tryLoadNextCandidateOnReceiverError();
  }, STALL_WATCHDOG_MS);
}

function summarizeHeaders(headers) {
  const h = asObject(headers);
  const keys = Object.keys(h);
  return {
    count: keys.length,
    keys,
  };
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.map((v) => String(v || "").trim()).filter((v) => v.length > 0)
    : [];
}

function normalizeContract(customData) {
  const root = asObject(customData);
  return {
    schemaVersion: Number(root.schemaVersion) || 1,
    auth: asObject(root.auth),
    token: asObject(root.token),
    proxy: asObject(root.proxy),
    networkPolicy: asObject(root.networkPolicy),
    channelName: String(root.channelName || ""),
    debug: asObject(root.debug),
  };
}

function applyDebugConfigFromContract(contract) {
  const cfg = asObject(contract && contract.debug);
  const explicitDisable = cfg.enabled === false || String(cfg.level || "").toLowerCase() === "off";
  const verbose = cfg.verbose === true || String(cfg.level || "").toLowerCase() === "verbose";
  debugEnabled = explicitDisable ? false : (DEFAULT_DEBUG_ENABLED || DEBUG_QUERY_FLAG || verbose);
  debugLog("debug.config", {
    defaultEnabled: DEFAULT_DEBUG_ENABLED,
    explicitDisable,
    fromQuery: DEBUG_QUERY_FLAG,
    fromContractVerbose: verbose,
    enabled: debugEnabled,
  });
}

function rewriteQueryParam(url, key, value) {
  try {
    const u = new URL(url);
    if (!u.searchParams.has(key)) return null;
    u.searchParams.set(key, value);
    return u.toString();
  } catch (_e) {
    return null;
  }
}

function appendQueryParam(url, key, value) {
  try {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
  } catch (_e) {
    return null;
  }
}

function inferContentType(url) {
  const lower = (url || "").toLowerCase();
  try {
    const u = new URL(url);
    const ext = (u.searchParams.get("extension") || u.searchParams.get("ext") || "").toLowerCase();
    if (lower.endsWith(".m3u8") || ext === "m3u8") return "application/x-mpegURL";
    if (lower.endsWith(".mpd") || ext === "mpd") return "application/dash+xml";
    if (lower.endsWith(".ts") || ext === "ts") return "video/mp2t";
    if (lower.endsWith(".mp4") || ext === "mp4") return "video/mp4";
  } catch (_e) {}
  return "video/*";
}

function buildCompatibilityCandidates(baseUrl, customData) {
  // Cast built-in player supports HLS (m3u8) natively but NOT raw TS streams.
  // Always place the m3u8 variant FIRST so Cast can use its native HLS pipeline.
  const candidates = [];
  const seen = new Set();
  const push = (value) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    candidates.push(value);
  };

  const lower = (baseUrl || "").toLowerCase();
  const looksLikeLivePhp = lower.includes("/live.php");
  let extensionHint = "";
  try {
    const u = new URL(baseUrl);
    extensionHint = (u.searchParams.get("extension") || u.searchParams.get("ext") || "").toLowerCase();
  } catch (_e) {}

  const looksTs = extensionHint === "ts" || lower.endsWith(".ts");
  const looksHls = extensionHint === "m3u8" || lower.endsWith(".m3u8");

  // For TS streams: try m3u8 first (Cast native HLS), then original TS as last resort.
  if (looksTs) {
    const m3u8Url = rewriteQueryParam(baseUrl, "extension", "m3u8")
      || rewriteQueryParam(baseUrl, "ext", "m3u8");
    if (m3u8Url) push(m3u8Url);
    push(baseUrl); // TS original as fallback
  } else {
    push(baseUrl); // Non-TS: start with original
  }

  // For live.php with no extension: try m3u8 first, then ts.
  if (looksLikeLivePhp && !extensionHint) {
    push(appendQueryParam(baseUrl, "extension", "m3u8"));
    push(appendQueryParam(baseUrl, "extension", "ts"));
  }

  // For m3u8 streams: also try ts variant as fallback.
  if (looksHls) {
    push(rewriteQueryParam(baseUrl, "extension", "ts"));
    push(rewriteQueryParam(baseUrl, "ext", "ts"));
  }

  // Append any sender-specified custom candidate URLs.
  if (customData && Array.isArray(customData.candidateUrls)) {
    customData.candidateUrls.forEach(push);
  }

  return candidates;
}

function applyTokenQueryPolicy(url) {
  const tokenCfg = asObject(activeContract.token);
  const queryValues = asObject(tokenCfg.queryValues);
  const passthroughKeys = asStringArray(tokenCfg.passthroughQueryKeys);
  const allKeys = new Set([...Object.keys(queryValues), ...passthroughKeys]);
  if (allKeys.size === 0) return url;

  try {
    const u = new URL(url);
    allKeys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(queryValues, key)) {
        const value = String(queryValues[key] ?? "");
        if (value) u.searchParams.set(key, value);
      }
    });
    return u.toString();
  } catch (_e) {
    return url;
  }
}

function applyProxyPolicy(url, requestType) {
  const proxyCfg = asObject(activeContract.proxy);
  const enabled = proxyCfg.enabled === true;
  if (!enabled) return url;

  const key =
    requestType === "manifest"
      ? "manifestBaseUrl"
      : requestType === "segment"
      ? "segmentBaseUrl"
      : requestType === "license"
      ? "licenseBaseUrl"
      : "baseUrl";

  const base = String(proxyCfg[key] || proxyCfg.baseUrl || "").trim();
  if (!base) return url;

  try {
    const proxyUrl = new URL(base);
    const originalUrlParam = String(proxyCfg.originalUrlParam || "url");
    proxyUrl.searchParams.set(originalUrlParam, url);

    if (proxyCfg.addChannelName && activeContract.channelName) {
      proxyUrl.searchParams.set("channel", activeContract.channelName);
    }

    return proxyUrl.toString();
  } catch (_e) {
    return url;
  }
}

function mergeRequestHeaders(networkRequestInfo) {
  const authCfg = asObject(activeContract.auth);
  const policyCfg = asObject(activeContract.networkPolicy);
  const allowlist = asStringArray(policyCfg.allowedHeaderNames).map((h) => h.toLowerCase());
  const denylist = asStringArray(policyCfg.blockedHeaderNames).map((h) => h.toLowerCase());

  const baseHeaders = asObject(networkRequestInfo.headers);
  const authHeaders = asObject(authCfg.headers);
  const merged = Object.assign({}, baseHeaders);

  Object.keys(authHeaders).forEach((name) => {
    const normalized = name.toLowerCase();
    if (denylist.includes(normalized)) return;
    if (allowlist.length > 0 && !allowlist.includes(normalized)) return;
    merged[name] = String(authHeaders[name]);
  });

  const strategy = String(authCfg.strategy || "none").toLowerCase();
  const tokenHeaderName = String(authCfg.tokenHeaderName || "Authorization");
  const bearerToken = String(authCfg.bearerToken || "").trim();

  if (strategy === "bearer" && bearerToken) {
    const normalized = tokenHeaderName.toLowerCase();
    if (!denylist.includes(normalized) && (allowlist.length === 0 || allowlist.includes(normalized))) {
      merged[tokenHeaderName] = bearerToken.startsWith("Bearer ") ? bearerToken : `Bearer ${bearerToken}`;
    }
  }

  Object.keys(merged).forEach((name) => {
    if (denylist.includes(name.toLowerCase())) {
      delete merged[name];
    }
  });

  networkRequestInfo.headers = merged;
}

function applyNetworkPolicy(networkRequestInfo, requestType) {
  try {
    let rewritten = String(networkRequestInfo.url || "");
    if (!rewritten) return;

    const before = {
      requestType,
      url: rewritten,
      headers: summarizeHeaders(networkRequestInfo.headers),
    };

    rewritten = applyTokenQueryPolicy(rewritten);
    rewritten = applyProxyPolicy(rewritten, requestType);
    networkRequestInfo.url = rewritten;

    mergeRequestHeaders(networkRequestInfo);

    const after = {
      requestType,
      url: String(networkRequestInfo.url || ""),
      headers: summarizeHeaders(networkRequestInfo.headers),
    };
    debugLog("network.policy.applied", { before, after });
  } catch (e) {
    setStatus(`Network policy hook failed (${requestType}): ${e && e.message ? e.message : "unknown"}`);
    debugLog("network.policy.error", {
      requestType,
      message: e && e.message ? e.message : "unknown",
    });
  }
}

function getReceiverErrorHint(detailCode, reason) {
  const code = Number(detailCode) || 0;
  const normalizedReason = String(reason || "").toLowerCase();

  if (code === 104) {
    return "104: media src not supported (Cast cannot open this URL/format)";
  }

  if (code === 301) {
    return "301: LOAD_FAILED — Cast could not start playback, likely wrong content type or unreachable URL";
  }

  if (code === 905) {
    return "905: pipeline failed — Cast cannot play raw TS; will retry with m3u8 variant";
  }

  if (normalizedReason.includes("demux") || normalizedReason.includes("parse")) {
    return "Demux/parse failure: try m3u8 variant or different codec/container";
  }

  if (normalizedReason.includes("http") || normalizedReason.includes("network") || normalizedReason.includes("cannot") || normalizedReason.includes("open")) {
    return "Network/open failure: check auth headers, token expiry, and proxy/CORS behavior";
  }

  return "Playback failure: try fallback candidate and verify stream format compatibility";
}

function prepareLoadForCandidate(loadRequestData, candidateUrl, retryIndex) {
  const cloned = Object.assign({}, loadRequestData);
  cloned.media = Object.assign({}, loadRequestData.media);
  cloned.media.contentUrl = candidateUrl;
  // Always re-infer content type from the candidate URL — do not inherit
  // the sender's original type (e.g. video/mp2t) which Cast cannot play.
  cloned.media.contentType = inferContentType(candidateUrl);

  // Carry the original base URL and candidate index in customData so the
  // LOAD interceptor can restore the same candidate list on retry instead
  // of rebuilding from the new (already-modified) URL and looping forever.
  if (retryIndex !== undefined) {
    const originalCustomData = asObject(loadRequestData.customData);
    const originalBaseUrl = String(originalCustomData._retryBaseUrl || (loadRequestData.media || {}).contentUrl || "");
    cloned.customData = Object.assign({}, originalCustomData, {
      _retryBaseUrl: originalBaseUrl,
      _retryCandidateIndex: retryIndex,
    });
  }
  return cloned;
}

async function tryLoadNextCandidateOnReceiverError() {
  clearStallWatchdog();
  destroyHls();
  if (!lastLoadTemplate) return;
  if (activeCandidateIndex >= activeCandidates.length - 1) {
    setStatus("All receiver fallback candidates exhausted");
    debugLog("candidate.exhausted", {
      activeCandidateIndex,
      candidateCount: activeCandidates.length,
    });
    return;
  }

  activeCandidateIndex += 1;
  const nextUrl = activeCandidates[activeCandidateIndex];
  // Pass retryIndex so the LOAD interceptor restores the same candidate list.
  const nextLoad = prepareLoadForCandidate(lastLoadTemplate, nextUrl, activeCandidateIndex);
  setStatus(`Retrying candidate ${activeCandidateIndex + 1}/${activeCandidates.length}`);
  debugLog("candidate.retry", {
    nextIndex: activeCandidateIndex,
    nextUrl,
    candidateCount: activeCandidates.length,
    contentType: nextLoad && nextLoad.media ? nextLoad.media.contentType : "",
  });

  try {
    armStallWatchdog("candidate.retry");
    await playerManager.load(nextLoad);
  } catch (e) {
    setStatus(`Receiver retry failed: ${e && e.message ? e.message : "unknown"}`);
    debugLog("candidate.retry.error", {
      message: e && e.message ? e.message : "unknown",
    });
  }
}

playerManager.setMessageInterceptor(cast.framework.messages.MessageType.LOAD, (loadRequestData) => {
  try {
    const media = loadRequestData.media || {};
    const customData = asObject(loadRequestData.customData);

    // On a retry call, _retryBaseUrl carries the original sender URL so we can
    // rebuild the same candidate list and honour the correct _retryCandidateIndex.
    const baseUrl = String(customData._retryBaseUrl || media.contentUrl || "");
    if (!baseUrl) return loadRequestData;

    activeContract = normalizeContract(customData);
    applyDebugConfigFromContract(activeContract);
    debugLog("load.received", {
      mediaContentUrl: baseUrl,
      isRetry: !!customData._retryBaseUrl,
      customDataKeys: Object.keys(customData),
      schemaVersion: activeContract.schemaVersion,
      channelName: activeContract.channelName,
    });

    // Rebuild candidates from the canonical base URL so retries don't re-root.
    activeCandidates = buildCompatibilityCandidates(baseUrl, customData);

    if (customData._retryCandidateIndex != null) {
      // Honour explicit retry index coming from tryLoadNextCandidateOnReceiverError.
      activeCandidateIndex = Math.max(0, Math.min(Number(customData._retryCandidateIndex), activeCandidates.length - 1));
    } else if (Number.isInteger(customData.candidateIndex)) {
      activeCandidateIndex = Math.max(0, Math.min(customData.candidateIndex, activeCandidates.length - 1));
    } else {
      activeCandidateIndex = 0;
    }

    const selectedUrl = activeCandidates[activeCandidateIndex] || baseUrl;
    const selectedLoad = prepareLoadForCandidate(loadRequestData, selectedUrl);
    lastLoadTemplate = loadRequestData;

    debugLog("load.candidates", {
      selectedIndex: activeCandidateIndex,
      selectedUrl,
      candidates: activeCandidates,
      selectedContentType: selectedLoad && selectedLoad.media ? selectedLoad.media.contentType : "",
      usingHlsJs: hlsIsAvailable() && isHlsCandidate(selectedUrl),
    });

    setStatus(`Loading ${activeCandidateIndex + 1}/${activeCandidates.length}`);

    // ── HLS.js path (mirrors test-browser.html loadCandidate) ──────────────
    if (hlsIsAvailable() && isHlsCandidate(selectedUrl)) {
      return new Promise((resolve) => {
        destroyHls();
        hlsInstance = new Hls({ enableWorker: true, lowLatencyMode: false });
        let settled = false;

        function settle(load) {
          if (settled) return;
          settled = true;
          clearStallWatchdog();
          resolve(load);
        }

        hlsInstance.once(Hls.Events.MANIFEST_PARSED, () => {
          debugLog("hlsjs.manifest_parsed", { url: selectedUrl, index: activeCandidateIndex });
          setStatus(`Playing (${activeCandidateIndex + 1}/${activeCandidates.length})`);
          // HLS.js has set castVideoEl.src to a blob:// MSE URL.
          // Hand that URL to CAF so Cast's state machine tracks the right element.
          selectedLoad.media.contentUrl = castVideoEl.src;
          selectedLoad.media.contentType = "video/mp4";
          settle(selectedLoad);
        });

        hlsInstance.on(Hls.Events.ERROR, (_, data) => {
          if (!data.fatal || settled) return;
          debugLog("hlsjs.fatal_error", {
            details: data.details,
            type: data.type,
            url: selectedUrl,
            index: activeCandidateIndex,
          });
          setStatus(`HLS error on ${activeCandidateIndex + 1}/${activeCandidates.length}: ${data.details}`);
          // Let Cast surface the error → triggers safeAddPlayerEventListener ERROR handler
          // which calls tryLoadNextCandidateOnReceiverError for the next candidate.
          settle(selectedLoad);
        });

        armStallWatchdog("hlsjs.load");
        hlsInstance.loadSource(selectedUrl);
        hlsInstance.attachMedia(castVideoEl);
      });
    }

    // ── Native Cast player path (MP4, DASH, or non-HLS) ────────────────────
    armStallWatchdog("load.interceptor.native");
    return selectedLoad;
  } catch (e) {
    setStatus(`LOAD interceptor error: ${e && e.message ? e.message : "unknown"}`);
    debugLog("load.interceptor.error", {
      message: e && e.message ? e.message : "unknown",
    });
    return loadRequestData;
  }
});

safeAddPlayerEventListener(cast.framework.events.EventType.ERROR, (event) => {
  clearStallWatchdog();
  const detailCode = event && event.detailedErrorCode ? event.detailedErrorCode : "";
  const reason = event && event.reason ? event.reason : "";
  const hint = getReceiverErrorHint(detailCode, reason);

  // Guard: if candidates weren't built yet (e.g. error fired before interceptor),
  // rebuild them now from the last known load template.
  if (activeCandidates.length === 0 && lastLoadTemplate) {
    const baseUrl = (lastLoadTemplate.media || {}).contentUrl || "";
    if (baseUrl) {
      activeCandidates = buildCompatibilityCandidates(baseUrl, asObject(lastLoadTemplate.customData));
      activeCandidateIndex = 0;
      debugLog("candidate.rebuilt_on_error", {
        baseUrl,
        candidates: activeCandidates,
      });
    }
  }

  const errorDetail = {
    type: event && event.type ? event.type : "",
    detailedErrorCode: detailCode,
    reason,
    hint,
    currentIndex: activeCandidateIndex,
    candidateCount: activeCandidates.length,
    currentUrl: activeCandidates[activeCandidateIndex] || "unknown",
  };
  setStatus(`Error (${activeCandidateIndex + 1}/${activeCandidates.length}): code ${detailCode} | ${hint}`);
  debugLog("player.error", errorDetail);
  void tryLoadNextCandidateOnReceiverError();
}, "ERROR");

safeAddPlayerEventListener(cast.framework.events.EventType.MEDIA_STATUS, (event) => {
  const status = playerManager.getMediaInformation();
  debugLog("player.media_status", {
    eventType: event && event.type ? event.type : "",
    mediaContentId: status && status.contentId ? status.contentId : "",
    mediaContentType: status && status.contentType ? status.contentType : "",
  });
}, "MEDIA_STATUS");

safeAddPlayerEventListener(cast.framework.events.EventType.REQUEST_LOAD, (event) => {
  debugLog("player.request_load", {
    eventType: event && event.type ? event.type : "",
    hasRequestData: !!(event && event.requestData),
  });
}, "REQUEST_LOAD");

safeAddPlayerEventListener(cast.framework.events.EventType.PLAYER_LOADING, (event) => {
  setStatus(`Loading ${activeCandidateIndex + 1}/${activeCandidates.length}...`);
  debugLog("player.loading", {
    eventType: event && event.type ? event.type : "",
    currentIndex: activeCandidateIndex,
    candidateCount: activeCandidates.length,
  });
  armStallWatchdog("player.loading");
}, "PLAYER_LOADING");

safeAddPlayerEventListener(cast.framework.events.EventType.PLAYER_PAUSE, (event) => {
  debugLog("player.pause", {
    eventType: event && event.type ? event.type : "",
  });
}, "PLAYER_PAUSE");

safeAddPlayerEventListener(cast.framework.events.EventType.PLAYER_PLAY, (event) => {
  clearStallWatchdog();
  setStatus("Playing");
  debugLog("player.play", {
    eventType: event && event.type ? event.type : "",
  });
}, "PLAYER_PLAY");

const playbackConfig = new cast.framework.PlaybackConfig();
playbackConfig.manifestRequestHandler = (networkRequestInfo) => {
  applyNetworkPolicy(networkRequestInfo, "manifest");
};
playbackConfig.segmentRequestHandler = (networkRequestInfo) => {
  applyNetworkPolicy(networkRequestInfo, "segment");
};
playbackConfig.licenseRequestHandler = (networkRequestInfo) => {
  applyNetworkPolicy(networkRequestInfo, "license");
};

context.start({
  playbackConfig,
});

setStatus("PreetTV Receiver started");
debugLog("receiver.started", {
  href: window.location.href,
  debugEnabled,
  hlsJsAvailable: typeof Hls !== "undefined" && Hls.isSupported(),
  customVideoElement: !!castVideoEl,
});



