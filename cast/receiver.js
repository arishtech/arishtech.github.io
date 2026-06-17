/* global cast, Hls, dashjs, mpegts */
/**
 * PreetTV Cast receiver (simplified). Uses Hls.js, dash.js, mpegts.js + CAF native fallbacks.
 * Full legacy copy: receiver.legacy.full.js
 */
"use strict";

const castGlobal = typeof window !== "undefined" ? window.cast : undefined;
const hasCastFramework = !!(
  castGlobal &&
  castGlobal.framework &&
  castGlobal.framework.CastReceiverContext
);

const context = hasCastFramework ? castGlobal.framework.CastReceiverContext.getInstance() : null;
const playerManager = context ? context.getPlayerManager() : null;

function getStreamUrlFromPage() {
  const search = window.location.search || "";
  if (!search) return "";
  const marker = "url=";
  const idx = search.toLowerCase().indexOf(marker);
  if (idx === -1) return "";
  const raw = search.substring(idx + marker.length);
  if (!raw) return "";
  try {
    return decodeURIComponent(raw.replace(/\+/g, " ")).trim();
  } catch (_e) {
    return raw.trim();
  }
}

function isBrowserTestMode() {
  try {
    const query = new URLSearchParams(window.location.search || "");
    const flag = String(query.get("browser") || query.get("test") || "").trim().toLowerCase();
    if (flag === "1" || flag === "true" || flag === "yes") return true;
  } catch (_e) {}
  return !!getStreamUrlFromPage();
}

const browserTestMode = isBrowserTestMode();
const useCastReceiver = !!(hasCastFramework && playerManager && context && !browserTestMode);

const statusEl = document.getElementById("status");
const brandEl = document.getElementById("preetBrand");
const nowPlayingEl = document.getElementById("preetNowPlaying");
const loaderEl = document.getElementById("preetLoader");
const loaderTextEl = document.getElementById("preetLoaderText");
const castVideoEl = document.getElementById("castVideo");

if (castVideoEl && playerManager && useCastReceiver && typeof playerManager.setMediaElement === "function") {
  playerManager.setMediaElement(castVideoEl);
}

const DEFAULT_IPTV_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 11; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const VLC_IPTV_USER_AGENT = "VLC/3.0.20 LibVLC/3.0.20";
const PREET_CAST_USER_AGENT = "PreetTV Cast/1.0";
const IPTV_USER_AGENTS = [VLC_IPTV_USER_AGENT, DEFAULT_IPTV_USER_AGENT, PREET_CAST_USER_AGENT];

let activeIptvUaIndex = 0;
let debugEnabled = false;
let debugSequence = 0;
const debugHistory = (window.__preettvDebug = window.__preettvDebug || []);
const DEBUG_HISTORY_LIMIT = 200;

const DEBUG_QUERY_FLAG = (() => {
  try {
    const query = new URLSearchParams(window.location.search || "");
    const value = String(query.get("debug") || "").trim().toLowerCase();
    return value === "1" || value === "true" || value === "yes" || value === "verbose";
  } catch (_e) {
    return false;
  }
})();
debugEnabled = DEBUG_QUERY_FLAG || document.body.classList.contains("receiver-debug");

let activeCandidates = [];
let activeCandidateIndex = 0;
let lastLoadTemplate = null;
let hlsInstance = null;
let dashInstance = null;
let mpegtsInstance = null;
let hlsJsInvocationCounter = 0;

let activeCustomPlayer = null;
let activeCustomPlayerUrl = "";
let pendingCustomPlayerBoot = null;
let candidateAdvanceInFlight = false;
let candidatesExhausted = false;
let loadSessionPreferredStartIndex = 0;
let receiverBackwardFallbackUsed = false;
let volumeBridgeInstalled = false;

let stallWatchdogTimer = null;
let stallWatchdogSerial = 0;
const STALL_WATCHDOG_MS = 22000;

let activeContract = {
  schemaVersion: 1,
  auth: {},
  token: {},
  proxy: {},
  networkPolicy: {},
  hosting: {},
  playback: {},
  channelName: "",
};

const CUSTOM_PLAYER_STUB_URL = "about:blank";

function stopPlaybackKeepalive() {}

function debugLog(event, payload) {
  const ev = String(event || "");
  const isNoise = ev === "network.policy.applied";
  if (isNoise && !debugEnabled) return;
  const entry = {
    seq: ++debugSequence,
    ts: new Date().toISOString(),
    event: ev,
    payload: payload || {},
  };
  debugHistory.push(entry);
  if (debugHistory.length > DEBUG_HISTORY_LIMIT) debugHistory.shift();
  if (typeof window.__preettvNotifyDebugLog === "function") {
    try {
      window.__preettvNotifyDebugLog();
    } catch (_e) {}
  }
}

function setStatus(text) {
  if (statusEl) statusEl.textContent = text || "";
}

function setBrandingVisible(visible) {
  if (brandEl) brandEl.style.display = visible ? "block" : "none";
}

function showLoader(text) {
  if (loaderEl) loaderEl.classList.remove("hidden");
  if (loaderTextEl) loaderTextEl.textContent = text || "Loading…";
}

function hideLoader() {
  if (loaderEl) loaderEl.classList.add("hidden");
}

function updateCastChannelNameUi(name) {
  if (!nowPlayingEl) return;
  const label = String(name || "").trim();
  if (!label) {
    nowPlayingEl.classList.add("hidden");
    nowPlayingEl.textContent = "";
    return;
  }
  nowPlayingEl.classList.remove("hidden");
  nowPlayingEl.textContent = label;
}

function applyReceiverVolume(level, muted) {
  if (!castVideoEl) return;
  const vol = Math.max(0, Math.min(1, Number(level) || 0));
  castVideoEl.volume = muted ? 0 : vol;
  castVideoEl.muted = !!muted;
}

function installVolumeBridge() {
  if (volumeBridgeInstalled || !playerManager || !castVideoEl) return;
  volumeBridgeInstalled = true;
  try {
    applyReceiverVolume(playerManager.getVolumeLevel(), playerManager.isMute());
  } catch (_e) {}

  safeAddPlayerEventListener(cast.framework.events.EventType.STREAM_VOLUME_CHANGED, (event) => {
    const level = event && typeof event.volume === "number" ? event.volume : playerManager.getVolumeLevel();
    const muted = event && typeof event.isMute === "boolean" ? event.isMute : playerManager.isMute();
    applyReceiverVolume(level, muted);
  }, "STREAM_VOLUME_CHANGED");

  try {
    playerManager.setMessageInterceptor(cast.framework.messages.MessageType.SET_VOLUME, (data) => {
      if (data) applyReceiverVolume(data.volume, data.isMute);
      return data;
    });
  } catch (e) {
    debugLog("player.set_volume.interceptor_error", { message: e && e.message ? e.message : "unknown" });
  }
}

function safeAddPlayerEventListener(eventType, handler, label) {
  if (!playerManager || typeof playerManager.addEventListener !== "function") return;
  try {
    playerManager.addEventListener(eventType, handler);
  } catch (e) {
    debugLog("player.add_listener.error", { label, message: e && e.message ? e.message : "unknown" });
  }
}

function serializeReceiverError(err) {
  if (err == null) return "unknown";
  if (typeof err.message === "string" && err.message.trim()) return err.message.trim();
  if (typeof err.reason === "string" && err.reason.trim()) return err.reason.trim();
  try {
    return JSON.stringify(err);
  } catch (_e) {
    return String(err);
  }
}

function applyDebugConfigFromContract(contract, rawCustom) {
  const dbg = asObject(contract.debug);
  const raw = asObject(rawCustom);
  const rawDbg = asObject(raw.debug);
  if (dbg.enabled === true || rawDbg.enabled === true || raw.castDebugEnabled === true) {
    debugEnabled = true;
    document.body.classList.add("receiver-debug");
  }
}

function resolveFetchUrl(url, requestType) {
  const normalized = normalizeCandidateUrl(url);
  if (!isProxyEnabled()) return normalized;
  const netInfo = { url: normalized, headers: {} };
  applyProxyPolicy(netInfo, requestType || "manifest");
  return netInfo.url;
}

