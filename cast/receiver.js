/* global cast, Hls, dashjs, mpegts */

const castGlobal = typeof window !== "undefined" ? window.cast : undefined;
const hasCastFramework = !!(
  castGlobal &&
  castGlobal.framework &&
  castGlobal.framework.CastReceiverContext
);

const context = hasCastFramework
  ? castGlobal.framework.CastReceiverContext.getInstance()
  : null;
const playerManager = context ? context.getPlayerManager() : null;
const statusEl = document.getElementById("status");
const brandEl = document.getElementById("preetBrand");
const loaderEl = document.getElementById("preetLoader");
const loaderTextEl = document.getElementById("preetLoaderText");

// Extract stream URL from ?url=... even when the target URL has its own query string.
// URLSearchParams.get("url") truncates at the first "&" — e.g. drops &stream= &extension=.
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
const DEFAULT_DEBUG_ENABLED = false;

window.__preettvDebug = debugHistory;
debugEnabled = DEFAULT_DEBUG_ENABLED || DEBUG_QUERY_FLAG;

let activeCandidates = [];
let activeCandidateIndex = 0;
let lastLoadTemplate = null;
let stallWatchdogTimer = null;
let stallWatchdogSerial = 0;
const STALL_WATCHDOG_MS = 12000;
const PLAYBACK_STALL_MS = 45000;
let playbackKeepaliveTimer = null;
let lastPlaybackProgressAt = 0;
let hlsDriftTimer = null;
let avSyncTimer = null;
let avSyncProgressVideoTime = -1;
let avSyncProgressWallMs = 0;
let avSyncLastNudgeMs = 0;
let avSyncNudgeCount = 0;
let avSyncNudgeWindowStart = 0;
let avSyncMpegtsSlowStreak = 0;
let avSyncPlaybackRateTimer = null;
const AV_SYNC_INTERVAL_MS = 3000;
const AV_SYNC_WALL_STALL_MS = 5000;
const AV_SYNC_TIME_TOLERANCE_S = 0.15;
const AV_SYNC_BUFFER_LAG_SOFT_S = 3.5;
const AV_SYNC_BUFFER_LAG_HARD_S = 7;
const AV_SYNC_HLS_LATENCY_MAX_S = 9;
const AV_SYNC_NUDGE_COOLDOWN_MS = 4500;
const AV_SYNC_MAX_NUDGES_PER_MIN = 6;
const AV_SYNC_MPEGTS_MIN_SPEED = 0.72;
let volumeBridgeInstalled = false;

let hlsInstance = null;
let dashInstance = null;
let mpegtsInstance = null;

// When a JS player owns playback, CAF native errors must be ignored.
let activeCustomPlayer = null; // null | "hlsjs" | "dashjs" | "mpegts"
let activeCustomPlayerUrl = "";
let hlsJsFallbackUsedForIndex = -1;
let pendingCustomPlayerBoot = null;
let candidateAdvanceInFlight = false;
let candidatesExhausted = false;
let iptvDirectBlocked458 = false;
let vueottCafNativeAttempted = false;
let vueottMpegtsAfterCafAttempted = false;

window.addEventListener("unhandledrejection", (ev) => {
  const reason = ev && ev.reason;
  const message = reason && reason.message ? reason.message : String(reason || "unknown");
  if (typeof debugLog === "function") {
    debugLog("receiver.unhandledrejection", { reason: message });
  }
  if (
    message === "HttpStatusCodeInvalid" ||
    message.includes("HttpStatusCodeInvalid") ||
    message.includes("ReadableStream") ||
    message.includes("locked stream")
  ) {
    if (ev && typeof ev.preventDefault === "function") {
      ev.preventDefault();
    }
  }
});

