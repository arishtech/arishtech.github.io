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
const DEFAULT_DEBUG_ENABLED = true;

window.__preettvDebug = debugHistory;
debugEnabled = DEFAULT_DEBUG_ENABLED || DEBUG_QUERY_FLAG;

let activeCandidates = [];
let activeCandidateIndex = 0;
let lastLoadTemplate = null;
let stallWatchdogTimer = null;
let stallWatchdogSerial = 0;
const STALL_WATCHDOG_MS = 12000;

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

window.addEventListener("unhandledrejection", (ev) => {
  const reason = ev && ev.reason;
  const message = reason && reason.message ? reason.message : String(reason || "unknown");
  if (typeof debugLog === "function") {
    debugLog("receiver.unhandledrejection", { reason: message });
  }
  if (message === "HttpStatusCodeInvalid" || message.includes("HttpStatusCodeInvalid")) {
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

function destroyMpegts() {
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

function getPlaybackStrategy(url, options) {
  const forBrowser = !!(options && options.forBrowser);
  if (isProgressiveCandidate(url)) return "native";
  if (isDashCandidate(url)) return "dashjs";
  if (isTsCandidate(url)) return "mpegts";
  // IPTV m3u8 playlists usually carry MPEG-TS segments — Chromecast native HLS (905).
  if (isHlsCandidate(url)) return (isLikelyLiveStream(url) || forBrowser) ? "hlsjs" : "caf-hls";
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
  try {
    const host = new URL(String(url || "")).host.toLowerCase();
    if (host.includes("vueott") || host.includes("line.") || host.includes("ott")) {
      return 0;
    }
  } catch (_e) {}
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
      host.endsWith(".netlify.app")
    );
  } catch (_e) {}
  return false;
}

function isVueottStyleUrl(url) {
  const lower = String(url || "").toLowerCase();
  return lower.includes("vueott") || lower.includes("/play/live.php");
}

function toTsVariant(url) {
  return (
    rewriteQueryParam(url, "extension", "ts") ||
    rewriteQueryParam(url, "ext", "ts") ||
    appendQueryParam(url, "extension", "ts")
  );
}

function vueottNeedsDirectTsOnly() {
  const playback = asObject(activeContract.playback);
  if (playback.vueottPreferTs === true) return true;
  return isStaticHosting() || !isProxyEnabled();
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

function buildIptvRequestHeaders(requestUrl, uaIndex) {
  const info = { url: normalizeCandidateUrl(requestUrl), headers: {} };
  const chosenUa = IPTV_USER_AGENTS[
    Number.isInteger(uaIndex) ? uaIndex : activeIptvUaIndex
  ] || DEFAULT_IPTV_USER_AGENT;
  info.headers["User-Agent"] = chosenUa;
  mergeRequestHeaders(info);
  try {
    const origin = new URL(info.url);
    const referer = `${origin.protocol}//${origin.host}/`;
    if (!Object.keys(info.headers).some((name) => name.toLowerCase() === "referer")) {
      info.headers.Referer = referer;
    }
    info.headers.Origin = `${origin.protocol}//${origin.host}`;
  } catch (_e) {}
  return info.headers;
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
  const uaStart = options && Number.isInteger(options.uaStart) ? options.uaStart : activeIptvUaIndex;
  const attempts = [];

  function tryUa(uaIndex) {
    const headers = buildIptvRequestHeaders(target, uaIndex);
    const fetchUrl = resolveFetchUrl(target, options && options.requestType ? options.requestType : "manifest");
    if (typeof fetch !== "function") {
      return Promise.resolve({ ok: false, attempts: [{ uaIndex, error: "fetch_unavailable" }] });
    }
    return fetch(fetchUrl, { method: "GET", headers, cache: "no-store" })
      .then((response) => {
        const status = response.status;
        const reader = responseType === "arraybuffer" ? response.arrayBuffer() : response.text();
        return reader.then((data) => {
          const hasBody = responseType === "arraybuffer" ? hasBinaryBody(data) : hasTextBody(data);
          const playlist = isPlaylistText(data);
          const attempt = {
            uaIndex,
            status,
            hasBody,
            playlist,
            userAgent: headers["User-Agent"],
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
        attempts.push({
          uaIndex,
          error: error && error.message ? error.message : "fetch_error",
          userAgent: headers["User-Agent"],
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
    void tryLoadNextCandidateOnReceiverError("watchdog");
  }, STALL_WATCHDOG_MS);
}

function summarizeHeaders(headers) {
  const h = asObject(headers);
  const keys = Object.keys(h);
  return { count: keys.length, keys };
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
    hosting: asObject(root.hosting),
    playback: asObject(root.playback),
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
    return normalizeCandidateUrl(u.toString());
  } catch (_e) {
    return null;
  }
}

function appendQueryParam(url, key, value) {
  try {
    const u = new URL(url);
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
    [/([?&])stream-/gi, "$1stream="],
    [/([?&])mac-/gi, "$1mac="],
    [/([?&])output-/gi, "$1output="],
    [/([?&])format-/gi, "$1format="],
    [/([?&])type-/gi, "$1type="],
    [/([?&])ext-(?!ension)/gi, "$1ext="],
  ];
  separatorFixes.forEach(([pattern, replacement]) => {
    out = out.replace(pattern, replacement);
  });

  out = out.replace(/source group/gi, "source_group");
  out = out.replace(/play token/gi, "play_token");

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
  const isVueottStyle = isVueottStyleUrl(baseUrl);
  const vueottTsOnly = isVueottStyle && vueottNeedsDirectTsOnly();

  if (vueottTsOnly) {
    // Static Cast receivers (github.io) cannot proxy; vueott m3u8 returns HTTP 458 on Cast.
    push(toTsVariant(baseUrl) || normalizeCandidateUrl(baseUrl));
    if (looksTs) {
      push(normalizeCandidateUrl(baseUrl));
    }
  } else if (isVueottStyle) {
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

  if (looksLikeLivePhp && !extensionHint && !vueottTsOnly) {
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

  if (looksHls && !vueottTsOnly) {
    push(rewriteQueryParam(baseUrl, "extension", "ts"));
    push(rewriteQueryParam(baseUrl, "ext", "ts"));
  }

  if (customData && Array.isArray(customData.candidateUrls)) {
    customData.candidateUrls.forEach((candidateUrl) => {
      if (!vueottTsOnly) {
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
        vueottTsOnly: vueottNeedsDirectTsOnly(),
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
    maxLiveSyncPlaybackRate: 1.2,
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
    stashInitialSize: 1280 * 1024,
    liveBufferLatencyChasing: false,
    liveSync: true,
    autoCleanupSourceBuffer: true,
  };
}

function markCandidatesExhausted(reason) {
  if (candidatesExhausted) return;
  candidatesExhausted = true;
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
    return "Network/open failure: check auth headers, token expiry, and proxy/CORS behavior";
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

  const mediaSrc = readVideoBlobUrl();
  if (mediaSrc) {
    selectedLoad.media.contentUrl = mediaSrc;
    selectedLoad.media.contentId = sourceUrl;
    selectedLoad.media.contentType = "video/mp4";
  } else {
    selectedLoad.media.contentId = sourceUrl;
    selectedLoad.media.contentUrl = sourceUrl;
    selectedLoad.media.contentType = playerType === "dashjs" ? "application/dash+xml" : "video/mp4";
  }

  selectedLoad.media.streamType = cast.framework.messages.StreamType.LIVE;
  selectedLoad.customData = Object.assign({}, asObject(selectedLoad.customData), {
    _customPlayer: playerType,
    _customPlayerUrl: sourceUrl,
  });

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

function startMpegtsPlayback(sourceUrl, selectedLoad) {
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
      debugLog("mpegts.preload_failed", { url: sourceUrl, reason, index: activeCandidateIndex, mpegtsUaAttempts });
      reject(new Error(reason || "mpegts preload failed"));
    }

    function attachMpegtsPlayer(playbackUrl) {
      const headers = buildIptvRequestHeaders(sourceUrl);
      destroyMpegts();
      mpegtsInstance = mpegts.createPlayer({
        type: "mpegts",
        isLive: true,
        url: playbackUrl,
        headers: headers,
        hasAudio: true,
        hasVideo: true,
      }, buildMpegtsPlayerConfig());

      mpegtsInstance.on(mpegts.Events.ERROR, (errorType, errorDetail) => {
        debugLog("mpegts.error", {
          errorType,
          errorDetail,
          url: playbackUrl,
          index: activeCandidateIndex,
          mpegtsUaAttempts,
        });
        const invalidStatus = String(errorDetail || "").indexOf("HttpStatusCodeInvalid") >= 0;
        if (!settled && invalidStatus && mpegtsUaAttempts < IPTV_USER_AGENTS.length - 1) {
          mpegtsUaAttempts += 1;
          rotateIptvUserAgent("mpegts_status_retry");
          try {
            attachMpegtsPlayer(getMpegtsPlaybackUrl());
            mpegtsInstance.attachMediaElement(castVideoEl);
            mpegtsInstance.load();
            const playResult = mpegtsInstance.play();
            if (playResult && typeof playResult.catch === "function") {
              playResult.catch((playErr) => {
                failPreload(playErr && playErr.message ? playErr.message : "mpegts play failed");
              });
            }
          } catch (retryErr) {
            failPreload(retryErr && retryErr.message ? retryErr.message : "mpegts retry failed");
          }
          return;
        }
        if (!settled) {
          failPreload(String(errorDetail || errorType || "mpegts fatal"));
          return;
        }
        onCustomPlayerFatalError("mpegts", String(errorDetail || errorType || "fatal"));
      });
    }

    function getMpegtsPlaybackUrl() {
      const normalized = normalizeCandidateUrl(sourceUrl);
      return resolveFetchUrl(normalized, "segment");
    }

    const onPlaying = () => {
      if (settled) return;
      const finalized = finalizeCustomPlayerLoad(selectedLoad, sourceUrl, "mpegts");
      debugLog("mpegts.playing", {
        url: sourceUrl,
        index: activeCandidateIndex,
        mediaSrc: readVideoBlobUrl(),
      });
      setStatus("Playing (MPEG-TS)");
      settle(finalized);
    };

    if (castVideoEl) {
      castVideoEl.addEventListener("playing", onPlaying, { once: true });
      castVideoEl.addEventListener("canplay", onPlaying, { once: true });
    }

    function beginMpegtsPlayback() {
      const playbackUrl = getMpegtsPlaybackUrl();
      attachMpegtsPlayer(playbackUrl);
      debugLog("mpegts.start", {
        url: sourceUrl,
        playbackUrl,
        proxied: isProxyEnabled(),
        index: activeCandidateIndex,
        headers: Object.keys(buildIptvRequestHeaders(sourceUrl)),
        urlCheck: inspectStreamUrl(sourceUrl),
        userAgent: IPTV_USER_AGENTS[activeIptvUaIndex],
      });
      armStallWatchdog("mpegts.start");
      mpegtsInstance.attachMediaElement(castVideoEl);
      mpegtsInstance.load();
      const playResult = mpegtsInstance.play();
      if (playResult && typeof playResult.catch === "function") {
        playResult.catch((playErr) => {
          failPreload(playErr && playErr.message ? playErr.message : "mpegts play failed");
        });
      }
    }

    try {
      void probeStreamUrl(sourceUrl).then((probe) => {
        debugLog("mpegts.probe", { url: sourceUrl, index: activeCandidateIndex, probe });
        if (settled) return;
        beginMpegtsPlayback();
      }).catch(() => {
        if (!settled) beginMpegtsPlayback();
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
  setStatus(`Retrying candidate ${activeCandidateIndex + 1}/${activeCandidates.length}`);
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
    applyDebugConfigFromContract(activeContract);
    hlsJsFallbackUsedForIndex = -1;
    candidatesExhausted = false;
    iptvDirectBlocked458 = false;
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
    });

    activeCandidates = buildCompatibilityCandidates(baseUrl, customData);
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

    const selectedUrl = activeCandidates[activeCandidateIndex] || baseUrl;
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

    if (strategy === "mpegts") {
      return startMpegtsPlayback(selectedUrl, selectedLoad).catch((err) => (
        handleCustomInterceptorFailure("mpegts", err, selectedLoad, selectedUrl)
      ));
    }

    if (strategy === "hlsjs") {
      return startHlsJsPlayback(selectedUrl, selectedLoad).catch((err) => (
        handleCustomInterceptorFailure("hlsjs", err, selectedLoad, selectedUrl)
      ));
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

  if ((pendingCustomPlayerBoot || getPlaybackStrategy(activeCandidates[activeCandidateIndex] || "") === "mpegts") &&
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

  const currentUrl = activeCandidates[activeCandidateIndex] || "";
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
    activeCustomPlayer,
  });
  if (!activeCustomPlayer) {
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
  setStatus("Playing");
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
  destroyHls();
  destroyDash();
  destroyMpegts();
  clearCustomPlayer();
}, "MEDIA_FINISHED");

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