function buildMpegtsPlayerConfig() {
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

function isPlayInterruptedError(err) {
  const msg = String((err && err.message) || err || "");
  return (
    msg.indexOf("interrupted by a call to pause") >= 0 ||
    msg.indexOf("interrupted by a new load") >= 0 ||
    msg.indexOf("The play() request was interrupted") >= 0
  );
}

function markCandidatesExhausted(reason) {
  if (candidatesExhausted) return;
  candidatesExhausted = true;
  hideLoader();
  setBrandingVisible(true);
  updateCastChannelNameUi("");
  setStatus("All receiver fallback candidates exhausted");
  debugLog("candidate.exhausted", { reason, activeCandidateIndex, candidateCount: activeCandidates.length });
}

function prepareLoadForCandidate(loadRequestData, candidateUrl, retryIndex) {
  const cloned = Object.assign({}, loadRequestData);
  cloned.media = Object.assign({}, loadRequestData.media);
  cloned.media.contentId = candidateUrl;
  cloned.media.contentUrl = candidateUrl;
  cloned.media.contentType = inferContentType(candidateUrl);
  if (retryIndex !== undefined) {
    const originalCustomData = asObject(loadRequestData.customData);
    const originalMedia = asObject(loadRequestData.media);
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

function prepareCustomPlayerStubLoad(selectedLoad, sourceUrl, playerType) {
  const stub = Object.assign({}, selectedLoad);
  stub.media = Object.assign({}, selectedLoad.media);
  stub.media.contentId = sourceUrl;
  stub.media.contentUrl = CUSTOM_PLAYER_STUB_URL;
  stub.media.contentType = playerType === "dashjs" ? "application/dash+xml" : "video/mp4";
  stub.media.streamType = cast.framework.messages.StreamType.LIVE;
  stub.customData = Object.assign({}, asObject(selectedLoad.customData), {
    _customPlayer: playerType,
    _customPlayerUrl: sourceUrl,
  });
  pendingCustomPlayerBoot = playerType;
  return stub;
}

function readVideoBlobUrl() {
  if (!castVideoEl) return "";
  const mediaSrc = castVideoEl.currentSrc || castVideoEl.src || "";
  return mediaSrc.startsWith("blob:") ? mediaSrc : "";
}

function onPlaybackStartedUi() {
  hideLoader();
  setBrandingVisible(false);
  installVolumeBridge();
  if (useCastReceiver && playerManager) {
    try {
      requestAnimationFrame(() => {
        try {
          playerManager.play();
        } catch (_e) {}
      });
    } catch (_e) {}
  }
}

function finalizeCustomPlayerLoad(selectedLoad, sourceUrl, playerType) {
  activeCustomPlayer = playerType;
  activeCustomPlayerUrl = sourceUrl;
  pendingCustomPlayerBoot = null;
  selectedLoad.media.contentId = sourceUrl;
  selectedLoad.media.contentUrl = CUSTOM_PLAYER_STUB_URL;
  selectedLoad.media.contentType = playerType === "dashjs" ? "application/dash+xml" : "video/mp4";
  selectedLoad.media.streamType = cast.framework.messages.StreamType.LIVE;
  selectedLoad.customData = Object.assign({}, asObject(selectedLoad.customData), {
    _customPlayer: playerType,
    _customPlayerUrl: sourceUrl,
    _customPlayerActive: true,
  });
  onPlaybackStartedUi();
  debugLog("playback.custom_started", { playerType });
  return selectedLoad;
}

function buildCafNativeTsLoad(selectedLoad, sourceUrl) {
  const nativeLoad = Object.assign({}, selectedLoad);
  const normalized = normalizeCandidateUrl(sourceUrl);
  nativeLoad.media = Object.assign({}, selectedLoad.media, {
    contentId: normalized,
    contentUrl: normalized,
    contentType: "video/mp2t",
    streamType: cast.framework.messages.StreamType.LIVE,
  });
  return nativeLoad;
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
  stallWatchdogTimer = setTimeout(() => {
    if (serial !== stallWatchdogSerial) return;
    if (candidatesExhausted) return;
    // HLS.js / mpegts boot can exceed 22s on slow IPTV manifests; do not advance while JS player is still starting.
    if (pendingCustomPlayerBoot) {
      debugLog("candidate.watchdog.deferred_boot", { source, pendingCustomPlayerBoot, index: activeCandidateIndex });
      armStallWatchdog(String(source || "watchdog") + ".boot");
      return;
    }
    if (activeCustomPlayer && castVideoEl && (!castVideoEl.paused || castVideoEl.readyState >= 3)) return;
    debugLog("candidate.watchdog", { source, index: activeCandidateIndex });
    void tryLoadNextCandidateOnReceiverError("watchdog");
  }, STALL_WATCHDOG_MS);
}

let shakaFilterRegistered = false;

function classifyCafShakaRequestType(type) {
  if (type === 0) return "manifest";
  if (type === 1) return "segment";
  if (type === 2) return "license";
  return "segment";
}

function ensureShakaRequestFilters() {
  if (shakaFilterRegistered || !playerManager) return;
  try {
    const player = typeof playerManager.getPlayer === "function" ? playerManager.getPlayer() : null;
    const engine = player && typeof player.getNetworkingEngine === "function" ? player.getNetworkingEngine() : null;
    if (!engine || typeof engine.registerRequestFilter !== "function") return;
    engine.registerRequestFilter((type, request) => {
      if (!request) return;
      const url = request.uris && request.uris[0] ? String(request.uris[0]) : "";
      const info = { url, headers: Object.assign({}, asObject(request.headers)) };
      applyNetworkPolicy(info, classifyCafShakaRequestType(type));
      request.headers = info.headers;
      request.allowCrossSiteCredentials = false;
    });
    shakaFilterRegistered = true;
    debugLog("network.shaka_filter.registered", {});
  } catch (e) {
    debugLog("network.shaka_filter.error", { message: e && e.message ? e.message : "unknown" });
  }
}

function createPlaybackConfig() {
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
  return playbackConfig;
}
/* AUTO-EXTRACTED from receiver.legacy.full.js */

function destroyHls() {
  if (hlsInstance) {
    try { hlsInstance.destroy(); } catch (_e) {}
    hlsInstance = null;
  }
}

function destroyDash() {
  if (dashInstance) {
    try { dashInstance.off(dashjs.MediaPlayer.events.ERROR); } catch (_e) {}
    try { dashInstance.reset(); } catch (_e) {}
    dashInstance = null;
  }
}

let activeIptvNetworkShim = null;

function streamHostsMatch(requestUrl, candidateUrl) {
  try {
    const a = new URL(normalizeCandidateUrl(requestUrl));
    const b = new URL(normalizeCandidateUrl(candidateUrl));
    return a.host === b.host;
  } catch (_e) {
    return false;
  }
}

function installIptvNetworkShim(requestUrl) {
  removeIptvNetworkShim();
  const target = normalizeCandidateUrl(requestUrl);
  const headerPack = buildFetchRequestHeaders(target);
  const headers = headerPack.headers;
  const originalFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  const OriginalXHR = window.XMLHttpRequest;

  function shouldShim(url) {
    return streamHostsMatch(target, url);
  }

  if (originalFetch) {
    window.fetch = function patchedFetch(input, init) {
      const url = typeof input === "string" ? input : (input && input.url ? input.url : "");
      if (shouldShim(url)) {
        const mergedInit = Object.assign({}, init || {}, {
          mode: "cors",
          credentials: "omit",
        });
        mergedInit.headers = Object.assign({}, headers, asObject(mergedInit.headers));
        return originalFetch(input, mergedInit);
      }
      return originalFetch(input, init);
    };
  }

  function PatchedXHR() {
    const xhr = new OriginalXHR();
    let xhrUrl = "";
    const nativeOpen = xhr.open;
    xhr.open = function patchedOpen(method, url) {
      xhrUrl = String(url || "");
      return nativeOpen.apply(xhr, arguments);
    };
    const nativeSetHeader = xhr.setRequestHeader;
    xhr.setRequestHeader = function patchedSetHeader(name, value) {
      return nativeSetHeader.call(xhr, name, value);
    };
    const nativeSend = xhr.send;
    xhr.send = function patchedSend() {
      if (shouldShim(xhrUrl)) {
        Object.keys(headers).forEach((name) => {
          try { nativeSetHeader.call(xhr, name, headers[name]); } catch (_e) {}
        });
      }
      return nativeSend.apply(xhr, arguments);
    };
    return xhr;
  }
  PatchedXHR.prototype = OriginalXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;

  activeIptvNetworkShim = {
    restore() {
      if (originalFetch) window.fetch = originalFetch;
      window.XMLHttpRequest = OriginalXHR;
      activeIptvNetworkShim = null;
    },
  };
  return activeIptvNetworkShim;
}

function removeIptvNetworkShim() {
  if (activeIptvNetworkShim && typeof activeIptvNetworkShim.restore === "function") {
    activeIptvNetworkShim.restore();
  }
}

function destroyMpegts() {
  removeIptvNetworkShim();
  if (mpegtsInstance) {
    try { mpegtsInstance.off(mpegts.Events.ERROR); } catch (_e) {}
    try { mpegtsInstance.pause(); } catch (_e) {}
    try { mpegtsInstance.unload(); } catch (_e) {}
    try { mpegtsInstance.detachMediaElement(); } catch (_e) {}
    try { mpegtsInstance.destroy(); } catch (_e) {}
    mpegtsInstance = null;
  }
}

function clearCustomPlayer() {
  activeCustomPlayer = null;
  activeCustomPlayerUrl = "";
  stopPlaybackKeepalive();
}

const BROWSER_FORBIDDEN_REQUEST_HEADERS = new Set([
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "referer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "user-agent",
  "via",
]);

function isForbiddenBrowserRequestHeader(name) {
  return BROWSER_FORBIDDEN_REQUEST_HEADERS.has(String(name || "").toLowerCase());
}

function partitionIptvHeaders(headers) {
  const all = asObject(headers);
  const fetchSafe = {};
  const fetchBlocked = {};
  Object.keys(all).forEach((name) => {
    if (isForbiddenBrowserRequestHeader(name)) {
      fetchBlocked[name] = all[name];
    } else {
      fetchSafe[name] = all[name];
    }
  });
  return { caf: Object.assign({}, all), fetchSafe, fetchBlocked };
}

function classifyFetchError(error) {
  const message = String((error && error.message) || error || "");
  const lower = message.toLowerCase();
  if (
    lower.indexOf("failed to fetch") >= 0 ||
    lower.indexOf("networkerror") >= 0 ||
    lower.indexOf("network error") >= 0 ||
    lower.indexOf("load failed") >= 0 ||
    lower.indexOf("cors") >= 0
  ) {
    return { kind: "cors_or_network", message };
  }
  return { kind: "unknown", message };
}

function readCorsResponseHeaders(response) {
  if (!response || typeof response.headers !== "object" || !response.headers.get) {
    return {};
  }
  return {
    allowOrigin: response.headers.get("access-control-allow-origin") || "",
    allowHeaders: response.headers.get("access-control-allow-headers") || "",
    allowMethods: response.headers.get("access-control-allow-methods") || "",
    exposeHeaders: response.headers.get("access-control-expose-headers") || "",
  };
}

function auditNetworkEnvironment(requestUrl) {
  const target = normalizeCandidateUrl(requestUrl);
  let streamOrigin = "";
  try {
    streamOrigin = new URL(target).origin;
  } catch (_e) {}
  const receiverOrigin = (() => {
    try {
      return window.location.origin;
    } catch (_e) {
      return "";
    }
  })();
  const fullHeaders = buildCafRequestHeaders(target);
  const parts = partitionIptvHeaders(fullHeaders);
  return {
    receiverOrigin,
    streamOrigin,
    crossOrigin: !!(streamOrigin && receiverOrigin && streamOrigin !== receiverOrigin),
    fetchMode: "cors",
    credentials: "omit",
    cafCanSetUserAgent: true,
    fetchBlockedHeaders: parts.fetchBlocked,
    fetchAllowedHeaders: parts.fetchSafe,
    note: "User-Agent/Referer/Origin apply on CAF native requests only; browser fetch/XHR cannot set them.",
  };
}

function buildCafRequestHeaders(requestUrl, uaIndex) {
  const info = { url: normalizeCandidateUrl(requestUrl), headers: {} };
  const chosenUa = IPTV_USER_AGENTS[
    Number.isInteger(uaIndex) ? uaIndex : activeIptvUaIndex
  ] || DEFAULT_IPTV_USER_AGENT;
  info.headers["User-Agent"] = chosenUa;
  info.headers.Accept = "*/*";
  mergeRequestHeaders(info);
  try {
    const streamOrigin = new URL(info.url);
    const referer = `${streamOrigin.protocol}//${streamOrigin.host}/`;
    if (!Object.keys(info.headers).some((name) => name.toLowerCase() === "referer")) {
      info.headers.Referer = referer;
    }
  } catch (_e) {}
  return info.headers;
}

function buildFetchRequestHeaders(requestUrl, uaIndex) {
  const cafHeaders = buildCafRequestHeaders(requestUrl, uaIndex);
  const parts = partitionIptvHeaders(cafHeaders);
  if (!parts.fetchSafe.Accept) {
    parts.fetchSafe.Accept = "*/*";
  }
  return {
    headers: parts.fetchSafe,
    blocked: parts.fetchBlocked,
  };
}

function buildIptvRequestHeaders(requestUrl, uaIndex) {
  return buildCafRequestHeaders(requestUrl, uaIndex);
}
function isHlsCandidate(url) {
  const s = (url || "").toLowerCase();
  return (
    s.includes("extension=m3u8") ||
    s.includes("ext=m3u8") ||
    s.includes(".m3u8") ||
    s.includes("type=m3u8") ||
    s.includes("output=m3u8") ||
    s.includes("format=m3u8") ||
    s.includes("output=hls") ||
    s.includes("format=hls")
  );
}

function isProgressiveCandidate(url) {
  const s = (url || "").toLowerCase();
  if (s.endsWith(".mp4") || s.endsWith(".webm") || s.endsWith(".mov") || s.endsWith(".m4v")) {
    return true;
  }
  try {
    const u = new URL(url);
    const ext = (u.searchParams.get("extension") || u.searchParams.get("ext") || "").toLowerCase();
    const type = (u.searchParams.get("type") || u.searchParams.get("output") || u.searchParams.get("format") || "").toLowerCase();
    return ext === "mp4" || type === "mp4" || ext === "webm" || type === "webm";
  } catch (_e) {
    return false;
  }
}

function isLikelyLiveStream(url) {
  const s = (url || "").toLowerCase();
  return (
    s.includes("/live/play/") ||
    s.includes("/live.php") ||
    s.includes("/live/") ||
    s.includes("/stream") ||
    s.includes("/channel") ||
    s.includes("/play/") ||
    s.includes("/iptv/") ||
    s.includes("/hls/") ||
    s.includes("/playlist")
  );
}

function isTsCandidate(url) {
  const s = (url || "").toLowerCase();
  if (s.includes("extension=ts") || s.includes("ext=ts") || s.endsWith(".ts")) return true;
  try {
    const u = new URL(url);
    const ext = (u.searchParams.get("extension") || u.searchParams.get("ext") || "").toLowerCase();
    const type = (u.searchParams.get("type") || u.searchParams.get("output") || u.searchParams.get("format") || "").toLowerCase();
    return ext === "ts" || type === "ts";
  } catch (_e) {
    return false;
  }
}

function shouldAttemptHlsJs(url) {
  if (isProgressiveCandidate(url) || isDashCandidate(url) || isTsCandidate(url)) return false;
  if (isHlsCandidate(url)) return true;
  if (isLikelyLiveStream(url)) return true;
  try {
    const u = new URL(url);
    const path = u.pathname || "";
    if (!path.substring(1).includes(".")) return true;
  } catch (_e) {}
  return false;
}

function isDashCandidate(url) {
  const s = (url || "").toLowerCase();
  return (
    s.includes(".mpd") ||
    s.includes("extension=mpd") ||
    s.includes("ext=mpd") ||
    s.includes("type=mpd") ||
    s.includes("output=mpd") ||
    s.includes("format=mpd") ||
    s.includes("format=dash") ||
    s.includes("output=dash")
  );
}

function isXtreamStyleUrl(url) {
  const lower = String(url || "").toLowerCase();
  if (
    lower.includes("vueott") ||
    lower.includes("weaseltv") ||
    lower.includes("klaratv") ||
    lower.includes("/live.php") ||
    lower.includes("/play/live") ||
    lower.includes("/get.php") ||
    lower.includes("/streaming/") ||
    lower.includes("/iptv/")
  ) {
    return true;
  }
  try {
    const host = new URL(String(url || "")).host.toLowerCase();
    if (
      host.includes("weaseltv") ||
      host.includes("klaratv") ||
      host.includes("vueott") ||
      host.startsWith("line.") ||
      host.includes(".line.") ||
      host.includes("xui.")
    ) {
      return true;
    }
  } catch (_e) {}
  return false;
}

function getPlaybackStrategy(url, options) {
  const forBrowser = !!(options && options.forBrowser);
  const pb = asObject(activeContract.playback);
  const chStream = String(pb.channelStreamType || "").toLowerCase();
  // Sender-reported playback shape (what worked on the phone) â€” bias before channel metadata.
  if (!forBrowser && useCastReceiver) {
    if (isTruthyFlag(pb.phonePlayingAsDash) && isDashCandidate(url)) {
      return "dashjs";
    }
    if (isTruthyFlag(pb.phonePlayingAsHls) && isHlsCandidate(url)) {
      return "hlsjs";
    }
    if (isTruthyFlag(pb.phonePlayingAsTs) && isTsCandidate(url)) {
      return "caf-ts";
    }
  }
  if (!forBrowser && useCastReceiver && chStream.includes("hls")) {
    if (isHlsCandidate(url)) return "hlsjs";
    if (shouldAttemptHlsJs(url)) return "hlsjs";
  }
  if (!forBrowser && (chStream.includes("dash") || chStream.includes("mpd")) && isDashCandidate(url)) {
    return "dashjs";
  }
  if (isProgressiveCandidate(url)) return "native";
  if (isDashCandidate(url)) return "dashjs";
  if (isTsCandidate(url)) {
    // CAF can set User-Agent on native TS; phone often uses VLC â€” we still UA-rotate on errors.
    if (useCastReceiver) return "caf-ts";
    return "mpegts";
  }
  // IPTV HLS: CAF native Shaka often fails (905) on MPEG-TS-in-HLS; HLS.js matches phone playback.
  if (isHlsCandidate(url)) {
    if (forBrowser) return "hlsjs";
    if (useCastReceiver) return "hlsjs";
    if (isXtreamStyleUrl(url) || isLikelyLiveStream(url)) return "hlsjs";
    return "caf-hls";
  }
  if (shouldAttemptHlsJs(url)) return "hlsjs";
  return "native";
}

function inspectStreamUrl(url) {
  try {
    const u = new URL(String(url || ""));
    const issues = [];
    const raw = u.href;
    if (raw.includes("mac-") && !raw.includes("mac=")) issues.push("mac_separator_corrupt");
    if (raw.includes("extension-") && !raw.includes("extension=")) issues.push("extension_separator_corrupt");
    if (raw.includes("stream-") && !raw.includes("stream=")) issues.push("stream_separator_corrupt");
    if (u.pathname.toLowerCase().includes("live.php") && !u.searchParams.has("stream")) {
      issues.push("missing_stream_param");
    }
    return {
      ok: issues.length === 0,
      issues,
      host: u.host,
      extension: u.searchParams.get("extension") || u.searchParams.get("ext") || "",
      stream: u.searchParams.get("stream") || "",
      hasStream: u.searchParams.has("stream"),
      hasPlayToken: u.searchParams.has("play_token"),
    };
  } catch (e) {
    return { ok: false, issues: ["invalid_url"], error: e && e.message ? e.message : "unknown" };
  }
}

function hlsIsAvailable() {
  return castVideoEl && typeof Hls !== "undefined" && Hls.isSupported();
}

function dashIsAvailable() {
  return castVideoEl && typeof dashjs !== "undefined";
}

function mpegtsIsAvailable() {
  return castVideoEl && typeof mpegts !== "undefined" && mpegts.isSupported();
}

function pickInitialUaIndex(url) {
  // VLC UA first for Xtream / live IPTV â€” closer to phone (LibVLC) and often required by CDNs.
  if (isXtreamStyleUrl(url) || isLikelyLiveStream(url)) return 0;
  return 1;
}

function rotateIptvUserAgent(reason) {
  activeIptvUaIndex = (activeIptvUaIndex + 1) % IPTV_USER_AGENTS.length;
  debugLog("network.ua.rotate", {
    reason,
    activeIptvUaIndex,
    userAgent: IPTV_USER_AGENTS[activeIptvUaIndex],
  });
}

function isProxyEnabled() {
  const proxyCfg = asObject(activeContract.proxy);
  return proxyCfg.enabled === true && String(proxyCfg.baseUrl || proxyCfg.manifestBaseUrl || "").trim() !== "";
}

function isStaticHosting() {
  const hosting = asObject(activeContract.hosting);
  if (hosting.mode === "static" || hosting.static === true) return true;
  try {
    const host = new URL(window.location.href).hostname.toLowerCase();
    return (
      host.endsWith(".github.io") ||
      host === "github.io" ||
      host.endsWith(".gitlab.io") ||
      host.endsWith(".pages.dev") ||
      host.endsWith(".netlify.app") ||
      host === "www.arishtech.com" ||
      host === "arishtech.com"
    );
  } catch (_e) {}
  return false;
}

function isVueottStyleUrl(url) {
  return isXtreamStyleUrl(url);
}

function xtreamNeedsDirectTsOnly() {
  const playback = asObject(activeContract.playback);
  if (playback.xtreamPreferTs === true || playback.vueottPreferTs === true) return true;
  return isStaticHosting() || !isProxyEnabled();
}

function toTsVariant(url) {
  return (
    rewriteQueryParam(url, "extension", "ts") ||
    rewriteQueryParam(url, "ext", "ts") ||
    appendQueryParam(url, "extension", "ts")
  );
}

function vueottNeedsDirectTsOnly() {
  return xtreamNeedsDirectTsOnly();
}

function tryEnableExplicitProxy(reason) {
  if (isProxyEnabled()) return true;
  const proxyCfg = asObject(activeContract.proxy);
  const explicitBase = String(proxyCfg.baseUrl || proxyCfg.manifestBaseUrl || "").trim();
  if (!explicitBase) {
    debugLog("proxy.unavailable", {
      reason,
      staticHosting: isStaticHosting(),
      message: "no_explicit_backend_proxy",
    });
    return false;
  }
  activeContract.proxy = Object.assign({}, proxyCfg, {
    enabled: true,
    baseUrl: explicitBase,
    manifestBaseUrl: String(proxyCfg.manifestBaseUrl || explicitBase).trim(),
    segmentBaseUrl: String(proxyCfg.segmentBaseUrl || explicitBase).trim(),
    licenseBaseUrl: String(proxyCfg.licenseBaseUrl || explicitBase).trim(),
  });
  debugLog("proxy.enabled", { reason, baseUrl: explicitBase });
  return true;
}

function summarizeHeaders(headers) {
  const h = asObject(headers);
  const keys = Object.keys(h);
  return { count: keys.length, keys };
}

function readSenderCandidateIndex(value) {
  if (value == null) return null;
  if (Number.isInteger(value)) return value;
  const parsed = parseInt(String(value).trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function asObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch (_e) {}
  }
  return {};
}

function isTruthyFlag(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.map((v) => String(v || "").trim()).filter((v) => v.length > 0)
    : [];
}

function normalizeContract(customData) {
  const root = asObject(customData);
  const play = asObject(root.playback);
  const sb = asObject(root.streamBootstrap);
  return {
    schemaVersion: Number(root.schemaVersion) || 1,
    auth: asObject(root.auth),
    token: asObject(root.token),
    proxy: asObject(root.proxy),
    networkPolicy: asObject(root.networkPolicy),
    hosting: asObject(root.hosting),
    playback: Object.assign({}, play, {
      phonePrimaryUrl: String(sb.phonePrimaryUrl || play.phonePrimaryUrl || "").trim(),
      preferReceiverEngine: String(sb.preferReceiverEngine || play.preferReceiverEngine || "").trim(),
    }),
    channelName: String(root.channelName || ""),
    debug: asObject(root.debug),
  };
}

function enableReceiverDebugUi() {
  try {
    if (typeof document !== "undefined" && document.body) {
      document.body.classList.add("receiver-debug");
    }
    window.__preettvReceiverDebugUiEnabled = true;
    if (statusEl) statusEl.style.removeProperty("display");
    if (typeof window.__preettvActivateDebugUi === "function") {
      window.__preettvActivateDebugUi();
    } else {
      window.__preettvPendingDebugUi = true;
    }
  } catch (_e) {}
}

function rewriteQueryParam(url, key, value) {
  try {
    const u = new URL(repairStreamUrl(url));
    if (!u.searchParams.has(key)) return null;
    u.searchParams.set(key, value);
    return normalizeCandidateUrl(u.toString());
  } catch (_e) {
    return null;
  }
}

function appendQueryParam(url, key, value) {
  try {
    const u = new URL(repairStreamUrl(url));
    u.searchParams.set(key, value);
    return normalizeCandidateUrl(u.toString());
  } catch (_e) {
    return null;
  }
}

function repairStreamUrl(url) {
  let out = String(url || "");
  if (!out) return out;

  const separatorFixes = [
    [/([?&])source_group-/gi, "$1source_group="],
    [/([?&])play_token-/gi, "$1play_token="],
    [/([?&])extension-/gi, "$1extension="],
    [/([?&])extension@/gi, "$1extension="],
    [/([?&])stream-/gi, "$1stream="],
    [/([?&])mac-/gi, "$1mac="],
    [/([?&])output-/gi, "$1output="],
    [/([?&])format-/gi, "$1format="],
    [/([?&])type-/gi, "$1type="],
    [/([?&])ext-(?!ension)/gi, "$1ext="],
    [/([?&])play_token@/gi, "$1play_token="],
    [/([?&])source_group@/gi, "$1source_group="],
    [/([?&])source_group\s+/gi, "$1source_group="],
    [/([?&])play_token\s+/gi, "$1play_token="],
    [/([?&])extension\s+/gi, "$1extension="],
  ];
  separatorFixes.forEach(([pattern, replacement]) => {
    out = out.replace(pattern, replacement);
  });

  out = out.replace(/source group/gi, "source_group");
  out = out.replace(/play token/gi, "play_token");
  out = out.replace(/(play_token=[^&\s]+)\s*source_group/gi, "$1&source_group");
  out = out.replace(/(play_token=[^&\s]+)source_group/gi, "$1&source_group=");

  out = out.replace(/\/play\/Live\.php/gi, "/play/live.php");
  out = out.replace(/([?&])nac-/gi, "$1mac=");
  out = out.replace(/([?&])stream(\d{3,})(?=[&]|$)/gi, "$1stream=$2");
  out = out.replace(/([?&])extensions=/gi, "$1extension=");
  out = out.replace(/([?&])extensions([^=&/])/gi, "$1extension=$2");
  out = out.replace(/play the /gi, "play_token=");
  out = out.replace(/play to /gi, "play_token=");
  out = out.replace(/Sksource_group/gi, "source_group");
  out = out.replace(/&source group/gi, "&source_group");
  out = out.replace(/line\.vwe+ott\.com/gi, "line.vueott.com");
  out = out.replace(/line\.wue+ott\.com/gi, "line.vueott.com");
  out = out.replace(/line\.vue+stt\.com/gi, "line.vueott.com");

  return out;
}

function toM3u8Variant(url) {
  const repaired = repairStreamUrl(url);
  const rewritten = rewriteQueryParam(repaired, "extension", "m3u8")
    || rewriteQueryParam(repaired, "ext", "m3u8");
  if (rewritten) return normalizeCandidateUrl(rewritten);
  return normalizeCandidateUrl(appendQueryParam(repaired, "extension", "m3u8") || repaired);
}

function normalizeCandidateUrl(url) {
  const input = repairStreamUrl(String(url || ""));
  if (!input) return input;

  let out = input
    .replace(/([?&])ext-m3u8(?=&|$)/gi, "$1ext=m3u8")
    .replace(/([?&])extension-m3u8(?=&|$)/gi, "$1extension=m3u8")
    .replace(/([?&])output-m3u8(?=&|$)/gi, "$1output=m3u8")
    .replace(/([?&])type-m3u8(?=&|$)/gi, "$1type=m3u8")
    .replace(/([?&])format-hls(?=&|$)/gi, "$1format=hls");

  try {
    const u = new URL(out);
    return u.toString();
  } catch (_e) {
    return out;
  }
}

function inferContentType(url) {
  const lower = (url || "").toLowerCase();
  try {
    const u = new URL(url);
    const ext = (u.searchParams.get("extension") || u.searchParams.get("ext") || "").toLowerCase();
    const type = (u.searchParams.get("type") || u.searchParams.get("output") || u.searchParams.get("format") || "").toLowerCase();
    // Explicit extension=ts must win over format=hls / type=m3u8 on the same query (bad combos
    // from stacked fallbacks confuse CAF/Shaka and MEDIA_STATUS flips mpegURL vs mp2t).
    if (ext === "ts" || lower.endsWith(".ts")) return "video/mp2t";
    if (lower.endsWith(".m3u8") || ext === "m3u8" || type === "m3u8" || type === "hls") return "application/x-mpegURL";
    if (lower.endsWith(".mpd") || ext === "mpd" || type === "mpd" || type === "dash") return "application/dash+xml";
    if (type === "ts") return "video/mp2t";
    if (lower.endsWith(".mp4") || ext === "mp4" || type === "mp4") return "video/mp4";
    if (lower.endsWith(".webm") || ext === "webm" || type === "webm") return "video/webm";
  } catch (_e) {}
  return "video/*";
}

/** Drop format=/type=/output= HLS hints when extension is TS (avoids hybrid URLs that confuse CAF). */
function stripConflictingHlsHintsOnTsUrl(url) {
  try {
    const u = new URL(repairStreamUrl(String(url || "").trim()));
    const ext = (u.searchParams.get("extension") || u.searchParams.get("ext") || "").toLowerCase();
    if (ext !== "ts") return String(url);
    let changed = false;
    ["format", "type", "output"].forEach((key) => {
      const v = (u.searchParams.get(key) || "").toLowerCase();
      if (v === "hls" || v === "m3u8") {
        u.searchParams.delete(key);
        changed = true;
      }
    });
    return changed ? u.toString() : String(url);
  } catch (_e) {
    return String(url || "");
  }
}

/** In static TS-only mode, optionally lead with m3u8 when the phone prefers HLS (VLC-style live.php). */
function phoneReceiverWantsM3u8BeforeTsForLivePhp(baseUrl, customData) {
  if (!isXtreamStyleUrl(baseUrl)) return false;
  if (!xtreamNeedsDirectTsOnly()) return false;
  const lower = String(baseUrl || "").toLowerCase();
  if (!lower.includes("/live.php")) return false;
  const root = asObject(customData);
  const sb = asObject(root.streamBootstrap);
  const pb = asObject(root.playback);
  const pref = String(sb.preferReceiverEngine || pb.preferReceiverEngine || "").toLowerCase();
  if (pref === "hlsjs") return true;
  if (pref === "caf-ts" || pref === "mpegts" || pref === "dashjs") return false;
  if (isTruthyFlag(pb.phonePlayingAsHls) && !isTruthyFlag(pb.phonePlayingAsTs)) return true;
  return false;
}

function buildCompatibilityCandidates(baseUrl, customData) {
  const candidates = [];
  const seen = new Set();
  const push = (value) => {
    const normalized = normalizeCandidateUrl(stripConflictingHlsHintsOnTsUrl(value));
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  const phoneResolved = String((customData && customData.phoneResolvedUrl) || "").trim();
  if (phoneResolved) {
    push(phoneResolved);
  }

  const phonePrimary = String((customData && customData.streamBootstrap && customData.streamBootstrap.phonePrimaryUrl) || "").trim();
  if (phonePrimary) {
    push(phonePrimary);
  }

  baseUrl = normalizeCandidateUrl(stripConflictingHlsHintsOnTsUrl(baseUrl));
  const lower = (baseUrl || "").toLowerCase();
  const looksLikeLivePhp = lower.includes("/live.php");
  const looksLikeLivePlayPath = /\/live\/play\//.test(lower);
  let extensionHint = "";
  try {
    const u = new URL(baseUrl);
    extensionHint = (u.searchParams.get("extension") || u.searchParams.get("ext") || "").toLowerCase();
  } catch (_e) {}

  const looksTs = extensionHint === "ts" || lower.endsWith(".ts");
  const looksHls = extensionHint === "m3u8" || lower.endsWith(".m3u8");
  const isXtreamStyle = isXtreamStyleUrl(baseUrl);
  const xtreamTsOnly = isXtreamStyle && xtreamNeedsDirectTsOnly();
  const senderCandidates = customData && Array.isArray(customData.candidateUrls) ? customData.candidateUrls : [];

  // Sender-ranked URLs before local expansions (live.php /live/play/ query hacks, etc.) so
  // simple streams and non-token URLs match phone order; avoids several wrong attempts first.
  if (!xtreamTsOnly) {
    senderCandidates.forEach((candidateUrl) => push(candidateUrl));
  }

  if (xtreamTsOnly) {
    if (phoneReceiverWantsM3u8BeforeTsForLivePhp(baseUrl, customData)) {
      const m3u8Lead = toM3u8Variant(baseUrl);
      if (m3u8Lead) {
        push(m3u8Lead);
        push(appendQueryParam(m3u8Lead, "type", "m3u8"));
        push(appendQueryParam(m3u8Lead, "output", "m3u8"));
        push(appendQueryParam(m3u8Lead, "format", "hls"));
      }
    }
    // Static Cast receivers cannot proxy; many Xtream m3u8 endpoints return HTTP 458 on Cast.
    push(toTsVariant(baseUrl) || normalizeCandidateUrl(baseUrl));
    if (looksTs) {
      push(normalizeCandidateUrl(baseUrl));
    }
  } else if (isXtreamStyle) {
    push(toTsVariant(baseUrl) || normalizeCandidateUrl(baseUrl));
    push(normalizeCandidateUrl(baseUrl));
    const m3u8Base = looksHls ? normalizeCandidateUrl(baseUrl) : toM3u8Variant(baseUrl);
    push(m3u8Base);
    push(appendQueryParam(m3u8Base, "type", "m3u8"));
    push(appendQueryParam(m3u8Base, "output", "m3u8"));
    push(appendQueryParam(m3u8Base, "format", "hls"));
  } else if (looksTs) {
    const m3u8Base = toM3u8Variant(baseUrl);
    push(m3u8Base);
    push(appendQueryParam(m3u8Base, "type", "m3u8"));
    push(appendQueryParam(m3u8Base, "output", "m3u8"));
    push(appendQueryParam(m3u8Base, "format", "hls"));
    push(normalizeCandidateUrl(baseUrl));
  } else {
    push(normalizeCandidateUrl(baseUrl));
  }

  if (looksLikeLivePhp && !extensionHint && !xtreamTsOnly) {
    push(appendQueryParam(baseUrl, "extension", "m3u8"));
    push(appendQueryParam(baseUrl, "extension", "ts"));
    push(appendQueryParam(baseUrl, "type", "m3u8"));
    push(appendQueryParam(baseUrl, "output", "m3u8"));
    push(appendQueryParam(baseUrl, "format", "hls"));
  }

  if (looksLikeLivePlayPath) {
    try {
      const u = new URL(baseUrl);
      const pathname = u.pathname || "";
      if (!pathname.toLowerCase().endsWith(".m3u8")) {
        const withM3u8Path = new URL(baseUrl);
        withM3u8Path.pathname = `${pathname}.m3u8`;
        push(withM3u8Path.toString());
      }
      // Query-style HLS hints (some CDNs match phone clients that send extension/type only).
      push(appendQueryParam(baseUrl, "extension", "m3u8"));
      push(appendQueryParam(baseUrl, "type", "m3u8"));
      push(appendQueryParam(baseUrl, "output", "hls"));
      push(appendQueryParam(baseUrl, "format", "hls"));
    } catch (_e) {}
  }

  if (looksHls && !xtreamTsOnly) {
    push(rewriteQueryParam(baseUrl, "extension", "ts"));
    push(rewriteQueryParam(baseUrl, "ext", "ts"));
  }

  if (xtreamTsOnly && senderCandidates.length) {
    senderCandidates.forEach((candidateUrl) => {
      if (isTsCandidate(candidateUrl)) {
        push(candidateUrl);
        return;
      }
      const tsOnly = toTsVariant(candidateUrl);
      if (tsOnly) push(tsOnly);
    });
  }

  if (isXtreamStyle && xtreamTsOnly && looksLikeLivePhp && !looksTs && !looksHls) {
    push(appendQueryParam(baseUrl, "extension", "ts"));
  }

  // TS-only mode prefers direct TS first (458 on m3u8 fetch is common), but if TS never plays
  // we still need HLS variants as later candidates — otherwise candidateCount stays 1 and we exhaust.
  if (xtreamTsOnly && isXtreamStyle) {
    const m3u8Base = toM3u8Variant(baseUrl);
    if (m3u8Base) {
      push(m3u8Base);
      push(appendQueryParam(m3u8Base, "type", "m3u8"));
      push(appendQueryParam(m3u8Base, "output", "m3u8"));
      push(appendQueryParam(m3u8Base, "format", "hls"));
    }
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

function applyDefaultIptvHeaders(networkRequestInfo) {
  const headers = asObject(networkRequestInfo.headers);
  const hasUserAgent = Object.keys(headers).some((name) => name.toLowerCase() === "user-agent");
  if (!hasUserAgent) {
    headers["User-Agent"] = IPTV_USER_AGENTS[activeIptvUaIndex] || DEFAULT_IPTV_USER_AGENT;
  }

  try {
    const origin = new URL(String(networkRequestInfo.url || ""));
    const referer = `${origin.protocol}//${origin.host}/`;
    const hasReferer = Object.keys(headers).some((name) => name.toLowerCase() === "referer");
    if (!hasReferer) {
      headers["Referer"] = referer;
    }
  } catch (_e) {}

  networkRequestInfo.headers = headers;
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

function classifyHlsRequestType(url) {
  const lower = String(url || "").toLowerCase();
  if (
    lower.includes(".m3u8") ||
    lower.includes("extension=m3u8") ||
    lower.includes("ext=m3u8") ||
    lower.includes("type=m3u8") ||
    lower.includes("output=m3u8") ||
    lower.includes("format=hls") ||
    lower.includes("playlist")
  ) {
    return "manifest";
  }
  return "segment";
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
    applyDefaultIptvHeaders(networkRequestInfo);

    const after = {
      requestType,
      url: String(networkRequestInfo.url || ""),
      headers: summarizeHeaders(networkRequestInfo.headers),
    };
    if (after.headers.count > 0 || before.url !== after.url) {
      debugLog("network.policy.applied", { before, after });
    }
  } catch (e) {
    setStatus(`Network policy hook failed (${requestType}): ${e && e.message ? e.message : "unknown"}`);
    debugLog("network.policy.error", {
      requestType,
      message: e && e.message ? e.message : "unknown",
    });
  }
}

function hlsIsAvailable() {
  return castVideoEl && typeof Hls !== "undefined" && Hls.isSupported();
}

function dashIsAvailable() {
  return castVideoEl && typeof dashjs !== "undefined";
}

function mpegtsIsAvailable() {
  return castVideoEl && typeof mpegts !== "undefined" && mpegts.isSupported();
}

function buildHlsJsConfig() {
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
      Object.keys(asObject(info.headers)).forEach((k) => {
        try {
          xhr.setRequestHeader(k, info.headers[k]);
        } catch (_e) {}
      });
    },
  };
}

function hlsLive() {
  return hlsInstance && hlsInstance.__preetInvocation === hlsJsInvocationCounter;
}

function safeHlsLoadSource(url, label) {
  if (!hlsInstance || !hlsLive()) {
    debugLog("hlsjs.loadSource.skipped", { label, url });
    return false;
  }
  try {
    hlsInstance.loadSource(url);
    debugLog("hlsjs.loadSource", { label, url });
    return true;
  } catch (e) {
    debugLog("hlsjs.loadSource.error", { label, message: e && e.message ? e.message : "unknown" });
    return false;
  }
}

function startHlsJsPlayback(rawSourceUrl, selectedLoad) {
  const sourceUrl = normalizeCandidateUrl(rawSourceUrl);
  return new Promise((resolve, reject) => {
    destroyHls();
    destroyDash();
    destroyMpegts();
    clearCustomPlayer();
    pendingCustomPlayerBoot = "hlsjs";

    if (!hlsIsAvailable()) {
      pendingCustomPlayerBoot = null;
      reject(new Error("hlsjs unavailable"));
      return;
    }

    const myId = ++hlsJsInvocationCounter;
    let settled = false;
    let hlsUaAttempts = 0;
    let mediaAttached = false;
    let manifestParsed = false;
    const bootDeadline = setTimeout(() => {
      if (settled) return;
      failPreload("hlsjs boot timeout (no manifest/blob)");
    }, 35000);

    function failPreload(reason) {
      if (settled) return;
      settled = true;
      clearTimeout(bootDeadline);
      pendingCustomPlayerBoot = null;
      clearStallWatchdog();
      destroyHls();
      reject(new Error(reason || "hlsjs preload failed"));
    }

    function settle(finalized) {
      if (settled) return;
      settled = true;
      clearTimeout(bootDeadline);
      pendingCustomPlayerBoot = null;
      clearStallWatchdog();
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
          index: activeCandidateIndex,
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

    hlsInstance = new Hls(buildHlsJsConfig());
    hlsInstance.__preetInvocation = myId;

    hlsInstance.on(Hls.Events.ERROR, (_evt, data) => {
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
      void handleCustomInterceptorFailure("hlsjs", new Error(data.details || "fatal"), selectedLoad, sourceUrl);
    });

    hlsInstance.once(Hls.Events.MEDIA_ATTACHED, () => {
      mediaAttached = true;
      debugLog("hlsjs.media_attached", { url: sourceUrl });
      trySettleAfterReady();
    });

    hlsInstance.once(Hls.Events.MANIFEST_PARSED, () => {
      manifestParsed = true;
      debugLog("hlsjs.manifest_parsed", { url: sourceUrl });
      trySettleAfterReady();
    });

    armStallWatchdog("hlsjs.start");
    hlsInstance.attachMedia(castVideoEl);
    if (!safeHlsLoadSource(resolveFetchUrl(sourceUrl, "manifest"), "hlsjs_immediate")) {
      failPreload("hlsjs loadSource failed");
    }
  });
}

function startMpegtsPlayback(rawSourceUrl, selectedLoad) {
  const sourceUrl = normalizeCandidateUrl(rawSourceUrl);
  return new Promise((resolve, reject) => {
    destroyHls();
    destroyDash();
    destroyMpegts();
    clearCustomPlayer();
    pendingCustomPlayerBoot = "mpegts";

    if (!mpegtsIsAvailable()) {
      pendingCustomPlayerBoot = null;
      reject(new Error("mpegts unavailable"));
      return;
    }

    let settled = false;
    let mpegtsUaAttempts = 0;

    function failPreload(reason) {
      if (settled) return;
      settled = true;
      pendingCustomPlayerBoot = null;
      clearStallWatchdog();
      destroyMpegts();
      reject(new Error(reason || "mpegts preload failed"));
    }

    function settle() {
      if (settled) return;
      settled = true;
      pendingCustomPlayerBoot = null;
      clearStallWatchdog();
      resolve();
    }

    function beginMpegtsSession() {
      const playbackUrl = resolveFetchUrl(sourceUrl, "segment");
      const headers = buildIptvRequestHeaders(sourceUrl);
      destroyMpegts();
      installIptvNetworkShim(sourceUrl);
      mpegtsInstance = mpegts.createPlayer(
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

      mpegtsInstance.on(mpegts.Events.ERROR, (errorType, errorDetail) => {
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
        void handleCustomInterceptorFailure(
          "mpegts",
          new Error(String(errorDetail || errorType)),
          selectedLoad,
          sourceUrl
        );
      });

      armStallWatchdog("mpegts.start");
      mpegtsInstance.attachMediaElement(castVideoEl);
      mpegtsInstance.load();
      const pr = mpegtsInstance.play();
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
    }

    try {
      beginMpegtsSession();
    } catch (e) {
      failPreload(e && e.message ? e.message : "mpegts attach");
    }
  });
}

function startDashJsPlayback(sourceUrl, selectedLoad) {
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
    dashInstance = dashjs.MediaPlayer().create();
    dashInstance.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
      if (settled) return;
      settled = true;
      clearStallWatchdog();
      const finalized = finalizeCustomPlayerLoad(selectedLoad, sourceUrl, "dashjs");
      dashInstance.play();
      setStatus("Playing (DASH)");
      resolve(finalized);
    });
    dashInstance.on(dashjs.MediaPlayer.events.ERROR, () => {
      if (settled) return;
      settled = true;
      clearStallWatchdog();
      void handleCustomInterceptorFailure("dashjs", new Error("dash error"), selectedLoad, sourceUrl);
      resolve(selectedLoad);
    });
    armStallWatchdog("dashjs.start");
    dashInstance.attachView(castVideoEl);
    dashInstance.attachSource(resolveFetchUrl(sourceUrl, "manifest"));
  });
}

async function tryNativeCafHlsReload(sourceUrl) {
  if (!lastLoadTemplate || !playerManager) throw new Error("missing_template");
  destroyHls();
  destroyDash();
  destroyMpegts();
  clearCustomPlayer();
  pendingCustomPlayerBoot = null;
  const normalized = normalizeCandidateUrl(sourceUrl);
  const sel = prepareLoadForCandidate(lastLoadTemplate, normalized, activeCandidateIndex);
  sel.media = Object.assign({}, sel.media, {
    contentId: normalized,
    contentUrl: normalized,
    contentType: "application/x-mpegURL",
    streamType: cast.framework.messages.StreamType.LIVE,
  });
  const req = playerManager.load(sel);
  if (req && typeof req.then === "function") await req;
}

async function tryNativeCafTsReload(sourceUrl) {
  if (!lastLoadTemplate || !playerManager) throw new Error("missing_template");
  destroyHls();
  destroyDash();
  destroyMpegts();
  clearCustomPlayer();
  pendingCustomPlayerBoot = null;
  const nativeLoad = buildCafNativeTsLoad(
    prepareLoadForCandidate(lastLoadTemplate, normalizeCandidateUrl(sourceUrl), activeCandidateIndex),
    sourceUrl
  );
  const req = playerManager.load(nativeLoad);
  if (req && typeof req.then === "function") await req;
}

async function handleCustomInterceptorFailure(playerType, err, selectedLoad, sourceUrl) {
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
    if (playerType === "mpegts" && isTsCandidate(sourceUrl) && useCastReceiver) {
      await tryNativeCafTsReload(sourceUrl);
      return;
    }
  } catch (e) {
    debugLog(playerType + ".native_fallback_failed", { message: serializeReceiverError(e) });
  }

  await advanceCandidateAfterCustomFailure(playerType + "_failed");
}

async function advanceCandidateAfterCustomFailure(reason) {
  if (candidateAdvanceInFlight || candidatesExhausted) return false;
  candidateAdvanceInFlight = true;
  pendingCustomPlayerBoot = null;
  try {
    if (activeCandidateIndex >= activeCandidates.length - 1) {
      markCandidatesExhausted(reason);
      return false;
    }
    await tryLoadNextCandidateOnReceiverError(reason);
    return true;
  } finally {
    candidateAdvanceInFlight = false;
  }
}

async function tryLoadNextCandidateOnReceiverError(reason) {
  clearStallWatchdog();
  destroyHls();
  destroyDash();
  destroyMpegts();
  clearCustomPlayer();

  if (!lastLoadTemplate || candidatesExhausted) return;

  async function attemptReceiverCandidateLoad(url, index, sourceTag) {
    const load = prepareLoadForCandidate(lastLoadTemplate, url, index);
    const isRewind = sourceTag === "rewind";
    const label = isRewind
      ? `Trying earlier format (${index + 1}/${activeCandidates.length})…`
      : `Retrying ${index + 1}/${activeCandidates.length}…`;
    showLoader(label);
    setStatus(label);
    debugLog(isRewind ? "candidate.rewind" : "candidate.retry", {
      reason,
      nextIndex: index,
      nextUrl: url,
      strategy: getPlaybackStrategy(url),
    });
    armStallWatchdog(isRewind ? "candidate.rewind" : "candidate.retry");
    const req = playerManager.load(load);
    if (req && typeof req.then === "function") await req;
  }

  if (activeCandidateIndex >= activeCandidates.length - 1) {
    if (!receiverBackwardFallbackUsed && loadSessionPreferredStartIndex > 0 && activeCandidates.length > 1) {
      receiverBackwardFallbackUsed = true;
      activeCandidateIndex = 0;
      rotateIptvUserAgent("candidate_rewind");
      try {
        await attemptReceiverCandidateLoad(activeCandidates[0], 0, "rewind");
      } catch (e) {
        markCandidatesExhausted("candidate_rewind_failed");
      }
      return;
    }
    markCandidatesExhausted(reason);
    return;
  }

  activeCandidateIndex += 1;
  rotateIptvUserAgent("candidate_retry");
  const nextUrl = activeCandidates[activeCandidateIndex];
  try {
    await attemptReceiverCandidateLoad(nextUrl, activeCandidateIndex, "forward");
  } catch (e) {
    setStatus(`Receiver retry failed: ${serializeReceiverError(e)}`);
    if (activeCandidateIndex >= activeCandidates.length - 1) markCandidatesExhausted("candidate_retry_failed");
  }
}

if (useCastReceiver) {
  playerManager.setMessageInterceptor(cast.framework.messages.MessageType.LOAD, (loadRequestData) => {
    try {
      const media = loadRequestData.media || {};
      const customData = asObject(loadRequestData.customData);
      const streamFromCustom = String(customData.streamUrl || "").trim();
      const rawBaseUrl = String(
        customData._retryBaseUrl ||
          media.contentUrl ||
          media.contentId ||
          streamFromCustom ||
          ""
      );
      if (!rawBaseUrl) {
        debugLog("load.rejected_empty_url", { hasCustomData: Object.keys(customData).length > 0 });
        return loadRequestData;
      }

      const baseUrl = normalizeCandidateUrl(rawBaseUrl);
      activeContract = normalizeContract(customData);
      activeContract.channelName = String(customData.channelName || activeContract.channelName || "");
      applyDebugConfigFromContract(activeContract, customData);
      updateCastChannelNameUi(activeContract.channelName);

      showLoader("Loading stream…");
      candidatesExhausted = false;
      receiverBackwardFallbackUsed = false;
      activeIptvUaIndex = pickInitialUaIndex(baseUrl);

      debugLog("load.received", {
        mediaContentUrl: baseUrl,
        preferReceiverEngine: activeContract.playback && activeContract.playback.preferReceiverEngine,
        audit: auditNetworkEnvironment(baseUrl),
      });

      if (playerManager && typeof playerManager.setPlaybackConfig === "function") {
        playerManager.setPlaybackConfig(createPlaybackConfig());
      }
      ensureShakaRequestFilters();

      activeCandidates = buildCompatibilityCandidates(baseUrl, customData).map((c) => normalizeCandidateUrl(c));
      if (activeCandidates.length === 0) activeCandidates = [baseUrl];

      if (customData._retryCandidateIndex != null) {
        const ri = readSenderCandidateIndex(customData._retryCandidateIndex);
        activeCandidateIndex =
          ri != null ? Math.max(0, Math.min(ri, activeCandidates.length - 1)) : 0;
      } else {
        const normalizedBase = normalizeCandidateUrl(baseUrl);
        const matchIdx = activeCandidates.findIndex((c) => normalizeCandidateUrl(c) === normalizedBase);
        if (matchIdx >= 0) activeCandidateIndex = matchIdx;
        else {
          const ci = readSenderCandidateIndex(customData.candidateIndex);
          activeCandidateIndex =
            ci != null ? Math.max(0, Math.min(ci, activeCandidates.length - 1)) : 0;
        }
      }
      loadSessionPreferredStartIndex = activeCandidateIndex;

      const selectedUrl = normalizeCandidateUrl(activeCandidates[activeCandidateIndex] || baseUrl);
      activeCandidates[activeCandidateIndex] = selectedUrl;
      const selectedLoad = prepareLoadForCandidate(loadRequestData, selectedUrl);
      if ((selectedUrl || "").toLowerCase().includes("/live.php") || isLikelyLiveStream(selectedUrl)) {
        selectedLoad.media.streamType = cast.framework.messages.StreamType.LIVE;
      }
      selectedLoad.customData = Object.assign({}, asObject(selectedLoad.customData), { _retryBaseUrl: baseUrl });
      lastLoadTemplate = loadRequestData;

      let strategy = getPlaybackStrategy(selectedUrl);
      if (strategy === "caf-ts" && mpegtsIsAvailable()) {
        strategy = "mpegts";
        debugLog("load.strategy.ts_use_mpegts", { selectedUrl });
      }
      debugLog("load.candidates", {
        selectedIndex: activeCandidateIndex,
        selectedUrl,
        candidateCount: activeCandidates.length,
        strategy,
      });

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
        void startMpegtsPlayback(selectedUrl, stubLoad).catch((err) => {
          void handleCustomInterceptorFailure("mpegts", err, stubLoad, selectedUrl);
        });
        return stubLoad;
      }

      if (strategy === "hlsjs") {
        const stubLoad = prepareCustomPlayerStubLoad(selectedLoad, selectedUrl, "hlsjs");
        void startHlsJsPlayback(selectedUrl, stubLoad).catch((err) => {
          void handleCustomInterceptorFailure("hlsjs", err, stubLoad, selectedUrl);
        });
        return stubLoad;
      }

      if (strategy === "dashjs") {
        const stubLoad = prepareCustomPlayerStubLoad(selectedLoad, selectedUrl, "dashjs");
        void startDashJsPlayback(selectedUrl, stubLoad).then((fin) => {
          if (fin && fin.media && fin.media.contentUrl === CUSTOM_PLAYER_STUB_URL) {
            void playerManager.load(fin).catch((e) => debugLog("dashjs.load.error", { message: serializeReceiverError(e) }));
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
    if (candidatesExhausted || candidateAdvanceInFlight) return;
    // CAF often emits benign errors while about:blank stub + Hls.js/mpegts attach; never advance candidates during that window.
    if (pendingCustomPlayerBoot) {
      debugLog("player.error.suppressed_pending_boot", {
        errorCode,
        pendingCustomPlayerBoot,
        reason: event && event.reason ? String(event.reason) : "",
      });
      return;
    }
    if (activeCustomPlayer && (errorCode === 905 || errorCode === 104 || errorCode === 301 || errorCode === 101)) {
      debugLog("player.error.suppressed_custom", { errorCode, activeCustomPlayer });
      return;
    }
    debugLog("player.error", { errorCode, reason: event && event.reason ? event.reason : "" });
    void tryLoadNextCandidateOnReceiverError("player_error_" + errorCode);
  }, "ERROR");
}

function initBrowserPlayback() {
  let bcCandidates = [];
  let bcCandidateIndex = 0;

  function browserLoadCandidate(candidateUrl) {
    if (!candidateUrl || !castVideoEl) return;
    destroyHls();
    destroyDash();
    destroyMpegts();
    castVideoEl.removeAttribute("src");
    castVideoEl.load();

    if (isDashCandidate(candidateUrl)) {
      dashInstance = dashjs.MediaPlayer().create();
      dashInstance.attachView(castVideoEl);
      dashInstance.attachSource(candidateUrl);
      dashInstance.play();
      setStatus("Browser: DASH");
      return;
    }
    if (isHlsCandidate(candidateUrl) && hlsIsAvailable()) {
      hlsInstance = new Hls(buildHlsJsConfig());
      hlsInstance.attachMedia(castVideoEl);
      hlsInstance.loadSource(candidateUrl);
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        castVideoEl.play().catch(() => {});
      });
      setStatus("Browser: HLS");
      return;
    }
    if (isTsCandidate(candidateUrl) && mpegtsIsAvailable()) {
      mpegtsInstance = mpegts.createPlayer(
        { type: "mpegts", isLive: true, url: candidateUrl, hasAudio: true, hasVideo: true },
        buildMpegtsPlayerConfig()
      );
      mpegtsInstance.attachMediaElement(castVideoEl);
      mpegtsInstance.load();
      mpegtsInstance.play().catch(() => {});
      setStatus("Browser: MPEG-TS");
      return;
    }
    castVideoEl.src = candidateUrl;
    castVideoEl.play().catch(() => {});
    setStatus("Browser: progressive");
  }

  function browserLoadUrl(url) {
    if (!url) return;
    bcCandidates = buildCompatibilityCandidates(url, {});
    bcCandidateIndex = 0;
    browserLoadCandidate(bcCandidates[0] || url);
  }

  window.__bcLoadUrl = browserLoadUrl;
  window.__bcStop = function () {
    destroyHls();
    destroyDash();
    destroyMpegts();
    if (castVideoEl) {
      castVideoEl.removeAttribute("src");
      castVideoEl.load();
    }
    setStatus("Stopped");
  };
  window.__getStreamUrlFromPage = getStreamUrlFromPage;

  window.bcLoad = function () {
    const input = document.getElementById("bcStreamUrl");
    const v = input && input.value ? input.value.trim() : "";
    if (v) browserLoadUrl(v);
  };
  window.bcStop = function () {
    window.__bcStop();
  };

  try {
    const u = getStreamUrlFromPage();
    if (u) browserLoadUrl(u);
  } catch (_e) {}
}

window.addEventListener("unhandledrejection", (ev) => {
  const reason = ev && ev.reason;
  const message = reason && reason.message ? reason.message : String(reason || "unknown");
  debugLog("receiver.unhandledrejection", { reason: message });
  if (message === "HttpStatusCodeInvalid" || message.includes("HttpStatusCodeInvalid")) {
    if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
  }
});

if (useCastReceiver) {
  context.start({ playbackConfig: createPlaybackConfig() });
  installVolumeBridge();
  setBrandingVisible(true);
  setStatus("PreetTV receiver started");
  debugLog("receiver.started", {
    href: window.location.href,
    hlsJs: typeof Hls !== "undefined",
    dashjs: typeof dashjs !== "undefined",
    mpegts: typeof mpegts !== "undefined",
  });
} else {
  initBrowserPlayback();
}