let activeContract = {
  schemaVersion: 1,
  auth: {},
  token: {},
  proxy: {},
  networkPolicy: {},
};

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
  if (isProgressiveCandidate(url)) return "native";
  if (isDashCandidate(url)) return "dashjs";
  if (isTsCandidate(url)) {
    // CAF segment handlers can set User-Agent; browser fetch/mpegts cannot reliably.
    if (useCastReceiver) return "caf-ts";
    return "mpegts";
  }
  // IPTV/Xtream m3u8 playlists usually carry MPEG-TS segments — avoid CAF native HLS (905).
  if (isHlsCandidate(url)) {
    if (isXtreamStyleUrl(url) || isLikelyLiveStream(url) || forBrowser) return "hlsjs";
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
  if (isXtreamStyleUrl(url)) return 0;
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

function resolveFetchUrl(url, requestType) {
  const normalized = normalizeCandidateUrl(url);
  if (!isProxyEnabled()) {
    return normalized;
  }
  // Vueott often returns HTTP 458 for m3u8 from Cast, but raw TS may work direct.
  if (isTsCandidate(normalized)) {
    return normalized;
  }
  const netInfo = { url: normalized, headers: {} };
  applyProxyPolicy(netInfo, requestType || "manifest");
  return netInfo.url;
}

function probeIndicates458Block(attempts) {
  const list = Array.isArray(attempts) ? attempts : [];
  if (list.length === 0) return false;
  return list.every((item) => Number(item.status) === 458 && !item.hasBody && !item.playlist);
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

function hasBinaryBody(data) {
  return data && typeof data.byteLength === "number" && data.byteLength > 0;
}

function hasTextBody(data) {
  return typeof data === "string" && data.length > 0;
}

function isPlaylistText(data) {
  return typeof data === "string" && data.indexOf("#EXTM3U") >= 0;
}

function iptvHttpGet(url, options) {
  const target = normalizeCandidateUrl(url);
  const responseType = options && options.responseType === "arraybuffer" ? "arraybuffer" : "text";
  const probeOnly = !!(options && options.probeOnly);
  const uaStart = options && Number.isInteger(options.uaStart) ? options.uaStart : activeIptvUaIndex;
  const attempts = [];

  function cancelResponseBody(response) {
    if (!response || !response.body) return;
    try {
      if (typeof response.body.cancel === "function") {
        response.body.cancel();
      }
    } catch (_e) {}
  }

  function tryUa(uaIndex) {
    const headerPack = buildFetchRequestHeaders(target, uaIndex);
    const headers = headerPack.headers;
    const fetchUrl = resolveFetchUrl(target, options && options.requestType ? options.requestType : "manifest");
    if (typeof fetch !== "function") {
      return Promise.resolve({ ok: false, attempts: [{ uaIndex, error: "fetch_unavailable" }] });
    }
    return fetch(fetchUrl, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      headers,
      cache: "no-store",
    })
      .then((response) => {
        const status = response.status;
        const cors = readCorsResponseHeaders(response);
        if (probeOnly) {
          const attempt = {
            uaIndex,
            status,
            hasBody: false,
            playlist: false,
            intendedUserAgent: IPTV_USER_AGENTS[uaIndex] || DEFAULT_IPTV_USER_AGENT,
            fetchHeadersSent: Object.keys(headers),
            fetchHeadersBlocked: Object.keys(headerPack.blocked),
            cors,
            proxied: fetchUrl !== target,
            fetchUrl,
          };
          attempts.push(attempt);
          if (status >= 200 && status < 300) {
            activeIptvUaIndex = uaIndex;
            return { ok: true, status, hasBody: false, uaIndex, attempts };
          }
          return null;
        }
        const reader = responseType === "arraybuffer" ? response.arrayBuffer() : response.text();
        return reader.then((data) => {
          const hasBody = responseType === "arraybuffer" ? hasBinaryBody(data) : hasTextBody(data);
          const playlist = isPlaylistText(data);
          const attempt = {
            uaIndex,
            status,
            hasBody,
            playlist,
            intendedUserAgent: IPTV_USER_AGENTS[uaIndex] || DEFAULT_IPTV_USER_AGENT,
            fetchHeadersSent: Object.keys(headers),
            fetchHeadersBlocked: Object.keys(headerPack.blocked),
            cors,
            proxied: fetchUrl !== target,
            fetchUrl,
          };
          attempts.push(attempt);
          if (hasBody || playlist || (status >= 200 && status < 300)) {
            activeIptvUaIndex = uaIndex;
            return { ok: true, status, data, uaIndex, attempts };
          }
          return null;
        });
      })
      .catch((error) => {
        const classified = classifyFetchError(error);
        attempts.push({
          uaIndex,
          error: classified.message,
          errorKind: classified.kind,
          intendedUserAgent: IPTV_USER_AGENTS[uaIndex] || DEFAULT_IPTV_USER_AGENT,
          fetchHeadersSent: Object.keys(headers),
          fetchHeadersBlocked: Object.keys(headerPack.blocked),
        });
        return null;
      });
  }

  let chain = Promise.resolve(null);
  for (let offset = 0; offset < IPTV_USER_AGENTS.length; offset += 1) {
    const uaIndex = (uaStart + offset) % IPTV_USER_AGENTS.length;
    chain = chain.then((result) => {
      if (result && result.ok) return result;
      return tryUa(uaIndex);
    });
  }
  return chain.then((result) => {
    if (result && result.ok) return result;
    return { ok: false, attempts };
  });
}

function summarizeHlsNetworkError(data) {
  const response = data && data.response ? data.response : null;
  return {
    details: data && data.details ? data.details : "",
    type: data && data.type ? data.type : "",
    fatal: !!(data && data.fatal),
    httpStatus: response && response.code != null ? response.code : null,
    httpText: response && response.text ? String(response.text).slice(0, 240) : "",
    url: response && response.url ? response.url : "",
  };
}

function setBrandingVisible(visible) {
  if (!brandEl) return;
  brandEl.classList.toggle("hidden", !visible);
}

function showLoader(message) {
  if (loaderTextEl && message) loaderTextEl.textContent = String(message);
  if (loaderEl) loaderEl.classList.remove("hidden");
  setBrandingVisible(true);
}

function hideLoader() {
  if (loaderEl) loaderEl.classList.add("hidden");
}

function onPlaybackStartedUi() {
  hideLoader();
  setBrandingVisible(false);
}

function setStatus(text) {
  if (statusEl && debugEnabled) statusEl.textContent = text;
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
  if (typeof window.__preettvNotifyDebugLog === "function") {
    window.__preettvNotifyDebugLog();
  }
  if (DEBUG_QUERY_FLAG || debugEnabled) {
    console.log("[PreetTV Receiver][DEBUG]", entry);
  }
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

function stopPlaybackKeepalive() {
  if (playbackKeepaliveTimer) {
    clearInterval(playbackKeepaliveTimer);
    playbackKeepaliveTimer = null;
  }
  if (hlsDriftTimer) {
    clearInterval(hlsDriftTimer);
    hlsDriftTimer = null;
  }
  stopAvSyncWatchdog();
}

function stopAvSyncWatchdog() {
  if (avSyncTimer) {
    clearInterval(avSyncTimer);
    avSyncTimer = null;
  }
  if (avSyncPlaybackRateTimer) {
    clearTimeout(avSyncPlaybackRateTimer);
    avSyncPlaybackRateTimer = null;
  }
  avSyncProgressVideoTime = -1;
  avSyncProgressWallMs = 0;
  avSyncMpegtsSlowStreak = 0;
  if (castVideoEl) {
    try { castVideoEl.playbackRate = 1.0; } catch (_e) {}
  }
}

function measureVideoBufferLagSec() {
  if (!castVideoEl || !castVideoEl.buffered || castVideoEl.buffered.length === 0) return 0;
  try {
    const end = castVideoEl.buffered.end(castVideoEl.buffered.length - 1);
    return Math.max(0, end - (Number(castVideoEl.currentTime) || 0));
  } catch (_e) {
    return 0;
  }
}

function resetAvSyncPlaybackRateSoon() {
  if (avSyncPlaybackRateTimer) clearTimeout(avSyncPlaybackRateTimer);
  avSyncPlaybackRateTimer = setTimeout(() => {
    avSyncPlaybackRateTimer = null;
    if (castVideoEl) {
      try { castVideoEl.playbackRate = 1.0; } catch (_e) {}
    }
  }, 2800);
}

function startAvSyncWatchdog() {
  stopAvSyncWatchdog();
  const now = Date.now();
  avSyncProgressVideoTime = castVideoEl ? Number(castVideoEl.currentTime) || 0 : 0;
  avSyncProgressWallMs = now;
  avSyncTimer = setInterval(avSyncWatchdogTick, AV_SYNC_INTERVAL_MS);
  debugLog("avsync.watchdog.started", {
    activeCustomPlayer,
    url: activeCustomPlayerUrl || activeCandidates[activeCandidateIndex] || "",
  });
}

function attemptAvSyncResync(reason, detail) {
  const now = Date.now();
  if (now - avSyncLastNudgeMs < AV_SYNC_NUDGE_COOLDOWN_MS) return false;
  if (!avSyncNudgeWindowStart || now - avSyncNudgeWindowStart > 60000) {
    avSyncNudgeWindowStart = now;
    avSyncNudgeCount = 0;
  }
  if (avSyncNudgeCount >= AV_SYNC_MAX_NUDGES_PER_MIN) {
    debugLog("avsync.exhausted", { reason, detail, nudges: avSyncNudgeCount });
    return false;
  }
  avSyncNudgeCount += 1;
  avSyncLastNudgeMs = now;
  debugLog("avsync.resync", Object.assign({ reason, nudge: avSyncNudgeCount }, detail || {}));

  if (
    castVideoEl &&
    castVideoEl.buffered &&
    castVideoEl.buffered.length > 0 &&
    String(reason || "").indexOf("buffer_lag") >= 0
  ) {
    try {
      const end = castVideoEl.buffered.end(castVideoEl.buffered.length - 1);
      castVideoEl.currentTime = Math.max(0, end - 2);
      castVideoEl.play().catch(() => {});
      return true;
    } catch (_e) {}
  }

  if (activeCustomPlayer === "hlsjs" && hlsInstance) {
    try {
      const liveEdge = hlsInstance.liveSyncPosition;
      if (Number.isFinite(liveEdge) && liveEdge > 1 && castVideoEl) {
        castVideoEl.currentTime = Math.max(0, liveEdge - 2.5);
      } else {
        hlsInstance.startLoad(-1);
      }
    } catch (_e) {}
    return true;
  }

  if (castVideoEl) {
    const t = Number(castVideoEl.currentTime) || 0;
    try {
      castVideoEl.pause();
      setTimeout(() => {
        try {
          if (!castVideoEl) return;
          if (Number.isFinite(t)) castVideoEl.currentTime = t + 0.08;
          castVideoEl.play().catch(() => {});
        } catch (_e) {}
      }, 70);
    } catch (_e) {}
    return true;
  }
  return false;
}

function avSyncWatchdogTick() {
  if (!castVideoEl) return;
  const now = Date.now();
  const paused = castVideoEl.paused;
  const currentTime = Number(castVideoEl.currentTime) || 0;
  const ready = castVideoEl.readyState >= 2;
  const bufferLag = measureVideoBufferLagSec();

  if (paused || !ready) {
    avSyncProgressVideoTime = currentTime;
    avSyncProgressWallMs = now;
    avSyncMpegtsSlowStreak = 0;
    return;
  }

  if (activeCustomPlayer === "hlsjs" && hlsInstance) {
    try {
      const latency = Number(hlsInstance.latency);
      if (Number.isFinite(latency) && latency > AV_SYNC_HLS_LATENCY_MAX_S) {
        const liveEdge = Number(hlsInstance.liveSyncPosition);
        if (Number.isFinite(liveEdge) && liveEdge > 1) {
          attemptAvSyncResync("hls_latency_drift", { latency, liveEdge, currentTime, bufferLag });
          avSyncProgressVideoTime = Number(castVideoEl.currentTime) || currentTime;
          avSyncProgressWallMs = now;
          return;
        }
      }
    } catch (_e) {}
  }

  if (activeCustomPlayer === "mpegts" && avSyncMpegtsSlowStreak >= 2) {
    if (attemptAvSyncResync("mpegts_speed_low", { slowStreak: avSyncMpegtsSlowStreak, bufferLag })) {
      avSyncMpegtsSlowStreak = 0;
    }
  }

  if (bufferLag >= AV_SYNC_BUFFER_LAG_HARD_S) {
    attemptAvSyncResync("buffer_lag_hard", { bufferLag, currentTime });
    avSyncProgressVideoTime = Number(castVideoEl.currentTime) || currentTime;
    avSyncProgressWallMs = now;
    return;
  }

  if (bufferLag >= AV_SYNC_BUFFER_LAG_SOFT_S && castVideoEl.playbackRate === 1) {
    try {
      castVideoEl.playbackRate = 1.05;
      resetAvSyncPlaybackRateSoon();
      debugLog("avsync.playback_rate", { bufferLag, rate: 1.05 });
    } catch (_e) {}
  }

  const wallDelta = avSyncProgressWallMs > 0 ? now - avSyncProgressWallMs : 0;
  const timeDelta = avSyncProgressVideoTime >= 0 ? currentTime - avSyncProgressVideoTime : 0;

  if (timeDelta >= AV_SYNC_TIME_TOLERANCE_S) {
    avSyncProgressVideoTime = currentTime;
    avSyncProgressWallMs = now;
    return;
  }

  if (wallDelta >= AV_SYNC_WALL_STALL_MS) {
    if (timeDelta < AV_SYNC_TIME_TOLERANCE_S) {
      attemptAvSyncResync("video_time_stall", { timeDelta, wallDelta, currentTime, bufferLag });
    } else if (timeDelta > 0 && timeDelta < wallDelta / 2000) {
      attemptAvSyncResync("playback_too_slow", { timeDelta, wallDelta, currentTime, bufferLag });
    }
    avSyncProgressVideoTime = Number(castVideoEl.currentTime) || currentTime;
    avSyncProgressWallMs = now;
  }
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
    debugLog("player.volume_changed", { level, muted });
  }, "STREAM_VOLUME_CHANGED");

  try {
    playerManager.setMessageInterceptor(cast.framework.messages.MessageType.SET_VOLUME, (data) => {
      if (data) {
        applyReceiverVolume(data.volume, data.isMute);
        debugLog("player.set_volume", { level: data.volume, muted: data.isMute });
      }
      return data;
    });
  } catch (e) {
    debugLog("player.set_volume.interceptor_error", {
      message: e && e.message ? e.message : "unknown",
    });
  }
}

function keepCafPlayerAlive() {
  if (!playerManager || !activeCustomPlayer) return;
  try {
    const state = playerManager.getPlayerState();
    if (state !== cast.framework.messages.PlayerState.PLAYING) {
      playerManager.play();
    }
  } catch (_e) {}
}

function startPlaybackKeepalive() {
  stopPlaybackKeepalive();
  lastPlaybackProgressAt = Date.now();
  playbackKeepaliveTimer = setInterval(() => {
    if (!activeCustomPlayer || !castVideoEl) return;
    const now = Date.now();
    const playing = !castVideoEl.paused && castVideoEl.readyState >= 2;
    const hasBuffer = castVideoEl.buffered && castVideoEl.buffered.length > 0;
    if (playing || hasBuffer) {
      lastPlaybackProgressAt = now;
      return;
    }
    if (now - lastPlaybackProgressAt > PLAYBACK_STALL_MS) {
      debugLog("playback.keepalive.stall", {
        activeCustomPlayer,
        url: activeCustomPlayerUrl,
      });
      onCustomPlayerFatalError(activeCustomPlayer, "keepalive_stall");
    }
  }, 8000);
}

function onCustomPlaybackStarted(playerType) {
  installVolumeBridge();
  startPlaybackKeepalive();
  startAvSyncWatchdog();
  onPlaybackStartedUi();
  debugLog("playback.custom_started", { playerType });
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
    if (pendingCustomPlayerBoot && String(source || "").indexOf(".boot") < 0) {
      debugLog("candidate.watchdog.deferred", {
        source,
        serial,
        pendingCustomPlayerBoot,
      });
      armStallWatchdog(source + ".boot");
      return;
    }
    if (activeCustomPlayer && isCustomPlayerHealthy()) {
      clearStallWatchdog();
      return;
    }
    setStatus(`Loading timeout on ${activeCandidateIndex + 1}/${activeCandidates.length}, trying next candidate`);
    debugLog("candidate.watchdog.timeout", {
      source,
      serial,
      currentIndex: activeCandidateIndex,
      candidateCount: activeCandidates.length,
      currentUrl: activeCandidates[activeCandidateIndex] || "",
    });
    void tryLoadNextCandidateOnReceiverError("watchdog");
  }, STALL_WATCHDOG_MS);
}

function summarizeHeaders(headers) {
  const h = asObject(headers);
  const keys = Object.keys(h);
  return { count: keys.length, keys };
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
  return {
    schemaVersion: Number(root.schemaVersion) || 1,
    auth: asObject(root.auth),
    token: asObject(root.token),
    proxy: asObject(root.proxy),
    networkPolicy: asObject(root.networkPolicy),
    hosting: asObject(root.hosting),
    playback: asObject(root.playback),
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

function applyDebugConfigFromContract(contract, rawCustomData) {
  const root = asObject(rawCustomData || contract);
  const cfg = asObject((contract && contract.debug) || root.debug);
  const level = String(cfg.level || root.debugLevel || "").toLowerCase();
  const explicitDisable = cfg.enabled === false || level === "off";
  const explicitEnable =
    isTruthyFlag(cfg.enabled) ||
    isTruthyFlag(cfg.verbose) ||
    isTruthyFlag(cfg.showUi) ||
    isTruthyFlag(root.castDebugEnabled) ||
    level === "verbose" ||
    level === "on";
  const wasEnabled = debugEnabled;
  debugEnabled = explicitDisable
    ? false
    : (explicitEnable || DEFAULT_DEBUG_ENABLED || DEBUG_QUERY_FLAG);
  if (debugEnabled && explicitEnable) {
    enableReceiverDebugUi();
  }
  if (debugEnabled || wasEnabled) {
    debugLog("debug.config", {
      defaultEnabled: DEFAULT_DEBUG_ENABLED,
      explicitDisable,
      explicitEnable,
      fromQuery: DEBUG_QUERY_FLAG,
      showUi: isTruthyFlag(cfg.showUi) || isTruthyFlag(cfg.enabled),
      enabled: debugEnabled,
      rawDebug: cfg,
    });
  }
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

function isPlayInterruptedError(err) {
  const msg = String((err && err.message) || err || "");
  return (
    msg.indexOf("interrupted by a call to pause") >= 0 ||
    msg.indexOf("interrupted by a new load") >= 0 ||
    msg.indexOf("The play() request was interrupted") >= 0
  );
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
    if (lower.endsWith(".m3u8") || ext === "m3u8" || type === "m3u8" || type === "hls") return "application/x-mpegURL";
    if (lower.endsWith(".mpd") || ext === "mpd" || type === "mpd" || type === "dash") return "application/dash+xml";
    if (lower.endsWith(".ts") || ext === "ts" || type === "ts") return "video/mp2t";
    if (lower.endsWith(".mp4") || ext === "mp4" || type === "mp4") return "video/mp4";
    if (lower.endsWith(".webm") || ext === "webm" || type === "webm") return "video/webm";
  } catch (_e) {}
  return "video/*";
}

function buildCompatibilityCandidates(baseUrl, customData) {
  const candidates = [];
  const seen = new Set();
  const push = (value) => {
    const normalized = normalizeCandidateUrl(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  baseUrl = normalizeCandidateUrl(baseUrl);
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

  if (xtreamTsOnly) {
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
    } catch (_e) {}
  }

  if (looksHls && !xtreamTsOnly) {
    push(rewriteQueryParam(baseUrl, "extension", "ts"));
    push(rewriteQueryParam(baseUrl, "ext", "ts"));
  }

  if (customData && Array.isArray(customData.candidateUrls)) {
    customData.candidateUrls.forEach((candidateUrl) => {
      if (!xtreamTsOnly) {
        push(candidateUrl);
        return;
      }
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

function createIptvHlsLoaderClass() {
  if (typeof Hls === "undefined" || !Hls.DefaultConfig || !Hls.DefaultConfig.loader) {
    return null;
  }
  const DefaultLoader = Hls.DefaultConfig.loader;

  return class IptvHlsLoader extends DefaultLoader {
    load(context, config, callbacks) {
      const url = context.url;
      const responseType = context.responseType === "arraybuffer" ? "arraybuffer" : "text";
      const timeoutMs = config.timeout || 12000;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        callbacks.onTimeout({ code: 0, text: "iptv fetch timeout" }, context, null);
      }, timeoutMs);

      const requestType =
        context && typeof Hls !== "undefined" && context.type === Hls.UrlTypes.MANIFEST
          ? "manifest"
          : "segment";
      iptvHttpGet(url, { responseType, requestType })
        .then((result) => {
          if (timedOut) return;
          clearTimeout(timer);
          if (result.ok) {
            callbacks.onSuccess(
              { url, data: result.data || "" },
              { code: result.status || 200, text: "" },
              context,
              null
            );
            return;
          }
          callbacks.onError(
            {
              code: (result.attempts && result.attempts.length > 0 && result.attempts[result.attempts.length - 1].status) || 458,
              text: "iptv fetch failed",
            },
            context,
            null,
            null
          );
        })
        .catch((error) => {
          if (timedOut) return;
          clearTimeout(timer);
          callbacks.onError(
            { code: 0, text: error && error.message ? error.message : "iptv fetch error" },
            context,
            null,
            null
          );
        });
    }
  };
}

function probeBinaryStreamUrl(url) {
  const target = normalizeCandidateUrl(url);
  const networkAudit = auditNetworkEnvironment(target);
  return iptvHttpGet(target, {
    responseType: "arraybuffer",
    requestType: "segment",
    probeOnly: true,
  }).then((result) => {
    const attempts = result.attempts || [];
    const corsFailures = attempts.filter((item) => item.errorKind === "cors_or_network").length;
    const out = {
      ok: !!result.ok,
      status: result.ok ? result.status : 0,
      hasBinary: !!(result.ok && result.hasBody),
      uaIndex: result.uaIndex,
      attempts,
      urlCheck: inspectStreamUrl(target),
      proxied: isProxyEnabled(),
      networkAudit,
      corsFailures,
      likelyCorsBlocked: !result.ok && corsFailures > 0 && corsFailures === attempts.length,
    };
    debugLog("network.cors_audit", out);
    return out;
  });
}

function probeStreamUrl(url) {
  const target = normalizeCandidateUrl(url);

  function finalizeProbe(result) {
    if (!result.ok) {
      return {
        status: 0,
        isPlaylist: false,
        head: "",
        attempts: result.attempts || [],
        proxied: isProxyEnabled(),
      };
    }
    const text = String(result.data || "");
    return {
      status: result.status,
      isPlaylist: isPlaylistText(text),
      head: text.slice(0, 200),
      uaIndex: result.uaIndex,
      attempts: result.attempts || [],
      proxied: isProxyEnabled(),
    };
  }

  return iptvHttpGet(target, { responseType: "text", requestType: "manifest" }).then((result) => {
    if (!result.ok && probeIndicates458Block(result.attempts)) {
      iptvDirectBlocked458 = true;
      debugLog("iptv.direct_blocked_458", {
        url: target,
        staticHosting: isStaticHosting(),
        xtreamTsOnly: xtreamNeedsDirectTsOnly(),
      });
      if (tryEnableExplicitProxy("probe_458_empty")) {
        return iptvHttpGet(target, { responseType: "text", requestType: "manifest" }).then((proxied) => {
          const out = finalizeProbe(proxied);
          debugLog("probe.proxy_retry", { url: target, out });
          return out;
        });
      }
    }
    return finalizeProbe(result);
  });
}

function buildHlsConfig() {
  const LoaderClass = createIptvHlsLoaderClass();
  const config = {
    enableWorker: false,
    lowLatencyMode: false,
    manifestLoadingTimeOut: 15000,
    manifestLoadingMaxRetry: 3,
    fragLoadingTimeOut: 15000,
    fragLoadingMaxRetry: 4,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 12,
    maxLiveSyncPlaybackRate: 1.05,
  };
  if (LoaderClass) {
    config.loader = LoaderClass;
  }
  return config;
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

const CUSTOM_PLAYER_STUB_URL = "about:blank";

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

async function startMpegtsFromCafFailure(sourceUrl) {
  if (!lastLoadTemplate || !useCastReceiver) return false;
  const normalized = normalizeCandidateUrl(sourceUrl);
  const selectedLoad = prepareLoadForCandidate(lastLoadTemplate, normalized, activeCandidateIndex);
  prepareCustomPlayerStubLoad(selectedLoad, normalized, "mpegts");
  debugLog("caf-ts.mpegts_fallback", { url: normalized, index: activeCandidateIndex });
  try {
    await startMpegtsPlayback(normalized, selectedLoad);
    return true;
  } catch (e) {
    debugLog("caf-ts.mpegts_fallback.failed", {
      url: normalized,
      message: e && e.message ? e.message : "unknown",
    });
    return false;
  }
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

function markCandidatesExhausted(reason) {
  if (candidatesExhausted) return;
  candidatesExhausted = true;
  hideLoader();
  setBrandingVisible(true);
  setStatus("All receiver fallback candidates exhausted");
  debugLog("candidate.exhausted", {
    reason,
    activeCandidateIndex,
    candidateCount: activeCandidates.length,
  });
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
    return "Network/open failure: check token expiry, CORS (Access-Control-Allow-Origin), or CAF headers vs fetch limits";
  }
  return "Playback failure: try fallback candidate and verify stream format compatibility";
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
    const originalBaseUrl = String(originalCustomData._retryBaseUrl || originalMedia.contentUrl || originalMedia.contentId || "");
    cloned.customData = Object.assign({}, originalCustomData, {
      _retryBaseUrl: originalBaseUrl,
      _retryCandidateIndex: retryIndex,
    });
  }
  return cloned;
}

function readVideoBlobUrl() {
  if (!castVideoEl) return "";
  const mediaSrc = castVideoEl.currentSrc || castVideoEl.src || "";
  return mediaSrc.startsWith("blob:") ? mediaSrc : "";
}

function finalizeCustomPlayerLoad(selectedLoad, sourceUrl, playerType) {
  activeCustomPlayer = playerType;
  activeCustomPlayerUrl = sourceUrl;
  pendingCustomPlayerBoot = null;

  // Keep CAF metadata on the real stream URL but never hand CAF a blob/http URL to
  // load natively — mpegts/hls.js already own castVideoEl via MSE.
  selectedLoad.media.contentId = sourceUrl;
  selectedLoad.media.contentUrl = CUSTOM_PLAYER_STUB_URL;
  selectedLoad.media.contentType = playerType === "dashjs" ? "application/dash+xml" : "video/mp4";
  selectedLoad.media.streamType = cast.framework.messages.StreamType.LIVE;
  selectedLoad.customData = Object.assign({}, asObject(selectedLoad.customData), {
    _customPlayer: playerType,
    _customPlayerUrl: sourceUrl,
    _customPlayerActive: true,
  });

  onCustomPlaybackStarted(playerType);
  return selectedLoad;
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

async function handleCustomInterceptorFailure(strategy, err, selectedLoad, selectedUrl) {
  debugLog(strategy + ".interceptor_failed", {
    message: err && err.message ? err.message : "unknown",
    url: selectedUrl,
    index: activeCandidateIndex,
  });
  await advanceCandidateAfterCustomFailure(strategy + "_interceptor_failed");
  return selectedLoad;
}

function onCustomPlayerFatalError(playerType, details) {
  debugLog("custom_player.fatal", { playerType, details, url: activeCustomPlayerUrl });
  clearCustomPlayer();
  destroyHls();
  destroyDash();
  destroyMpegts();
  void advanceCandidateAfterCustomFailure(playerType + "_fatal");
}

function startHlsJsPlayback(sourceUrl, selectedLoad) {
  return new Promise((resolve, reject) => {
    destroyHls();
    destroyDash();
    destroyMpegts();
    clearCustomPlayer();
    pendingCustomPlayerBoot = "hlsjs";

    if (!hlsIsAvailable()) {
      pendingCustomPlayerBoot = null;
      debugLog("hlsjs.unavailable", { url: sourceUrl });
      reject(new Error("hlsjs unavailable"));
      return;
    }

    let settled = false;
    let mediaAttached = false;
    let manifestParsed = false;
    let hlsUaAttempts = 0;
    const normalizedUrl = normalizeCandidateUrl(sourceUrl);

    function settle(load) {
      if (settled) return;
      settled = true;
      pendingCustomPlayerBoot = null;
      clearStallWatchdog();
      resolve(load);
    }

    function failPreload(reason) {
      if (settled) return;
      settled = true;
      pendingCustomPlayerBoot = null;
      clearStallWatchdog();
      debugLog("hlsjs.preload_failed", { url: sourceUrl, reason, index: activeCandidateIndex });
      reject(new Error(reason || "hlsjs preload failed"));
    }

    function trySettleAfterReady() {
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
        if (readVideoBlobUrl() || attempts >= 20) {
          completeSettle();
          return;
        }
        attempts += 1;
        setTimeout(waitForBlob, 50);
      };
      waitForBlob();
    }

    hlsInstance = new Hls(buildHlsConfig());

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

    hlsInstance.on(Hls.Events.ERROR, (_evt, data) => {
      if (!data || !data.fatal) return;
      debugLog("hlsjs.fatal_error", Object.assign({
        url: normalizedUrl,
        index: activeCandidateIndex,
        urlCheck: inspectStreamUrl(normalizedUrl),
        hlsUaAttempts,
      }, summarizeHlsNetworkError(data)));

      const isManifestNetworkError = String(data.type || "").toLowerCase() === "networkerror" &&
        String(data.details || "").toLowerCase().indexOf("manifest") >= 0;
      const netErr = summarizeHlsNetworkError(data);

      if (!settled && isManifestNetworkError && Number(netErr.httpStatus) === 458) {
        iptvDirectBlocked458 = true;
        if (tryEnableExplicitProxy("hlsjs_fatal_458")) {
          try {
            hlsInstance.loadSource(resolveFetchUrl(normalizedUrl, "manifest"));
            return;
          } catch (_e) {}
        }
      }

      if (!settled && isManifestNetworkError && hlsUaAttempts < IPTV_USER_AGENTS.length - 1) {
        hlsUaAttempts += 1;
        rotateIptvUserAgent("hlsjs_manifest_retry");
        try {
          hlsInstance.loadSource(resolveFetchUrl(normalizedUrl, "manifest"));
        } catch (_e) {
          failPreload(data.details || "hlsjs fatal");
        }
        return;
      }

      if (!settled) {
        failPreload(data.details || "hlsjs fatal");
        return;
      }
      onCustomPlayerFatalError("hlsjs", data.details || "fatal");
    });

    armStallWatchdog("hlsjs.start");
    hlsInstance.attachMedia(castVideoEl);

    probeStreamUrl(normalizedUrl).then((probe) => {
      debugLog("hlsjs.probe", { url: normalizedUrl, index: activeCandidateIndex, probe });
      if (settled) return;
      if (Number.isInteger(probe.uaIndex)) {
        activeIptvUaIndex = probe.uaIndex;
      }
      debugLog("hlsjs.start", {
        url: normalizedUrl,
        index: activeCandidateIndex,
        headers: Object.keys(buildIptvRequestHeaders(normalizedUrl)),
        urlCheck: inspectStreamUrl(normalizedUrl),
        userAgent: IPTV_USER_AGENTS[activeIptvUaIndex],
        probePlaylist: !!probe.isPlaylist,
      });
      hlsInstance.loadSource(resolveFetchUrl(normalizedUrl, "manifest"));
    }).catch((probeErr) => {
      debugLog("hlsjs.probe.error", {
        url: normalizedUrl,
        message: probeErr && probeErr.message ? probeErr.message : "unknown",
      });
      if (!settled) {
        hlsInstance.loadSource(resolveFetchUrl(normalizedUrl, "manifest"));
      }
    });
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
      debugLog("mpegts.unavailable", { url: sourceUrl });
      reject(new Error("mpegts unavailable"));
      return;
    }

    let settled = false;
    let mpegtsUaAttempts = 0;
    let mpegtsRetryTimer = null;
    let mpegtsRetryInFlight = false;

    function getMpegtsPlaybackUrl() {
      return resolveFetchUrl(sourceUrl, "segment");
    }

    function settle() {
      if (settled) return;
      settled = true;
      if (mpegtsRetryTimer) {
        clearTimeout(mpegtsRetryTimer);
        mpegtsRetryTimer = null;
      }
      clearStallWatchdog();
      resolve();
    }

    function failPreload(reason) {
      if (settled) return;
      if (mpegtsRetryInFlight && isPlayInterruptedError(reason)) {
        debugLog("mpegts.play_interrupted_ignored", { reason, index: activeCandidateIndex });
        return;
      }
      settled = true;
      if (mpegtsRetryTimer) {
        clearTimeout(mpegtsRetryTimer);
        mpegtsRetryTimer = null;
      }
      pendingCustomPlayerBoot = null;
      clearStallWatchdog();
      debugLog("mpegts.preload_failed", {
        url: sourceUrl,
        playbackUrl: getMpegtsPlaybackUrl(),
        reason,
        index: activeCandidateIndex,
        mpegtsUaAttempts,
        urlCheck: inspectStreamUrl(sourceUrl),
      });
      reject(new Error(reason || "mpegts preload failed"));
    }

    function attemptCafNativeTsFromMpegts(reason) {
      if (settled) return;
      if (vueottCafNativeAttempted) {
        failPreload(reason || "mpegts status invalid");
        return;
      }
      if (!playerManager || typeof playerManager.load !== "function") {
        failPreload(reason || "mpegts status invalid");
        return;
      }
      settled = true;
      if (mpegtsRetryTimer) {
        clearTimeout(mpegtsRetryTimer);
        mpegtsRetryTimer = null;
      }
      pendingCustomPlayerBoot = null;
      clearStallWatchdog();
      destroyMpegts();
      vueottCafNativeAttempted = true;
      const nativeLoad = buildCafNativeTsLoad(selectedLoad, sourceUrl);
      debugLog("mpegts.caf_ts_fallback", {
        reason,
        url: sourceUrl,
        userAgent: IPTV_USER_AGENTS[activeIptvUaIndex],
        urlCheck: inspectStreamUrl(sourceUrl),
      });
      playerManager.load(nativeLoad).then(() => {
        setStatus("Playing (CAF TS)");
        resolve();
      }).catch((e) => {
        pendingCustomPlayerBoot = null;
        debugLog("mpegts.caf_ts_fallback.failed", {
          message: e && e.message ? e.message : "unknown",
          url: sourceUrl,
        });
        reject(new Error(e && e.message ? e.message : reason || "caf-ts fallback failed"));
      });
    }

    function scheduleMpegtsUaRetry(reason) {
      if (settled || mpegtsRetryInFlight) return;
      if (mpegtsUaAttempts >= IPTV_USER_AGENTS.length - 1) {
        if (useCastReceiver && isTsCandidate(sourceUrl)) {
          attemptCafNativeTsFromMpegts(reason || "mpegts status invalid");
        } else {
          failPreload(reason || "mpegts status invalid");
        }
        return;
      }
      mpegtsUaAttempts += 1;
      rotateIptvUserAgent("mpegts_status_retry");
      mpegtsRetryInFlight = true;
      if (mpegtsRetryTimer) clearTimeout(mpegtsRetryTimer);
      mpegtsRetryTimer = setTimeout(() => {
        mpegtsRetryTimer = null;
        if (settled) return;
        try {
          beginMpegtsSession("mpegts_status_retry");
        } catch (retryErr) {
          mpegtsRetryInFlight = false;
          failPreload(retryErr && retryErr.message ? retryErr.message : "mpegts retry failed");
        }
      }, 400);
    }

    function beginMpegtsSession(trigger) {
      const playbackUrl = getMpegtsPlaybackUrl();
      const headers = buildIptvRequestHeaders(sourceUrl);
      destroyMpegts();
      installIptvNetworkShim(sourceUrl);
      mpegtsInstance = mpegts.createPlayer({
        type: "mpegts",
        isLive: true,
        url: playbackUrl,
        headers: headers,
        hasAudio: true,
        hasVideo: true,
      }, buildMpegtsPlayerConfig());

      if (mpegts.Events && mpegts.Events.STATISTICS_INFO) {
        mpegtsInstance.on(mpegts.Events.STATISTICS_INFO, (stats) => {
          const speed = stats && stats.speed != null ? Number(stats.speed) : NaN;
          if (!Number.isFinite(speed)) return;
          if (speed < AV_SYNC_MPEGTS_MIN_SPEED) {
            avSyncMpegtsSlowStreak += 1;
          } else if (speed >= 0.9) {
            avSyncMpegtsSlowStreak = 0;
          }
        });
      }

      mpegtsInstance.on(mpegts.Events.ERROR, (errorType, errorDetail) => {
        debugLog("mpegts.error", {
          errorType,
          errorDetail,
          url: sourceUrl,
          playbackUrl,
          index: activeCandidateIndex,
          mpegtsUaAttempts,
          urlCheck: inspectStreamUrl(sourceUrl),
        });
        const invalidStatus = String(errorDetail || "").indexOf("HttpStatusCodeInvalid") >= 0;
        if (!settled && invalidStatus) {
          scheduleMpegtsUaRetry(String(errorDetail || errorType || "mpegts status invalid"));
          return;
        }
        if (!settled) {
          failPreload(String(errorDetail || errorType || "mpegts fatal"));
          return;
        }
        onCustomPlayerFatalError("mpegts", String(errorDetail || errorType || "fatal"));
      });

      debugLog("mpegts.start", {
        trigger: trigger || "initial",
        url: sourceUrl,
        playbackUrl,
        proxied: isProxyEnabled(),
        index: activeCandidateIndex,
        headers: Object.keys(headers),
        urlCheck: inspectStreamUrl(sourceUrl),
        userAgent: IPTV_USER_AGENTS[activeIptvUaIndex],
        features: typeof mpegts.getFeatureList === "function" ? mpegts.getFeatureList() : null,
      });
      armStallWatchdog("mpegts.start");
      mpegtsInstance.attachMediaElement(castVideoEl);
      mpegtsInstance.load();
      const playResult = mpegtsInstance.play();
      mpegtsRetryInFlight = false;
      if (playResult && typeof playResult.catch === "function") {
        playResult.catch((playErr) => {
          const message = playErr && playErr.message ? playErr.message : "mpegts play failed";
          if (isPlayInterruptedError(message)) {
            debugLog("mpegts.play_interrupted_ignored", { message, index: activeCandidateIndex });
            return;
          }
          failPreload(message);
        });
      }
    }

    const onPlaying = () => {
      if (settled) return;
      finalizeCustomPlayerLoad(selectedLoad, sourceUrl, "mpegts");
      debugLog("mpegts.playing", {
        url: sourceUrl,
        playbackUrl: getMpegtsPlaybackUrl(),
        index: activeCandidateIndex,
        mediaSrc: readVideoBlobUrl(),
        urlCheck: inspectStreamUrl(sourceUrl),
        cafContentUrl: CUSTOM_PLAYER_STUB_URL,
      });
      setStatus("Playing (MPEG-TS)");
      settle();
    };

    if (castVideoEl) {
      castVideoEl.addEventListener("playing", onPlaying, { once: true });
      castVideoEl.addEventListener("canplay", onPlaying, { once: true });
    }

    try {
      void probeBinaryStreamUrl(sourceUrl).then((probe) => {
        debugLog("mpegts.probe", { url: sourceUrl, index: activeCandidateIndex, probe });
        if (settled) return;
        if (Number.isInteger(probe.uaIndex)) {
          activeIptvUaIndex = probe.uaIndex;
        }
        if (!probe.ok) {
          if (probeIndicates458Block(probe.attempts)) {
            iptvDirectBlocked458 = true;
          }
          // Fetch probes cannot set User-Agent on Chromecast; vueott often returns
          // HTTP 458 to fetch while mpegts fetch-stream-loader still works.
          if (probe.likelyCorsBlocked) {
            debugLog("mpegts.probe_bypass", {
              url: sourceUrl,
              reason: "cors_advisory",
              attempts: probe.attempts,
            });
          } else {
          debugLog("mpegts.probe_bypass", {
            url: sourceUrl,
            reason: "probe_advisory_failed",
            attempts: probe.attempts,
          });
          }
        }
        beginMpegtsSession(probe.ok ? "probe_ok" : "probe_bypass");
      }).catch((probeErr) => {
        debugLog("mpegts.probe.error", {
          url: sourceUrl,
          message: probeErr && probeErr.message ? probeErr.message : "unknown",
        });
        if (!settled) beginMpegtsSession("probe_error_fallback");
      });
    } catch (e) {
      debugLog("mpegts.attach_error", {
        message: e && e.message ? e.message : "unknown",
        url: sourceUrl,
      });
      failPreload(e && e.message ? e.message : "mpegts attach error");
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

    function settle(load) {
      if (settled) return;
      settled = true;
      clearStallWatchdog();
      resolve(load);
    }

    dashInstance = dashjs.MediaPlayer().create();

    dashInstance.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
      const finalized = finalizeCustomPlayerLoad(selectedLoad, sourceUrl, "dashjs");
      debugLog("dashjs.stream_initialized", { url: sourceUrl, index: activeCandidateIndex });
      if (castVideoEl) {
        castVideoEl.play().catch((e) => {
          debugLog("dashjs.play.error", { message: e && e.message ? e.message : "unknown" });
        });
      }
      setStatus("Playing (DASH.js)");
      settle(finalized);
    });

    dashInstance.on(dashjs.MediaPlayer.events.ERROR, (error) => {
      debugLog("dashjs.error", {
        code: error && error.code ? error.code : "",
        message: error && error.message ? error.message : "",
        url: sourceUrl,
        index: activeCandidateIndex,
      });
      if (!settled) {
        settle(selectedLoad);
        return;
      }
      onCustomPlayerFatalError("dashjs", error && error.message ? error.message : "fatal");
    });

    try {
      debugLog("dashjs.start", { url: sourceUrl, index: activeCandidateIndex });
      armStallWatchdog("dashjs.start");
      dashInstance.attachView(castVideoEl);
      dashInstance.attachSource(sourceUrl);
    } catch (e) {
      debugLog("dashjs.attach_error", {
        message: e && e.message ? e.message : "unknown",
        url: sourceUrl,
      });
      settle(selectedLoad);
    }
  });
}

async function tryHlsJsFallbackOnCurrentCandidate() {
  const currentUrl = activeCandidates[activeCandidateIndex] || "";
  if (!currentUrl || hlsJsFallbackUsedForIndex === activeCandidateIndex) return false;
  if (isTsCandidate(currentUrl)) return false;
  if (!isHlsCandidate(currentUrl)) return false;
  if (getPlaybackStrategy(currentUrl) === "mpegts") return false;
  if (!hlsIsAvailable() || !lastLoadTemplate || !playerManager) return false;

  hlsJsFallbackUsedForIndex = activeCandidateIndex;
  const fallbackLoad = prepareLoadForCandidate(lastLoadTemplate, currentUrl, activeCandidateIndex);
  debugLog("candidate.hlsjs_fallback", {
    url: currentUrl,
    index: activeCandidateIndex,
  });

  try {
    armStallWatchdog("candidate.hlsjs_fallback");
    const resolvedLoad = await startHlsJsPlayback(currentUrl, fallbackLoad);
    await playerManager.load(resolvedLoad);
    return true;
  } catch (e) {
    debugLog("candidate.hlsjs_fallback.error", {
      message: e && e.message ? e.message : "unknown",
      url: currentUrl,
      urlCheck: inspectStreamUrl(currentUrl),
    });
    await advanceCandidateAfterCustomFailure("hlsjs_fallback_failed");
    return false;
  }
}

async function tryLoadNextCandidateOnReceiverError(reason) {
  clearStallWatchdog();
  destroyHls();
  destroyDash();
  destroyMpegts();
  clearCustomPlayer();

  if (!lastLoadTemplate || candidatesExhausted) return;
  if (activeCandidateIndex >= activeCandidates.length - 1) {
    markCandidatesExhausted(reason);
    return;
  }

  activeCandidateIndex += 1;
  rotateIptvUserAgent("candidate_retry");
  const nextUrl = activeCandidates[activeCandidateIndex];
  const nextLoad = prepareLoadForCandidate(lastLoadTemplate, nextUrl, activeCandidateIndex);
  const retryLabel = `Retrying ${activeCandidateIndex + 1}/${activeCandidates.length}…`;
  showLoader(retryLabel);
  setStatus(retryLabel);
  debugLog("candidate.retry", {
    reason,
    nextIndex: activeCandidateIndex,
    nextUrl,
    candidateCount: activeCandidates.length,
    contentType: nextLoad && nextLoad.media ? nextLoad.media.contentType : "",
    strategy: getPlaybackStrategy(nextUrl),
  });

  try {
    armStallWatchdog("candidate.retry");
    await playerManager.load(nextLoad);
  } catch (e) {
    const message = e && e.message ? e.message : String(e || "unknown");
    setStatus(`Receiver retry failed: ${message}`);
    debugLog("candidate.retry.error", {
      message,
      nextIndex: activeCandidateIndex,
      nextUrl: activeCandidates[activeCandidateIndex] || "",
    });
    if (activeCandidateIndex >= activeCandidates.length - 1) {
      markCandidatesExhausted("candidate_retry_failed");
    }
  }
}

function isCustomPlayerHealthy() {
  if (!activeCustomPlayer || !castVideoEl) return false;
  const hasTime = Number.isFinite(castVideoEl.currentTime) && castVideoEl.currentTime > 0;
  const isPlaying = !castVideoEl.paused && castVideoEl.readyState >= 2;
  const hasBuffer = castVideoEl.buffered && castVideoEl.buffered.length > 0;
  return isPlaying || hasTime || hasBuffer;
}

function initBrowserPlayback() {
  setStatus("Browser test mode");
  debugLog("browser.mode", {
    hasCastFramework,
    browserTestMode,
    hlsGlobalPresent: typeof Hls !== "undefined",
    hlsJsAvailable: hlsIsAvailable(),
    customVideoElement: !!castVideoEl,
    href: window.location.href,
    streamUrl: getStreamUrlFromPage(),
  });

  if (castVideoEl) {
    castVideoEl.controls = true;
    castVideoEl.addEventListener("error", () => {
      const err = castVideoEl.error;
      debugLog("browser.video.error", {
        code: err && err.code ? err.code : "",
        message: err && err.message ? err.message : "",
      });
    });
    castVideoEl.addEventListener("play", () => debugLog("browser.video.play", {}));
    castVideoEl.addEventListener("canplay", () => debugLog("browser.video.canplay", {}));
  }

  let bcCandidates = [];
  let bcCandidateIndex = 0;

  function browserLoadCandidate(candidateUrl) {
    const strategy = getPlaybackStrategy(candidateUrl, { forBrowser: true });
    debugLog("browser.load_candidate", { candidateUrl, strategy, bcCandidateIndex });

    if (strategy === "mpegts" && mpegtsIsAvailable()) {
      destroyMpegts();
      installIptvNetworkShim(candidateUrl);
      const headers = buildIptvRequestHeaders(candidateUrl);
      mpegtsInstance = mpegts.createPlayer({
        type: "mpegts",
        isLive: true,
        url: candidateUrl,
        headers: headers,
        hasAudio: true,
        hasVideo: true,
      }, buildMpegtsPlayerConfig());

      mpegtsInstance.on(mpegts.Events.ERROR, (errorType, errorDetail) => {
        debugLog("browser.mpegts.error", { errorType, errorDetail, url: candidateUrl });
        if (bcCandidateIndex < bcCandidates.length - 1) {
          bcCandidateIndex += 1;
          destroyMpegts();
          browserLoadCandidate(bcCandidates[bcCandidateIndex]);
        } else {
          setStatus("All candidates failed");
        }
      });

      mpegtsInstance.attachMediaElement(castVideoEl);
      mpegtsInstance.load();
      mpegtsInstance.play();
      setStatus(`Loading MPEG-TS (${bcCandidateIndex + 1}/${bcCandidates.length})`);
      return;
    }

    if (strategy === "hlsjs" && hlsIsAvailable()) {
      destroyHls();
      installIptvNetworkShim(candidateUrl);
      hlsInstance = new Hls(buildHlsConfig());

      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        setStatus(`Playing (${bcCandidateIndex + 1}/${bcCandidates.length})`);
        debugLog("browser.hls.manifest_parsed", { url: candidateUrl });
        castVideoEl.play().catch((_e) => {});
      });

      hlsInstance.on(Hls.Events.ERROR, (_evt, data) => {
        debugLog("browser.hls.error", {
          details: data && data.details ? data.details : "",
          type: data && data.type ? data.type : "",
          fatal: !!(data && data.fatal),
        });
        if (data && data.fatal) {
          if (bcCandidateIndex < bcCandidates.length - 1) {
            bcCandidateIndex += 1;
            const next = bcCandidates[bcCandidateIndex];
            debugLog("browser.candidate.retry", { reason: data.details, next, bcCandidateIndex });
            destroyHls();
            browserLoadCandidate(next);
          } else {
            setStatus("All candidates failed");
            debugLog("browser.candidate.exhausted", {});
          }
        }
      });

      hlsInstance.attachMedia(castVideoEl);
      hlsInstance.loadSource(candidateUrl);
      return;
    }

    if (strategy === "dashjs" && dashIsAvailable()) {
      try {
        destroyDash();
        dashInstance = dashjs.MediaPlayer().create();
        dashInstance.attachView(castVideoEl);
        dashInstance.attachSource(candidateUrl);
        dashInstance.play();
        setStatus("Browser mode: DASH stream loaded");
        debugLog("browser.dash.loaded", { candidateUrl });
      } catch (e) {
        debugLog("browser.dash.error", { message: e && e.message ? e.message : "unknown" });
      }
      return;
    }

    if (castVideoEl) {
      castVideoEl.src = candidateUrl;
      castVideoEl.type = inferContentType(candidateUrl);
      castVideoEl.play().catch((_e) => {});
    }
  }

  function browserLoadUrl(url) {
    if (!url) return;
    destroyHls();
    destroyDash();
    destroyMpegts();
    if (castVideoEl) {
      castVideoEl.removeAttribute("src");
      castVideoEl.load();
    }
    bcCandidates = buildCompatibilityCandidates(url, {});
    bcCandidateIndex = 0;
    const first = bcCandidates[0] || url;
    debugLog("browser.load", {
      url,
      first,
      candidates: bcCandidates,
      strategy: getPlaybackStrategy(first, { forBrowser: true }),
    });
    browserLoadCandidate(first);
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

  try {
    const url = getStreamUrlFromPage();
    if (url && castVideoEl) {
      browserLoadUrl(url);
    }
  } catch (e) {
    debugLog("browser.mode.error", {
      message: e && e.message ? e.message : "unknown",
    });
  }
}

if (useCastReceiver) {
playerManager.setMessageInterceptor(cast.framework.messages.MessageType.LOAD, (loadRequestData) => {
  try {
    const media = loadRequestData.media || {};
    const customData = asObject(loadRequestData.customData);

    const rawBaseUrl = String(customData._retryBaseUrl || media.contentUrl || media.contentId || "");
    if (!rawBaseUrl) return loadRequestData;
    const baseUrl = normalizeCandidateUrl(rawBaseUrl);
    if (baseUrl !== rawBaseUrl) {
      debugLog("load.url_repaired", { rawBaseUrl, baseUrl, urlCheck: inspectStreamUrl(baseUrl) });
    }

    activeContract = normalizeContract(customData);
    applyDebugConfigFromContract(activeContract, customData);
    showLoader("Loading stream…");
    hlsJsFallbackUsedForIndex = -1;
    candidatesExhausted = false;
    iptvDirectBlocked458 = false;
    vueottCafNativeAttempted = false;
    vueottMpegtsAfterCafAttempted = false;
    activeIptvUaIndex = pickInitialUaIndex(baseUrl);
    debugLog("load.received", {
      mediaContentUrl: baseUrl,
      isRetry: !!customData._retryBaseUrl,
      customDataKeys: Object.keys(customData),
      schemaVersion: activeContract.schemaVersion,
      channelName: activeContract.channelName,
      urlCheck: inspectStreamUrl(baseUrl),
      activeIptvUaIndex,
      userAgent: IPTV_USER_AGENTS[activeIptvUaIndex],
      networkAudit: auditNetworkEnvironment(baseUrl),
    });
    if (playerManager && typeof playerManager.setPlaybackConfig === "function") {
      playerManager.setPlaybackConfig(createPlaybackConfig());
    }
    ensureShakaRequestFilters();

    activeCandidates = buildCompatibilityCandidates(baseUrl, customData).map((candidate) => (
      normalizeCandidateUrl(candidate)
    ));
    if (activeCandidates.length === 0) {
      activeCandidates = [baseUrl];
      debugLog("candidate.fallback_base_only", { baseUrl });
    }

    if (customData._retryCandidateIndex != null) {
      activeCandidateIndex = Math.max(0, Math.min(Number(customData._retryCandidateIndex), activeCandidates.length - 1));
    } else if (Number.isInteger(customData.candidateIndex)) {
      activeCandidateIndex = Math.max(0, Math.min(customData.candidateIndex, activeCandidates.length - 1));
    } else {
      activeCandidateIndex = 0;
    }

    const selectedUrl = normalizeCandidateUrl(activeCandidates[activeCandidateIndex] || baseUrl);
    activeCandidates[activeCandidateIndex] = selectedUrl;
    const selectedLoad = prepareLoadForCandidate(loadRequestData, selectedUrl);
    if ((selectedUrl || "").toLowerCase().includes("/live.php") || isLikelyLiveStream(selectedUrl)) {
      selectedLoad.media.streamType = cast.framework.messages.StreamType.LIVE;
    }
    selectedLoad.customData = Object.assign({}, asObject(selectedLoad.customData), {
      _retryBaseUrl: baseUrl,
    });
    lastLoadTemplate = loadRequestData;

    const strategy = getPlaybackStrategy(selectedUrl);
    debugLog("load.candidates", {
      selectedIndex: activeCandidateIndex,
      selectedUrl,
      candidates: activeCandidates,
      selectedContentType: selectedLoad && selectedLoad.media ? selectedLoad.media.contentType : "",
      strategy,
      hlsJsAvailable: hlsIsAvailable(),
      dashJsAvailable: dashIsAvailable(),
    });

    if (strategy === "caf-ts") {
      destroyHls();
      destroyDash();
      destroyMpegts();
      clearCustomPlayer();
      vueottCafNativeAttempted = true;
      selectedLoad.media.contentId = selectedUrl;
      selectedLoad.media.contentUrl = selectedUrl;
      selectedLoad.media.contentType = "video/mp2t";
      selectedLoad.media.streamType = cast.framework.messages.StreamType.LIVE;
      debugLog("caf-ts.start", {
        url: selectedUrl,
        index: activeCandidateIndex,
        headers: Object.keys(buildIptvRequestHeaders(selectedUrl)),
        userAgent: IPTV_USER_AGENTS[activeIptvUaIndex],
        urlCheck: inspectStreamUrl(selectedUrl),
      });
      armStallWatchdog("caf-ts.start");
      return selectedLoad;
    }

    if (strategy === "mpegts") {
      const stubLoad = prepareCustomPlayerStubLoad(selectedLoad, selectedUrl, "mpegts");
      void startMpegtsPlayback(selectedUrl, selectedLoad).catch((err) => (
        handleCustomInterceptorFailure("mpegts", err, stubLoad, selectedUrl)
      ));
      return stubLoad;
    }

    if (strategy === "hlsjs") {
      const stubLoad = prepareCustomPlayerStubLoad(selectedLoad, selectedUrl, "hlsjs");
      void startHlsJsPlayback(selectedUrl, selectedLoad).catch((err) => (
        handleCustomInterceptorFailure("hlsjs", err, stubLoad, selectedUrl)
      ));
      return stubLoad;
    }

    if (strategy === "dashjs") {
      return startDashJsPlayback(selectedUrl, selectedLoad);
    }

    if (strategy === "caf-hls") {
      destroyHls();
      destroyDash();
      destroyMpegts();
      clearCustomPlayer();
      debugLog("caf-hls.start", {
        url: selectedUrl,
        index: activeCandidateIndex,
        headers: Object.keys(buildIptvRequestHeaders(selectedUrl)),
      });
      armStallWatchdog("load.interceptor.caf-hls");
      return selectedLoad;
    }

    destroyHls();
    destroyDash();
    destroyMpegts();
    clearCustomPlayer();
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
  const detailCode = event && event.detailedErrorCode ? event.detailedErrorCode : "";
  const errorCode = Number(detailCode) || 0;

  if (candidatesExhausted) {
    debugLog("player.error.suppressed_exhausted", {
      detailedErrorCode: detailCode,
      reason: event && event.reason ? event.reason : "",
    });
    return;
  }

  if (candidateAdvanceInFlight) {
    debugLog("player.error.suppressed_advance", {
      detailedErrorCode: detailCode,
      reason: event && event.reason ? event.reason : "",
    });
    return;
  }

  if (
    activeCustomPlayer &&
    (errorCode === 905 || errorCode === 104 || errorCode === 301 || errorCode === 101)
  ) {
    debugLog("player.error.suppressed_custom_active", {
      activeCustomPlayer,
      detailedErrorCode: detailCode,
      reason: event && event.reason ? event.reason : "",
    });
    return;
  }

  const currentUrlForError = activeCandidates[activeCandidateIndex] || "";
  const currentStrategy = getPlaybackStrategy(currentUrlForError);
  if (
    !activeCustomPlayer &&
    !pendingCustomPlayerBoot &&
    !vueottMpegtsAfterCafAttempted &&
    isTsCandidate(currentUrlForError) &&
    vueottCafNativeAttempted &&
    (errorCode === 104 || errorCode === 905 || errorCode === 301)
  ) {
    if (activeIptvUaIndex < IPTV_USER_AGENTS.length - 1) {
      rotateIptvUserAgent("caf_ts_error_" + errorCode);
      if (playerManager && typeof playerManager.setPlaybackConfig === "function") {
        playerManager.setPlaybackConfig(createPlaybackConfig());
      }
      const retryLoad = buildCafNativeTsLoad(
        prepareLoadForCandidate(lastLoadTemplate || {}, currentUrlForError, activeCandidateIndex),
        currentUrlForError
      );
      vueottCafNativeAttempted = true;
      void playerManager.load(retryLoad).catch(() => {
        vueottMpegtsAfterCafAttempted = true;
        void startMpegtsFromCafFailure(currentUrlForError).then((started) => {
          if (!started) {
            void advanceCandidateAfterCustomFailure("caf_ts_mpegts_failed");
          }
        });
      });
      debugLog("player.error.caf_ts_ua_retry", {
        detailedErrorCode: detailCode,
        url: currentUrlForError,
        activeIptvUaIndex,
        userAgent: IPTV_USER_AGENTS[activeIptvUaIndex],
      });
      return;
    }
    vueottMpegtsAfterCafAttempted = true;
    void startMpegtsFromCafFailure(currentUrlForError).then((started) => {
      if (!started) {
        void advanceCandidateAfterCustomFailure("caf_ts_mpegts_failed");
      }
    });
    debugLog("player.error.caf_ts_mpegts_handoff", {
      detailedErrorCode: detailCode,
      url: currentUrlForError,
    });
    return;
  }

  if ((pendingCustomPlayerBoot || currentStrategy === "mpegts" || currentStrategy === "caf-ts") &&
      (errorCode === 905 || errorCode === 104 || errorCode === 301)) {
    debugLog("player.error.suppressed_boot", {
      pendingCustomPlayerBoot,
      detailedErrorCode: detailCode,
      reason: event && event.reason ? event.reason : "",
    });
    return;
  }

  if (activeCustomPlayer && isCustomPlayerHealthy()) {
    debugLog("player.error.suppressed_custom", {
      activeCustomPlayer,
      activeCustomPlayerUrl,
      detailedErrorCode: detailCode,
      reason: event && event.reason ? event.reason : "",
    });
    return;
  }

  clearStallWatchdog();
  const reason = event && event.reason ? event.reason : "";
  const hint = getReceiverErrorHint(detailCode, reason);

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

  const currentUrl = currentUrlForError;
  const errorDetail = {
    type: event && event.type ? event.type : "",
    detailedErrorCode: detailCode,
    reason,
    hint,
    currentIndex: activeCandidateIndex,
    candidateCount: activeCandidates.length,
    currentUrl,
    strategy: getPlaybackStrategy(currentUrl),
  };
  setStatus(`Error (${activeCandidateIndex + 1}/${activeCandidates.length}): code ${detailCode} | ${hint}`);
  debugLog("player.error", errorDetail);

  void (async () => {
    if (!activeCustomPlayer) {
      const usedFallback = await tryHlsJsFallbackOnCurrentCandidate();
      if (usedFallback) return;
    }
    await tryLoadNextCandidateOnReceiverError("caf_error");
  })();
}, "ERROR");

safeAddPlayerEventListener(cast.framework.events.EventType.MEDIA_STATUS, (event) => {
  const status = playerManager.getMediaInformation();
  debugLog("player.media_status", {
    eventType: event && event.type ? event.type : "",
    mediaContentId: status && status.contentId ? status.contentId : "",
    mediaContentType: status && status.contentType ? status.contentType : "",
    activeCustomPlayer,
  });
}, "MEDIA_STATUS");

safeAddPlayerEventListener(cast.framework.events.EventType.REQUEST_LOAD, (event) => {
  try {
    const customData = asObject(event && event.requestData && event.requestData.customData);
    applyDebugConfigFromContract(normalizeContract(customData), customData);
  } catch (_e) {}
  showLoader("Connecting…");
  debugLog("player.request_load", {
    eventType: event && event.type ? event.type : "",
    hasRequestData: !!(event && event.requestData),
  });
}, "REQUEST_LOAD");

safeAddPlayerEventListener(cast.framework.events.EventType.PLAYER_LOADING, (event) => {
  ensureShakaRequestFilters();
  stopAvSyncWatchdog();
  const loadLabel = `Loading ${activeCandidateIndex + 1}/${Math.max(activeCandidates.length, 1)}…`;
  showLoader(loadLabel);
  setStatus(loadLabel);
  debugLog("player.loading", {
    eventType: event && event.type ? event.type : "",
    currentIndex: activeCandidateIndex,
    candidateCount: activeCandidates.length,
    activeCustomPlayer,
  });
  if (!activeCustomPlayer || !isCustomPlayerHealthy()) {
    armStallWatchdog("player.loading");
  }
}, "PLAYER_LOADING");

safeAddPlayerEventListener(cast.framework.events.EventType.PLAYER_PAUSE, (event) => {
  debugLog("player.pause", {
    eventType: event && event.type ? event.type : "",
    activeCustomPlayer,
  });
}, "PLAYER_PAUSE");

safeAddPlayerEventListener(cast.framework.events.EventType.PLAYER_PLAY, (event) => {
  clearStallWatchdog();
  onPlaybackStartedUi();
  setStatus("Playing");
  if (activeCustomPlayer) {
    startPlaybackKeepalive();
    installVolumeBridge();
  } else {
    startAvSyncWatchdog();
  }
  debugLog("player.play", {
    eventType: event && event.type ? event.type : "",
    activeCustomPlayer,
  });
}, "PLAYER_PLAY");

safeAddPlayerEventListener(cast.framework.events.EventType.PLAYER_LOAD_COMPLETE, (event) => {
  const currentUrl = activeCandidates[activeCandidateIndex] || "";
  debugLog("player.load_complete", {
    eventType: event && event.type ? event.type : "",
    currentUrl,
    activeCustomPlayer,
    hlsJsAvailable: hlsIsAvailable(),
  });
}, "PLAYER_LOAD_COMPLETE");

safeAddPlayerEventListener(cast.framework.events.EventType.MEDIA_FINISHED, () => {
  if (activeCustomPlayer) {
    debugLog("player.media_finished.suppressed", { activeCustomPlayer });
    keepCafPlayerAlive();
    return;
  }
  destroyHls();
  destroyDash();
  destroyMpegts();
  clearCustomPlayer();
}, "MEDIA_FINISHED");

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
    const engine = player && typeof player.getNetworkingEngine === "function"
      ? player.getNetworkingEngine()
      : null;
    if (!engine || typeof engine.registerRequestFilter !== "function") return;
    engine.registerRequestFilter((type, request) => {
      if (!request) return;
      const url = request.uris && request.uris[0] ? String(request.uris[0]) : "";
      const info = {
        url,
        headers: Object.assign({}, asObject(request.headers)),
      };
      applyNetworkPolicy(info, classifyCafShakaRequestType(type));
      request.headers = info.headers;
      request.allowCrossSiteCredentials = false;
    });
    shakaFilterRegistered = true;
    debugLog("network.shaka_filter.registered", {});
  } catch (e) {
    debugLog("network.shaka_filter.error", {
      message: e && e.message ? e.message : "unknown",
    });
  }
}

function createPlaybackConfig() {
  const playbackConfig = new cast.framework.PlaybackConfig();
  playbackConfig.manifestRequestHandler = (networkRequestInfo) => {
    applyNetworkPolicy(networkRequestInfo, "manifest");
    debugLog("network.caf.manifest", {
      url: String(networkRequestInfo.url || ""),
      headers: summarizeHeaders(networkRequestInfo.headers),
    });
  };
  playbackConfig.segmentRequestHandler = (networkRequestInfo) => {
    applyNetworkPolicy(networkRequestInfo, "segment");
    debugLog("network.caf.segment", {
      url: String(networkRequestInfo.url || "").slice(0, 240),
      headers: summarizeHeaders(networkRequestInfo.headers),
    });
  };
  playbackConfig.licenseRequestHandler = (networkRequestInfo) => {
    applyNetworkPolicy(networkRequestInfo, "license");
  };
  return playbackConfig;
}

context.start({
  playbackConfig: createPlaybackConfig(),
});

installVolumeBridge();
setBrandingVisible(true);

setStatus("PreetTV Receiver started");
debugLog("receiver.started", {
  href: window.location.href,
  debugEnabled,
  browserTestMode,
  useCastReceiver,
  hlsJsAvailable: typeof Hls !== "undefined" && Hls.isSupported(),
  hlsGlobalPresent: typeof Hls !== "undefined",
  dashJsAvailable: typeof dashjs !== "undefined",
  mpegtsAvailable: typeof mpegts !== "undefined" && mpegts.isSupported(),
  mediaSourcePresent: typeof window.MediaSource !== "undefined",
  customVideoElement: !!castVideoEl,
});
} else {
  initBrowserPlayback();
}
