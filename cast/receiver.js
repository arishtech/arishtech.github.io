/* global cast, Hls, dashjs, mpegts */
// receiver.js — PreetTV Cast custom receiver (CAF v3)
// Compatible with Android sender: customData.streamRequest { url, contentType, headers },
// customData.auth.headers, and optional customData.headers.

const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();
/** Custom namespace (sender ↔ receiver); also used for playbackFailed notifications. */
const PREET_MSG_NS = "urn:x-cast:com.arishtech.preetplayer";

/** @param {unknown} value */
function stringifyForLog(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch (_e) {
    return String(value);
  }
}

/**
 * Flatten CAF / JS errors for the on-screen log (and console).
 * @param {unknown} err
 */
function formatAnyError(err) {
  if (err == null) return "(null)";
  if (typeof err === "string") return err;
  if (typeof err === "number" || typeof err === "boolean") return String(err);
  if (err instanceof Error) return err.stack || err.message || String(err);
  const o = /** @type {Record<string, unknown>} */ (err);
  const message = typeof o.message === "string" && o.message.trim() ? o.message.trim() : "";
  const reason = o.reason != null ? String(o.reason).trim() : "";
  const type = o.type != null ? String(o.type) : "";
  const errorType = o.errorType != null ? String(o.errorType) : "";
  const detailedErrorCode = o.detailedErrorCode != null ? String(o.detailedErrorCode) : "";
  const parts = [message, reason, type, errorType, detailedErrorCode].filter((p) => p.length > 0);
  if (parts.length) return parts.join(" | ");
  try {
    return JSON.stringify(err);
  } catch (_e) {
    return String(err);
  }
}

/**
 * Human-readable Cast / MPL error (see Cast web_receiver error_codes).
 * @param {unknown} code
 */
function describeDetailedErrorCode(code) {
  const n = typeof code === "number" ? code : parseInt(String(code == null ? "" : code).replace(/\D/g, "").slice(0, 9), 10);
  if (!Number.isFinite(n)) return "";
  const table = {
    100: "MEDIA_UNKNOWN",
    101: "MEDIA_ABORTED",
    102: "MEDIA_DECODE",
    103: "MEDIA_NETWORK",
    104: "MEDIA_SRC_NOT_SUPPORTED (raw TS / codec not playable in default Cast <video>)",
    110: "SOURCE_BUFFER_FAILURE",
    201: "MEDIAKEYS_NETWORK",
    202: "MEDIAKEYS_UNSUPPORTED",
    203: "MEDIAKEYS_WEBCRYPTO",
    300: "NETWORK_UNKNOWN",
    301: "SEGMENT_NETWORK",
    311: "HLS_NETWORK_MASTER_PLAYLIST",
    312: "HLS_NETWORK_PLAYLIST",
    313: "HLS_NETWORK_NO_KEY_RESPONSE",
    314: "HLS_NETWORK_KEY_LOAD",
    315: "HLS_NETWORK_INVALID_SEGMENT",
    316: "HLS_SEGMENT_PARSING",
    321: "DASH_NETWORK",
    322: "DASH_NO_INIT",
    331: "SMOOTH_NETWORK",
    332: "SMOOTH_NO_MEDIA_DATA",
    411: "HLS_MANIFEST_MASTER",
    412: "HLS_MANIFEST_PLAYLIST",
    421: "DASH_MANIFEST_NO_PERIODS",
    422: "DASH_MANIFEST_NO_MIMETYPE",
    423: "DASH_INVALID_SEGMENT_INFO",
    431: "SMOOTH_MANIFEST",
    900: "APP (exception outside framework)",
    901: "BREAK_CLIP_LOADING_ERROR",
    902: "BREAK_SEEK_INTERCEPTOR_ERROR",
    903: "IMAGE_ERROR",
    904: "LOAD_INTERRUPTED",
    905: "LOAD_FAILED",
    906: "MEDIA_ERROR_MESSAGE",
    909: "GENERIC",
  };
  if (table[n]) return table[n];
  const head3 = parseInt(String(Math.floor(n)).replace(/\D/g, "").slice(0, 3), 10);
  if (Number.isFinite(head3) && table[head3]) {
    return table[head3] + " (suffix " + n + " — may embed HTTP subcode)";
  }
  return "Cast/MPL code — see developers.google.com/cast/docs/web_receiver/error_codes";
}

/**
 * @param {unknown} event CAF player ERROR event
 */
function formatPlayerErrorEvent(event) {
  if (!event) return "ERROR (null event)";
  const e = /** @type {Record<string, unknown>} */ (event);
  const bits = [];
  if (e.detailedErrorCode != null) {
    const c = e.detailedErrorCode;
    const desc = describeDetailedErrorCode(c);
    bits.push("detailedErrorCode=" + c + (desc ? " → " + desc : ""));
  }
  if (e.reason != null && String(e.reason).trim()) bits.push("reason=" + String(e.reason).trim());
  if (e.error) bits.push("error=" + formatAnyError(e.error));
  if (e.type) bits.push("type=" + String(e.type));
  if (e.severity != null) bits.push("severity=" + e.severity);
  if (!bits.length) {
    try {
      bits.push("raw=" + JSON.stringify(event));
    } catch (_e) {
      bits.push("raw=" + String(event));
    }
  }
  return bits.join(" | ");
}

function timeStamp() {
  try {
    return new Date().toISOString().slice(11, 23);
  } catch (_e) {
    return "??:??:??.???";
  }
}

/** When false, log() still writes to console but skips #debug (Cast “debug log” switch off). */
let receiverLogToDomEnabled = false;

/**
 * URL overrides: ?log=1 & ?receiverLog=0 & ?castDebug=1 & ?dock=1 (same semantics as legacy ?dock=).
 * @returns {boolean|null} true/false if URL expresses a preference, null if absent
 */
function computeUrlPreferenceForReceiverLog() {
  try {
    const params = new URLSearchParams(window.location.search);
    const keys = ["log", "receiverLog", "receiverlog", "castdebug", "dock"];
    let saw = false;
    let want = false;
    for (let i = 0; i < keys.length; i++) {
      const raw = params.get(keys[i]);
      if (raw == null) continue;
      saw = true;
      const s = String(raw).trim().toLowerCase();
      if (s === "0" || s === "false" || s === "no" || s === "off") return false;
      if (s === "1" || s === "true" || s === "yes" || s === "on" || s === "") want = true;
    }
    return saw ? want : null;
  } catch (_e) {
    return null;
  }
}

/**
 * Matches Android Cast debug payload (Settings → Cast debug): customData.debug + castDebugEnabled.
 * @param {unknown} customData
 */
function senderWantsReceiverLogPanel(customData) {
  if (!customData || typeof customData !== "object") return false;
  const cd = /** @type {Record<string, unknown>} */ (customData);
  if (cd.castDebugEnabled === true) return true;
  const d = cd.debug;
  if (d && typeof d === "object") {
    const dbg = /** @type {Record<string, unknown>} */ (d);
    if (dbg.showReceiverLog === false) return false;
    if (dbg.showReceiverLog === true) return true;
    if (dbg.enabled === true || dbg.showUi === true) return true;
  }
  return false;
}

/**
 * @param {unknown} customData LOAD customData (may be null at startup)
 * @param {string} [reason]
 */
function syncReceiverLogPanelFromSources(customData, reason) {
  const urlPref = computeUrlPreferenceForReceiverLog();
  let want = false;
  if (urlPref === true) want = true;
  else if (urlPref === false) want = false;
  else want = senderWantsReceiverLogPanel(customData);
  receiverLogToDomEnabled = !!want;
  const el = document.getElementById("debug");
  if (el) {
    el.classList.toggle("receiver-log-hidden", !receiverLogToDomEnabled);
    el.setAttribute("aria-hidden", receiverLogToDomEnabled ? "false" : "true");
  }
  console.log("[receiver] log panel " + (receiverLogToDomEnabled ? "ON" : "OFF") + (reason ? " — " + reason : ""));
}

/* ---------- Cast receiver UI: loader, top branding (title + channel subtitle), auto-hide loader ---------- */

function setReceiverLoaderVisible(visible) {
  const el = document.getElementById("castLoader");
  if (!el) return;
  el.classList.toggle("receiver-loader-hidden", !visible);
  el.setAttribute("aria-hidden", visible ? "false" : "true");
  el.setAttribute("aria-busy", visible ? "true" : "false");
}

/** Product branding stays in HTML (#castBrandTitle); LOAD fills the channel line below it. */
function setReceiverChannelSubtitle(text) {
  const el = document.getElementById("castChannelSubtitle");
  if (!el) return;
  const t = text && String(text).trim() ? String(text).trim() : "Preet Player";
  el.textContent = t;
}

function readCastMediaMetadataTitle(metadata) {
  if (!metadata) return "";
  try {
    const MD = cast.framework.messages.MediaMetadata;
    if (typeof metadata.getString === "function" && MD && MD.KEY_TITLE != null) {
      const t = metadata.getString(MD.KEY_TITLE);
      if (t && String(t).trim()) return String(t).trim();
    }
  } catch (_e) {}
  return "";
}

function extractChannelLabelFromLoadRequest(loadRequestData) {
  if (!loadRequestData || typeof loadRequestData !== "object") return "Preet Player";
  const lr = /** @type {Record<string, unknown>} */ (loadRequestData);
  const cd = lr.customData;
  if (cd && typeof cd === "object") {
    const cn = String(/** @type {Record<string, unknown>} */ (cd).channelName || "").trim();
    if (cn) return cn;
  }
  const media = lr.media;
  if (media && typeof media === "object") {
    const mo = /** @type {Record<string, unknown>} */ (media);
    const meta = readCastMediaMetadataTitle(mo.metadata);
    if (meta) return meta;
  }
  return "Preet Player";
}

var CAST_FAILED_DETAIL_MAX = 220;
/** CAF often emits benign ERROR / video `error` while stub → custom player attaches; wait before showing UI. */
var CAST_FAILED_DEBOUNCE_MS = 3000;
/** @type {ReturnType<typeof setTimeout>|null} */
var castFailedUiTimer = null;

function cancelPendingCastingFailedMessage() {
  if (castFailedUiTimer != null) {
    clearTimeout(castFailedUiTimer);
    castFailedUiTimer = null;
  }
}

function hideCastingFailedOverlay() {
  cancelPendingCastingFailedMessage();
  const o = document.getElementById("castFailedOverlay");
  if (!o) return;
  o.style.display = "none";
  o.setAttribute("aria-hidden", "true");
}

/** Cancel pending failure toast and hide overlay (call when playback clearly recovered). */
function clearCastingFailureUi() {
  hideCastingFailedOverlay();
}

/**
 * Apply failure overlay immediately (internal).
 * @param {string} [detail]
 */
function applyCastingFailedOverlayNow(detail) {
  const o = document.getElementById("castFailedOverlay");
  const detailEl = document.getElementById("castFailedDetail");
  if (!o) return;
  var d = detail && String(detail).trim() ? String(detail).trim() : "";
  if (d.length > CAST_FAILED_DETAIL_MAX) {
    d = d.slice(0, CAST_FAILED_DETAIL_MAX) + "…";
  }
  if (detailEl) {
    detailEl.textContent = d || "This stream could not be played on Chromecast. Try another format or continue on your phone.";
  }
  setReceiverLoaderVisible(false);
  o.style.display = "flex";
  o.setAttribute("aria-hidden", "false");
}

/**
 * Show after CAST_FAILED_DEBOUNCE_MS unless cancelled (e.g. by playback starting).
 * @param {string} [detail]
 */
function scheduleCastingFailedMessage(detail) {
  cancelPendingCastingFailedMessage();
  var d = detail && String(detail).trim() ? String(detail).trim() : "";
  if (d.length > CAST_FAILED_DETAIL_MAX) {
    d = d.slice(0, CAST_FAILED_DETAIL_MAX) + "…";
  }
  castFailedUiTimer = setTimeout(function () {
    castFailedUiTimer = null;
    preetAttemptSelfHeal("failure-debounce", d);
  }, CAST_FAILED_DEBOUNCE_MS);
}

/**
 * No delay — use for LOAD / setup failures that will not self-heal.
 * @param {string} [detail]
 */
function showCastingFailedMessageImmediate(detail) {
  cancelPendingCastingFailedMessage();
  applyCastingFailedOverlayNow(detail);
}

function wireReceiverLoaderAutoDismissOnce() {
  const v = document.getElementById("castVideo");
  if (!v || v.dataset.preetLoaderDismiss) return;
  v.dataset.preetLoaderDismiss = "1";
  function hideLoaderOnly() {
    setReceiverLoaderVisible(false);
  }
  function onPlaybackProgress() {
    hideLoaderOnly();
    markPlaybackProgress();
  }
  v.addEventListener("playing", onPlaybackProgress);
  v.addEventListener("canplaythrough", onPlaybackProgress);
  v.addEventListener("error", function () {
    hideLoaderOnly();
    try {
      var err = v.error;
      var bits = [];
      if (err && err.code != null) bits.push("code " + err.code);
      if (err && err.message) bits.push(String(err.message));
      scheduleCastingFailedMessage(bits.length ? bits.join(" — ") : "The video element reported a playback error.");
    } catch (_e2) {
      scheduleCastingFailedMessage("Video playback error.");
    }
  });
}

wireReceiverLoaderAutoDismissOnce();

/**
 * Append one line to #debug (DOM text nodes — selectable, no innerHTML).
 * @param {string} line
 * @param {"info"|"error"|"warn"} level
 */
function appendLogLine(line, level) {
  if (!receiverLogToDomEnabled) return;
  const root = document.getElementById("debug");
  if (!root) return;
  const row = document.createElement("div");
  row.className = "log-row " + (level === "error" ? "log-row-error" : level === "warn" ? "log-row-warn" : "");
  row.textContent = "[" + timeStamp() + "] " + line;
  root.appendChild(row);
  root.scrollTop = root.scrollHeight;
}

/**
 * @param {unknown} msg
 * @param {"info"|"error"|"warn"} [level]
 */
function log(msg, level) {
  const line = typeof msg === "string" ? msg : stringifyForLog(msg);
  const lv = level || "info";
  if (lv === "error") {
    console.error(line);
  } else if (lv === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
  appendLogLine(line, lv);
}

function logError(msg) {
  log(msg, "error");
}

function logWarn(msg) {
  log(msg, "warn");
}

syncReceiverLogPanelFromSources(null, "startup (URL only; LOAD applies sender switch)");

log("=================================");
log("PreetTV Cast Receiver Starting");
log("=================================");

window.addEventListener("error", (ev) => {
  const msg = ev && ev.message ? ev.message : "window.error";
  const file = ev && ev.filename ? ev.filename : "";
  const line = ev && ev.lineno != null ? String(ev.lineno) : "";
  logError("window.onerror: " + msg + (file ? " @ " + file + ":" + line : ""));
});

window.addEventListener("unhandledrejection", (ev) => {
  logError("unhandledrejection: " + formatAnyError(ev && ev.reason));
});

/**
 * Flatten IPTV headers from PreetTV-Android customData (streamRequest + auth + legacy root).
 */
function extractPlaybackHeaders(customData) {
  const out = {};
  const cd = customData && typeof customData === "object" ? customData : {};
  const merge = (h) => {
    if (!h || typeof h !== "object") return;
    Object.keys(h).forEach((k) => {
      const v = h[k];
      if (v != null && String(v).trim() !== "") {
        out[k] = String(v);
      }
    });
  };
  const sr = cd.streamRequest && typeof cd.streamRequest === "object" ? cd.streamRequest : null;
  merge(sr && sr.headers);
  merge(cd.auth && cd.auth.headers);
  merge(cd.headers);
  return out;
}

var PREET_BROWSER_UA =
  "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

/** IPTV portal URLs (vueott live.php, etc.) 302 to a CDN edge — must not skip redirect probe. */
function isIptvPortalRedirectUrl(url) {
  const u = String(url || "").toLowerCase();
  return u.includes("live.php") || u.includes("vueott") || u.includes("klaratv.com");
}

function isVueottStyleUrl(url) {
  const u = String(url || "").toLowerCase();
  return u.includes("vueott") || u.includes("/play/live.php") || u.includes("/live.php");
}

/**
 * Headers matched to the URL being fetched (Referer/Origin host + vueott browser UA + cookie).
 * @param {string} playbackUrl
 * @param {unknown} customData
 */
function buildHeadersForPlaybackUrl(playbackUrl, customData) {
  const hdr = Object.assign({}, extractPlaybackHeaders(customData));
  const cd = asObject(customData);
  const compatCookie = String(cd.compatCookie || "").trim();
  if (compatCookie && !hdr.Cookie && !hdr.cookie) {
    hdr.Cookie = compatCookie;
  }
  const u = String(playbackUrl || "").trim();
  const lower = u.toLowerCase();
  if (isVueottStyleUrl(u) || lower.includes("klaratv.com")) {
    const ua = String(hdr["User-Agent"] || "");
    if (!ua || ua.toLowerCase().indexOf("vlc") >= 0 || ua.toLowerCase().indexOf("preet") >= 0) {
      hdr["User-Agent"] = PREET_BROWSER_UA;
    }
  }
  try {
    const parsed = new URL(u);
    const origin = parsed.protocol + "//" + parsed.host;
    hdr.Referer = origin + "/";
    hdr.Origin = origin;
  } catch (_e) {}
  if (!hdr.Accept) hdr.Accept = "*/*";
  if (!hdr["Accept-Encoding"]) hdr["Accept-Encoding"] = "identity";
  hdr.Connection = "keep-alive";
  return hdr;
}

/**
 * vueott / live.php: phone often plays CDN edge while cast candidates still list the portal URL.
 * @param {string} candidateUrl
 * @param {unknown} customData
 */
function preferResolvedEdgeUrlForPortal(candidateUrl, customData) {
  if (!isVueottStyleUrl(candidateUrl)) return candidateUrl;
  const cd = asObject(customData);
  const sr = asObject(cd.streamRequest);
  const phoneResolved = String(cd.phoneResolvedUrl || sr.url || "").trim();
  if (phoneResolved && !isVueottStyleUrl(phoneResolved) && phoneResolved !== candidateUrl) {
    log("vueott: using phone-resolved edge URL (not portal live.php)");
    return phoneResolved;
  }
  return candidateUrl;
}

/**
 * Detect mime type from URL
 */
function detectMimeTypeFromUrl(url) {
  const lower = String(url || "").toLowerCase();
  if (lower.includes(".m3u8") || lower.includes("extension=m3u8") || lower.includes("ext=m3u8")) {
    return "application/x-mpegURL";
  }
  if (lower.includes(".mpd")) {
    return "application/dash+xml";
  }
  if (lower.includes(".mp4")) {
    return "video/mp4";
  }
  if (lower.includes(".mp3")) {
    return "audio/mpeg";
  }
  if (lower.includes(".aac")) {
    return "audio/aac";
  }
  if (lower.includes(".ts") || lower.includes("extension=ts") || lower.includes("ext=ts")) {
    return "video/mp2t";
  }
  return null;
}

/**
 * Detect mime type from Content-Type header
 */
function detectMimeTypeFromHeader(contentType) {
  if (!contentType) {
    return null;
  }
  const lower = contentType.toLowerCase();
  if (
    lower.includes("application/vnd.apple.mpegurl") ||
    lower.includes("application/x-mpegurl") ||
    lower.includes("mpegurl")
  ) {
    return "application/x-mpegURL";
  }
  if (lower.includes("dash+xml")) {
    return "application/dash+xml";
  }
  if (lower.includes("video/mp4")) {
    return "video/mp4";
  }
  if (lower.includes("audio/mpeg")) {
    return "audio/mpeg";
  }
  if (lower.includes("audio/aac")) {
    return "audio/aac";
  }
  if (lower.includes("video/mp2t")) {
    return "video/mp2t";
  }
  return null;
}

/** @param {unknown} v */
function asObject(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) return /** @type {Record<string, unknown>} */ (v);
  return {};
}

/** @param {unknown} value */
function isTruthyFlag(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

function isHlsCandidate(url) {
  const s = String(url || "").toLowerCase();
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

function isTsCandidate(url) {
  const s = String(url || "").toLowerCase();
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

function isDashCandidate(url) {
  const s = String(url || "").toLowerCase();
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

function isProgressiveCandidate(url) {
  const s = String(url || "").toLowerCase();
  if (s.endsWith(".mp4") || s.endsWith(".webm") || s.endsWith(".mov") || s.endsWith(".m4v")) return true;
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
  const s = String(url || "").toLowerCase();
  return (
    s.includes("/live/play/") ||
    s.includes("/live.php") ||
    s.includes("/live/") ||
    s.includes("/play/") ||
    s.includes("/iptv/") ||
    s.includes("/hls/")
  );
}

function shouldAttemptHlsJs(url) {
  if (isProgressiveCandidate(url) || isDashCandidate(url) || isTsCandidate(url)) return false;
  if (isHlsCandidate(url)) return true;
  if (isLikelyLiveStream(url)) return true;
  try {
    const u = new URL(url);
    const path = u.pathname || "";
    if (path && !path.substring(1).includes(".")) return true;
  } catch (_e) {}
  return false;
}

/**
 * Raw MPEG-TS cannot play in CAF/Shaka or <video> — mpegts.js is mandatory.
 * @param {unknown} customData
 * @param {string} url
 * @param {string} mimeHint
 */
function isTsPlaybackRequired(customData, url, mimeHint) {
  const m = String(mimeHint || "").toLowerCase();
  const cd = asObject(customData);
  const playback = asObject(cd.playback);
  const bootstrap = asObject(cd.streamBootstrap);
  const prefer = String(bootstrap.preferReceiverEngine || "auto").trim().toLowerCase();
  const u = String(url || "");
  return (
    prefer === "mpegts" ||
    prefer === "caf-ts" ||
    isTsCandidate(u) ||
    m.includes("mp2t") ||
    m.includes("mpegts") ||
    isTruthyFlag(playback.phonePlayingAsTs)
  );
}

/** @param {PreetCastSession|null} session */
function sessionRequiresMpegts(session) {
  if (!session) return false;
  return isTsPlaybackRequired(session.customData, session.currentUrl, session.resolvedMime);
}

/**
 * Pick playback stack from PreetTV-Android customData + URL + MIME (no fixed default to HLS).
 * @param {unknown} customData
 * @param {string} url
 * @param {string} mimeHint
 */
function choosePlaybackEngine(customData, url, mimeHint) {
  const cd = asObject(customData);
  const playback = asObject(cd.playback);
  const bootstrap = asObject(cd.streamBootstrap);
  const prefer = String(bootstrap.preferReceiverEngine || "auto").trim().toLowerCase();
  const phHls = isTruthyFlag(playback.phonePlayingAsHls);
  const phTs = isTruthyFlag(playback.phonePlayingAsTs);
  const phDash = isTruthyFlag(playback.phonePlayingAsDash);
  const ch = String(playback.channelStreamType || "").toLowerCase();
  const u = String(url || "");
  const m = String(mimeHint || "").toLowerCase();

  if (prefer === "dashjs" || prefer === "dash") {
    if (typeof dashjs !== "undefined") return { engine: "dashjs", reason: "streamBootstrap.preferReceiverEngine=" + prefer };
    return { engine: "caf", reason: "preferReceiverEngine=dashjs but dash.js not loaded — CAF" };
  }
  if (prefer === "hlsjs" || prefer === "hls") {
    if (typeof Hls !== "undefined" && Hls.isSupported()) return { engine: "hlsjs", reason: "streamBootstrap.preferReceiverEngine=" + prefer };
    return { engine: "caf", reason: "preferReceiverEngine=hlsjs but Hls.js not loaded — CAF+Shaka" };
  }
  if (prefer === "mpegts" || prefer === "caf-ts") {
    if (typeof mpegts !== "undefined" && mpegts.isSupported()) {
      return { engine: "mpegts", reason: "streamBootstrap.preferReceiverEngine=" + prefer + " → mpegts.js" };
    }
    return { engine: "mpegts", reason: "TS required (prefer=" + prefer + ") — CAF cannot play raw TS" };
  }

  if (prefer !== "auto" && prefer) {
    logWarn("Unknown streamBootstrap.preferReceiverEngine=" + prefer + " — using auto rules");
  }

  if (isProgressiveCandidate(u)) return { engine: "caf", reason: "progressive container (CAF native)" };

  if ((phDash || ch.includes("dash") || ch.includes("mpd")) && isDashCandidate(u)) {
    if (typeof dashjs !== "undefined") return { engine: "dashjs", reason: "DASH (sender or URL) + dash.js" };
    return { engine: "caf", reason: "DASH URL, dash.js missing — CAF" };
  }
  if (isDashCandidate(u)) {
    if (typeof dashjs !== "undefined") return { engine: "dashjs", reason: "DASH URL" };
    return { engine: "caf", reason: "DASH URL, dash.js missing" };
  }

  const tsMime = m.includes("mp2t") || m.includes("mpegts");
  if (phTs || isTsCandidate(u) || tsMime) {
    if (typeof mpegts !== "undefined" && mpegts.isSupported()) {
      return { engine: "mpegts", reason: "TS / video/mp2t or phonePlayingAsTs" };
    }
    return { engine: "mpegts", reason: "TS / video/mp2t — CAF cannot play raw TS" };
  }

  if (phHls && isHlsCandidate(u)) {
    if (typeof Hls !== "undefined" && Hls.isSupported()) return { engine: "hlsjs", reason: "phonePlayingAsHls + HLS URL (match phone)" };
    return { engine: "caf", reason: "phonePlayingAsHls but Hls.js missing — CAF+Shaka" };
  }
  if (ch.includes("hls") && isHlsCandidate(u)) {
    if (typeof Hls !== "undefined" && Hls.isSupported()) return { engine: "hlsjs", reason: "channelStreamType=hls + HLS URL" };
  }
  if (isHlsCandidate(u)) {
    if (typeof Hls !== "undefined" && Hls.isSupported()) return { engine: "hlsjs", reason: "HLS URL" };
    return { engine: "caf", reason: "HLS URL — CAF+Shaka" };
  }
  if (shouldAttemptHlsJs(u)) {
    if (typeof Hls !== "undefined" && Hls.isSupported()) return { engine: "hlsjs", reason: "ambiguous live URL — try Hls.js" };
    return { engine: "caf", reason: "ambiguous live URL — CAF+Shaka" };
  }

  return { engine: "caf", reason: "default CAF native" };
}

function inferMimeFromSenderHints(customData, url) {
  const pb = asObject(asObject(customData).playback);
  if (isTruthyFlag(pb.phonePlayingAsDash)) return "application/dash+xml";
  if (isTruthyFlag(pb.phonePlayingAsHls)) return "application/x-mpegURL";
  if (isTruthyFlag(pb.phonePlayingAsTs)) return "video/mp2t";
  const ch = String(pb.channelStreamType || "").toLowerCase();
  if (ch.includes("dash") || ch.includes("mpd")) return "application/dash+xml";
  if (ch.includes("hls")) return "application/x-mpegURL";
  return detectMimeTypeFromUrl(url);
}

/**
 * Live TS / octet-stream IPTV URLs must never use an unconstrained GET in the receiver:
 * the body is effectively infinite and will hang or fail the LOAD interceptor.
 */
function shouldSkipHttpBodyProbe(url, contentTypeHint) {
  const u = String(url || "").toLowerCase();
  const ct = String(contentTypeHint || "").toLowerCase();
  if (isIptvPortalRedirectUrl(url)) return false;
  if (isHlsCandidate(u) || isDashCandidate(u)) return false;
  if (ct.includes("mpegurl") || ct.includes("dash+xml")) return false;
  if (ct.includes("mp2t") || ct.includes("mpegts") || ct.includes("octet-stream")) return true;
  if (u.includes("video_type=") && u.includes("octet-stream")) return true;
  if (u.includes("extension=ts") || u.includes("ext=ts") || u.includes(".ts?") || u.includes(".ts&")) return true;
  return false;
}

/**
 * Light redirect / MIME probe: HEAD first, then GET with Range bytes=0-0 only.
 * Never opens an unconstrained GET on unknown live transports.
 */
async function resolveStream(url, headers, contentTypeHint) {
  const hdr = headers && typeof headers === "object" ? { ...headers } : {};
  if (shouldSkipHttpBodyProbe(url, contentTypeHint)) {
    log("resolveStream: skip HTTP body probe (TS / octet-stream style live)");
    log("Using URL as-is: " + url);
    return {
      finalUrl: url,
      mimeType: detectMimeTypeFromHeader(contentTypeHint) || detectMimeTypeFromUrl(url),
    };
  }

  log("Resolving URL (HEAD / ranged GET): " + url);
  log("Request header keys: " + (Object.keys(hdr).join(", ") || "(none)"));

  async function tryOnce(method, extraHeaders) {
    const merged = Object.assign({}, hdr, extraHeaders || {});
    const response = await fetch(url, {
      method,
      redirect: "follow",
      headers: merged,
    });
    if (method === "GET" && response.body) {
      try {
        const reader = response.body.getReader();
        const first = await reader.read();
        if (!first.done) {
          try {
            await reader.cancel();
          } catch (_c) {}
        }
      } catch (_e) {
        try {
          await response.body.cancel();
        } catch (_c2) {}
      }
    }
    return response;
  }

  try {
    let response = null;
    try {
      response = await tryOnce("HEAD", {});
    } catch (_headErr) {
      response = null;
    }
    if (!response || response.status === 405 || response.status === 501) {
      response = await tryOnce("GET", { Range: "bytes=0-0" });
    }
    const finalUrl = response.url || url;
    const contentType = response.headers.get("content-type");
    log("Resolved URL: " + finalUrl);
    log("Response Content-Type: " + (contentType || "(none)") + " status=" + response.status);

    return {
      finalUrl,
      mimeType: detectMimeTypeFromHeader(contentType) || detectMimeTypeFromHeader(contentTypeHint),
    };
  } catch (e) {
    logError("Resolution failed: " + formatAnyError(e) + " — using original URL");
    return {
      finalUrl: url,
      mimeType: detectMimeTypeFromHeader(contentTypeHint) || detectMimeTypeFromUrl(url),
    };
  }
}

/* ---------- Self-heal, candidate URLs, engine fallback, optimizations ---------- */

var PREET_STALL_MS = 18000;
var PREET_SOFT_RETRY_MAX = 2;
var PREET_SOFT_RETRY_DELAYS = [1000, 3000];
var PREET_RESOLVE_CACHE_TTL_MS = 120000;

var PREET_PLAYER_LIB_URLS = {
  hlsjs: "https://cdn.jsdelivr.net/npm/hls.js@1.5.7/dist/hls.min.js",
  dashjs: "https://cdn.jsdelivr.net/npm/dashjs@4.7.4/dist/dash.all.min.js",
  mpegts: "https://cdn.jsdelivr.net/npm/mpegts.js@1.7.3/dist/mpegts.min.js",
};

/** @type {Map<string, {finalUrl: string, mimeType: string|null, ts: number}>} */
var preetResolveCache = new Map();
/** @type {Record<string, Promise<void>>} */
var preetLibLoadPromises = {};
/** @type {ReturnType<typeof setTimeout>|null} */
var preetStallTimer = null;

/**
 * @typedef {Object} PreetCastSession
 * @property {object} loadRequestData
 * @property {object} customData
 * @property {string[]} candidateUrls
 * @property {number} candidateIndex
 * @property {Record<string, string>} headers
 * @property {string} mimeHint
 * @property {string} engine
 * @property {string} primaryEngine
 * @property {string[]} enginesTried
 * @property {number} softRetryCount
 * @property {boolean} playbackProgressSeen
 * @property {boolean} selfHealInFlight
 * @property {number} loadGeneration
 * @property {string} currentUrl
 * @property {string} resolvedMime
 */

/** @type {PreetCastSession|null} */
var preetCastSession = null;

/** @param {unknown} customData @param {string} primaryUrl */
function extractCandidateUrls(customData, primaryUrl) {
  const urls = [];
  const seen = new Set();
  function add(u) {
    const s = String(u || "").trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    urls.push(s);
  }
  add(primaryUrl);
  const cd = asObject(customData);
  const arr = cd.candidateUrls;
  if (Array.isArray(arr)) {
    arr.forEach(add);
  } else if (arr && typeof arr === "object" && arr.length != null) {
    for (let i = 0; i < arr.length; i++) add(arr[i]);
  }
  add(cd.streamUrl);
  add(cd.phoneResolvedUrl);
  const sr = asObject(cd.streamRequest);
  add(sr.url);
  return urls;
}

/** @param {unknown} customData @param {string} url @param {string} probeHint */
function shouldSkipResolveStream(customData, url, probeHint) {
  if (isIptvPortalRedirectUrl(url)) return false;
  const cd = asObject(customData);
  const sr = asObject(cd.streamRequest);
  const senderResolved = String(sr.url || cd.phoneResolvedUrl || "").trim();
  if (!senderResolved || senderResolved !== String(url).trim()) return false;
  if (shouldSkipHttpBodyProbe(url, probeHint)) return true;
  const ct = String(sr.contentType || probeHint || "").trim().toLowerCase();
  if (ct && ct !== "application/octet-stream" && ct !== "video/*") return true;
  return false;
}

/**
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {string} contentTypeHint
 * @param {unknown} customData
 */
async function resolveStreamCached(url, headers, contentTypeHint, customData) {
  if (shouldSkipResolveStream(customData, url, contentTypeHint)) {
    log("resolveStream: skip probe (sender-resolved URL + trusted MIME)");
    return {
      finalUrl: url,
      mimeType: detectMimeTypeFromHeader(contentTypeHint) || detectMimeTypeFromUrl(url),
    };
  }
  const cacheKey = url + "|" + Object.keys(headers).sort().join(",");
  const cached = preetResolveCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < PREET_RESOLVE_CACHE_TTL_MS) {
    log("resolveStream: cache hit for " + (url.length > 80 ? url.slice(0, 80) + "…" : url));
    return { finalUrl: cached.finalUrl, mimeType: cached.mimeType };
  }
  const result = await resolveStream(url, headers, contentTypeHint);
  preetResolveCache.set(cacheKey, {
    finalUrl: result.finalUrl,
    mimeType: result.mimeType,
    ts: Date.now(),
  });
  return result;
}

/** @param {string} url */
function preconnectToStreamUrl(url) {
  try {
    const u = new URL(url);
    if (!u.protocol.startsWith("http")) return;
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = u.origin;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  } catch (_e) {}
}

/** @param {string} key @param {string} src */
function loadExternalScriptOnce(key, src) {
  if (preetLibLoadPromises[key]) return preetLibLoadPromises[key];
  preetLibLoadPromises[key] = new Promise(function (resolve, reject) {
    const domId = "preet-lib-" + key;
    if (document.getElementById(domId)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.id = domId;
    s.async = true;
    s.src = src;
    s.onload = function () {
      var keyName = key;
      var tries = 0;
      function waitForGlobal() {
        var ready =
          keyName === "mpegts"
            ? typeof mpegts !== "undefined"
            : keyName === "hlsjs"
              ? typeof Hls !== "undefined"
              : keyName === "dashjs"
                ? typeof dashjs !== "undefined"
                : true;
        if (ready) {
          resolve();
          return;
        }
        tries++;
        if (tries > 30) {
          reject(new Error("Script loaded but global missing: " + keyName));
          return;
        }
        setTimeout(waitForGlobal, 50);
      }
      waitForGlobal();
    };
    s.onerror = function () {
      reject(new Error("Failed to load " + src));
    };
    document.head.appendChild(s);
  });
  return preetLibLoadPromises[key];
}

/** @param {string} engine */
function ensurePlayerLibrary(engine) {
  const e = String(engine || "").toLowerCase();
  if (e === "hlsjs" || e === "hls") {
    if (typeof Hls !== "undefined") return Promise.resolve();
    return loadExternalScriptOnce("hlsjs", PREET_PLAYER_LIB_URLS.hlsjs);
  }
  if (e === "dashjs" || e === "dash") {
    if (typeof dashjs !== "undefined") return Promise.resolve();
    return loadExternalScriptOnce("dashjs", PREET_PLAYER_LIB_URLS.dashjs);
  }
  if (e === "mpegts" || e === "caf-ts") {
    if (typeof mpegts !== "undefined") return Promise.resolve();
    return loadExternalScriptOnce("mpegts", PREET_PLAYER_LIB_URLS.mpegts);
  }
  return Promise.resolve();
}

/** @param {number} [maxAttempts] */
async function ensureMpegtsLibraryReady(maxAttempts) {
  const attempts = maxAttempts != null ? maxAttempts : 3;
  for (let i = 0; i < attempts; i++) {
    try {
      await ensurePlayerLibrary("mpegts");
    } catch (e) {
      logWarn("mpegts.js load attempt " + (i + 1) + "/" + attempts + ": " + formatAnyError(e));
      delete preetLibLoadPromises.mpegts;
    }
    if (typeof mpegts !== "undefined" && mpegts.isSupported()) return true;
    await new Promise(function (r) {
      setTimeout(r, 300 * (i + 1));
    });
  }
  return typeof mpegts !== "undefined" && mpegts.isSupported();
}

/**
 * @param {unknown} customData
 * @param {string} url
 * @param {string} mimeHint
 * @param {string} [forceEngine]
 */
function choosePlaybackEngineWithOverride(customData, url, mimeHint, forceEngine) {
  const fe = forceEngine ? String(forceEngine).trim().toLowerCase() : "";
  if (fe) {
    if ((fe === "dashjs" || fe === "dash") && typeof dashjs !== "undefined") {
      return { engine: "dashjs", reason: "self-heal override=" + fe };
    }
    if ((fe === "hlsjs" || fe === "hls") && typeof Hls !== "undefined" && Hls.isSupported()) {
      return { engine: "hlsjs", reason: "self-heal override=" + fe };
    }
    if ((fe === "mpegts" || fe === "caf-ts")) {
      return { engine: "mpegts", reason: "self-heal override=" + fe };
    }
    if (fe === "caf" && !isTsPlaybackRequired(customData, url, mimeHint)) {
      return { engine: "caf", reason: "self-heal override=caf" };
    }
    if (fe === "caf") {
      logWarn("Ignoring CAF override for TS stream — using mpegts.js");
      return { engine: "mpegts", reason: "TS stream — CAF override blocked" };
    }
    logWarn("Forced engine " + fe + " unavailable — using auto rules");
  }
  return choosePlaybackEngine(customData, url, mimeHint);
}

/**
 * @param {string} primaryEngine
 * @param {string} url
 * @param {string} mimeHint
 * @param {unknown} customData
 */
function buildEngineFallbackChain(primaryEngine, url, mimeHint, customData) {
  const pe = String(primaryEngine || "caf").toLowerCase();
  /** @type {string[]} */
  const chain = [];
  if (pe === "hlsjs") chain.push("caf");
  else if (pe === "mpegts") {
    if (shouldAttemptHlsJs(url) || isHlsCandidate(url)) chain.push("hlsjs");
  } else if (pe === "dashjs") chain.push("caf");
  else if (pe === "caf") {
    if (isTsPlaybackRequired(customData, url, mimeHint)) {
      chain.push("mpegts");
    } else {
      if (shouldAttemptHlsJs(url) || isHlsCandidate(url) || isLikelyLiveStream(url)) chain.push("hlsjs");
      if (isDashCandidate(url)) chain.push("dashjs");
      if (isTsCandidate(url)) chain.push("mpegts");
    }
  }
  return chain.filter(function (e) {
    return e !== pe;
  });
}

function getNextEngineFallback() {
  const session = preetCastSession;
  if (!session) return null;
  const chain = buildEngineFallbackChain(
    session.primaryEngine || session.engine,
    session.currentUrl,
    session.resolvedMime,
    session.customData
  );
  for (let i = 0; i < chain.length; i++) {
    if (session.enginesTried.indexOf(chain[i]) < 0) return chain[i];
  }
  return null;
}

function cancelStallWatchdog() {
  if (preetStallTimer != null) {
    clearTimeout(preetStallTimer);
    preetStallTimer = null;
  }
}

function startStallWatchdog() {
  cancelStallWatchdog();
  preetStallTimer = setTimeout(function () {
    preetStallTimer = null;
    const session = preetCastSession;
    if (!session || session.playbackProgressSeen || session.playbackFailedFinalized) return;
    logWarn("Stall watchdog: no playback progress in " + PREET_STALL_MS + "ms");
    preetAttemptSelfHeal("stall-watchdog", "Stream is taking too long to start.");
  }, PREET_STALL_MS);
}

function markPlaybackProgress() {
  if (preetCastSession) {
    preetCastSession.playbackProgressSeen = true;
    preetCastSession.softRetryCount = 0;
  }
  cancelStallWatchdog();
  clearCastingFailureUi();
}

/**
 * @param {object} loadRequestData
 * @param {object} customData
 * @param {string[]} candidateUrls
 * @param {number} startIndex
 */
function initPreetCastSession(loadRequestData, customData, candidateUrls, startIndex) {
  preetCastSession = {
    loadRequestData: loadRequestData,
    customData: customData,
    candidateUrls: candidateUrls,
    candidateIndex: startIndex,
    headers: extractPlaybackHeaders(customData),
    mimeHint: "",
    engine: "",
    primaryEngine: "",
    enginesTried: [],
    softRetryCount: 0,
    playbackProgressSeen: false,
    selfHealInFlight: false,
    playbackFailedFinalized: false,
    mpegtsRedirectRetried: false,
    loadGeneration: 0,
    currentUrl: "",
    resolvedMime: "",
    mpegtsInlineRecover: 0,
    hlsInlineRecover: 0,
    dashInlineRecover: 0,
  };
}

/** @param {function(): void} fn */
function scheduleCustomPlayerStart(fn) {
  requestAnimationFrame(function () {
    requestAnimationFrame(fn);
  });
}

/**
 * @param {string} finalUrl
 * @param {string} mimeType
 * @param {PreetCastSession} session
 */
function loadCafNativePlayback(finalUrl, mimeType, session) {
  if (sessionRequiresMpegts(session)) {
    logWarn("loadCafNativePlayback blocked: TS streams must use mpegts.js");
    return false;
  }
  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("mp2t") || mime.includes("mpegts")) {
    logWarn("loadCafNativePlayback blocked: contentType=" + mimeType);
    return false;
  }
  destroyAllCustomPlayers();
  try {
    const Msg = cast.framework.messages;
    const ld = session.loadRequestData;
    const loadReq = new Msg.LoadRequestData();
    loadReq.customData = ld.customData;
    loadReq.autoplay = true;
    loadReq.currentTime = 0;
    const media = new Msg.MediaInformation();
    const baseMedia = ld.media && typeof ld.media === "object" ? ld.media : {};
    media.contentId = finalUrl;
    media.contentUrl = finalUrl;
    media.contentType = mimeType;
    media.streamType = Msg.StreamType.LIVE;
    if (baseMedia.metadata) media.metadata = baseMedia.metadata;
    loadReq.media = media;
    playerManager.load(loadReq);
    log("CAF playerManager.load (self-heal): " + finalUrl + " | " + mimeType);
    return true;
  } catch (e) {
    logError("CAF playerManager.load failed: " + formatAnyError(e));
    return false;
  }
}

/** @param {unknown} customData @param {string} url @param {string} [engineOverride] @param {string} [mimeHint] */
async function preloadLikelyPlayerLibraries(customData, url, engineOverride, mimeHint) {
  const cd = asObject(customData);
  const bootstrap = asObject(cd.streamBootstrap);
  const prefer = String(bootstrap.preferReceiverEngine || "auto").trim().toLowerCase();
  const u = String(url || "");
  const tasks = [];
  if (
    prefer === "hlsjs" ||
    prefer === "hls" ||
    isHlsCandidate(u) ||
    shouldAttemptHlsJs(u) ||
    isLikelyLiveStream(u)
  ) {
    tasks.push(ensurePlayerLibrary("hlsjs"));
  }
  if (isTsPlaybackRequired(customData, u, mimeHint || "")) {
    tasks.push(ensurePlayerLibrary("mpegts"));
  }
  if (prefer === "dashjs" || prefer === "dash" || isDashCandidate(u)) {
    tasks.push(ensurePlayerLibrary("dashjs"));
  }
  if (engineOverride) {
    tasks.push(ensurePlayerLibrary(engineOverride));
  }
  try {
    await Promise.all(tasks);
  } catch (e) {
    logWarn("preloadLikelyPlayerLibraries: " + formatAnyError(e));
  }
}

/**
 * @param {object} [options]
 * @returns {Promise<{ok: boolean, mode?: string, engine?: string, resolved?: object, mimeType?: string, reason?: string}>}
 */
async function startPlaybackPipeline(options) {
  const opts = options || {};
  const session = preetCastSession;
  if (!session) return { ok: false, reason: "no-session" };

  session.loadGeneration++;
  const gen = session.loadGeneration;
  session.selfHealInFlight = false;
  session.mpegtsRedirectRetried = false;

  const idx = typeof opts.candidateIndex === "number" ? opts.candidateIndex : session.candidateIndex;
  if (idx < 0 || idx >= session.candidateUrls.length) return { ok: false, reason: "no-candidates" };

  session.candidateIndex = idx;
  const customData = session.customData;
  let url = session.candidateUrls[idx];
  url = preferResolvedEdgeUrlForPortal(url, customData);
  session.currentUrl = url;
  session.headers = buildHeadersForPlaybackUrl(url, customData);

  if (opts.resetEngines) {
    session.enginesTried = [];
    session.softRetryCount = 0;
    session.primaryEngine = "";
  }

  clearCastingFailureUi();
  destroyAllCustomPlayers();
  setReceiverLoaderVisible(true);
  session.playbackProgressSeen = false;
  cancelStallWatchdog();
  preconnectToStreamUrl(url);

  const loadRequestData = session.loadRequestData;
  const media = loadRequestData.media || {};

  let mimeType = session.mimeHint || media.contentType || "";
  const sr = asObject(customData.streamRequest);
  if (!mimeType && sr.contentType) mimeType = String(sr.contentType).trim();
  const probeHint = mimeType || "";

  const resolved = await resolveStreamCached(url, session.headers, probeHint, customData);
  if (gen !== session.loadGeneration) return { ok: false, reason: "superseded" };

  if (!mimeType) mimeType = resolved.mimeType || "";
  if (!mimeType) mimeType = detectMimeTypeFromUrl(resolved.finalUrl) || "";
  if (mimeType === "application/x-mpegURL" && detectMimeTypeFromUrl(resolved.finalUrl) === "video/mp2t") {
    mimeType = "video/mp2t";
  }
  session.resolvedMime = mimeType;

  await preloadLikelyPlayerLibraries(customData, resolved.finalUrl, opts.engineOverride || "", mimeType);

  if (isTsPlaybackRequired(customData, resolved.finalUrl, mimeType)) {
    const mpegtsReady = await ensureMpegtsLibraryReady(3);
    if (!mpegtsReady) {
      logError("mpegts.js required for TS stream but is not available on this receiver");
      return { ok: false, reason: "mpegts-unavailable" };
    }
  }
  if (gen !== session.loadGeneration) return { ok: false, reason: "superseded" };

  let decision = choosePlaybackEngineWithOverride(
    customData,
    resolved.finalUrl,
    mimeType,
    opts.engineOverride || ""
  );
  if (isTsPlaybackRequired(customData, resolved.finalUrl, mimeType)) {
    decision = { engine: "mpegts", reason: decision.engine === "mpegts" ? decision.reason : "TS stream — mpegts.js" };
  }
  if (decision.engine === "hlsjs" && (typeof Hls === "undefined" || !Hls.isSupported())) {
    decision = { engine: "caf", reason: "Hls.js unavailable after load" };
  }
  if (decision.engine === "dashjs" && typeof dashjs === "undefined") {
    decision = { engine: "caf", reason: "dash.js unavailable after load" };
  }

  const engine = decision.engine;
  if (!session.primaryEngine || opts.resetEngines) session.primaryEngine = engine;
  session.engine = engine;
  if (session.enginesTried.indexOf(engine) < 0) session.enginesTried.push(engine);

  log(
    "Pipeline candidate " +
      (idx + 1) +
      "/" +
      session.candidateUrls.length +
      " engine=" +
      engine +
      " (" +
      decision.reason +
      ")"
  );
  log("Pipeline URL: " + resolved.finalUrl);

  if (engine === "mpegts") {
    scheduleCustomPlayerStart(function () {
      tryStartPreetMpegts(resolved.finalUrl, session.headers);
    });
    startStallWatchdog();
    return { ok: true, mode: "custom", engine: "mpegts", resolved: resolved, mimeType: mimeType };
  }
  if (engine === "hlsjs") {
    scheduleCustomPlayerStart(function () {
      tryStartPreetHls(resolved.finalUrl, session.headers);
    });
    startStallWatchdog();
    return { ok: true, mode: "custom", engine: "hlsjs", resolved: resolved, mimeType: mimeType };
  }
  if (engine === "dashjs") {
    scheduleCustomPlayerStart(function () {
      tryStartPreetDash(resolved.finalUrl, session.headers);
    });
    startStallWatchdog();
    return { ok: true, mode: "custom", engine: "dashjs", resolved: resolved, mimeType: mimeType };
  }

  if (opts.fromLoadInterceptor) {
    startStallWatchdog();
    return { ok: true, mode: "caf-interceptor", engine: "caf", resolved: resolved, mimeType: mimeType };
  }

  const cafMime = mimeType || detectMimeTypeFromUrl(resolved.finalUrl) || "video/mp4";
  const ok = loadCafNativePlayback(resolved.finalUrl, cafMime, session);
  startStallWatchdog();
  return { ok: ok, mode: "caf-load", engine: "caf", resolved: resolved, mimeType: cafMime };
}

function softRetryCurrentEngine() {
  const session = preetCastSession;
  if (!session) return false;
  const engine = session.engine;
  const url = session.currentUrl;
  const headers = buildHeadersForPlaybackUrl(url, session.customData);
  session.headers = headers;

  clearCastingFailureUi();
  setReceiverLoaderVisible(true);
  session.playbackProgressSeen = false;
  cancelStallWatchdog();

  if (engine === "hlsjs") {
    destroyPreetHls();
    tryStartPreetHls(url, headers);
    startStallWatchdog();
    return true;
  }
  if (engine === "mpegts") {
    destroyPreetMpegts();
    tryStartPreetMpegts(url, headers);
    startStallWatchdog();
    return true;
  }
  if (engine === "dashjs") {
    destroyPreetDash();
    tryStartPreetDash(url, headers);
    startStallWatchdog();
    return true;
  }
  if (engine === "caf") {
    if (sessionRequiresMpegts(session)) {
      logWarn("Skipping CAF soft-retry — TS stream requires mpegts.js");
      return false;
    }
    const ok = loadCafNativePlayback(url, session.resolvedMime || "video/mp4", session);
    if (ok) startStallWatchdog();
    return ok;
  }
  return false;
}

/**
 * @param {string} source
 * @param {string} [detail]
 */
function preetAttemptSelfHeal(source, detail) {
  const session = preetCastSession;
  if (!session) {
    applyCastingFailedOverlayNow(detail);
    return;
  }
  if (session.playbackProgressSeen) {
    log("Self-heal skipped: playback already progressing (" + source + ")");
    return;
  }
  if (session.playbackFailedFinalized) {
    log("Self-heal skipped: playback already finalized (" + source + ")");
    return;
  }
  if (session.selfHealInFlight) return;

  session.selfHealInFlight = true;
  logWarn("Self-heal (" + source + "): " + (detail || "(no detail)"));

  function finishHeal() {
    if (preetCastSession === session) session.selfHealInFlight = false;
  }

  if (session.engine === "caf" && sessionRequiresMpegts(session)) {
    session.softRetryCount = PREET_SOFT_RETRY_MAX;
  }

  if (session.softRetryCount < PREET_SOFT_RETRY_MAX) {
    session.softRetryCount++;
    const delay = PREET_SOFT_RETRY_DELAYS[Math.min(session.softRetryCount - 1, PREET_SOFT_RETRY_DELAYS.length - 1)];
    log("Self-heal soft retry " + session.softRetryCount + "/" + PREET_SOFT_RETRY_MAX + " engine=" + session.engine);
    setTimeout(function () {
      if (!preetCastSession || preetCastSession !== session) return;
      if (session.playbackProgressSeen) {
        finishHeal();
        return;
      }
      if (softRetryCurrentEngine()) {
        finishHeal();
        return;
      }
      finishHeal();
      preetAttemptSelfHeal(source + "/soft-failed", detail);
    }, delay);
    return;
  }

  const nextEngine = getNextEngineFallback();
  if (nextEngine) {
    log("Self-heal engine fallback → " + nextEngine);
    session.softRetryCount = 0;
    startPlaybackPipeline({ engineOverride: nextEngine, resetEngines: false }).then(function (result) {
      finishHeal();
      if (!result.ok && preetCastSession === session && !session.playbackProgressSeen) {
        preetAttemptSelfHeal(source + "/engine-failed", detail);
      }
    });
    return;
  }

  const nextIdx = session.candidateIndex + 1;
  if (nextIdx < session.candidateUrls.length) {
    log("Self-heal next candidate " + (nextIdx + 1) + "/" + session.candidateUrls.length);
    session.softRetryCount = 0;
    startPlaybackPipeline({ candidateIndex: nextIdx, resetEngines: true }).then(function (result) {
      finishHeal();
      if (!result.ok && preetCastSession === session && !session.playbackProgressSeen) {
        preetAttemptSelfHeal(source + "/candidate-failed", detail);
      }
    });
    return;
  }

  finishHeal();
  preetFinalizePlaybackFailure(detail);
}

/** @param {string} [detail] */
function preetFinalizePlaybackFailure(detail) {
  if (preetCastSession) preetCastSession.playbackFailedFinalized = true;
  cancelStallWatchdog();
  applyCastingFailedOverlayNow(detail);
  broadcastPlaybackFailedToSender(detail, true);
}

/**
 * @param {string} [detail]
 * @param {boolean} exhausted
 */
function broadcastPlaybackFailedToSender(detail, exhausted) {
  try {
    const session = preetCastSession;
    const payload = {
      type: "playbackFailed",
      exhausted: exhausted === true,
      candidateIndex: session ? session.candidateIndex : -1,
      candidateCount: session ? session.candidateUrls.length : 0,
      detail: detail ? String(detail).slice(0, CAST_FAILED_DETAIL_MAX) : "",
      engine: session ? session.engine : "",
    };
    context.sendCustomMessage(PREET_MSG_NS, payload);
    log("Sent playbackFailed to sender (exhausted=" + (exhausted === true) + ")");
  } catch (e) {
    logWarn("broadcastPlaybackFailed: " + formatAnyError(e));
  }
}

const STUB_MEDIA_URL = "about:blank";

/** @type {unknown} */
let preetMpegtsInstance = null;

/** @type {unknown} */
let preetHlsInstance = null;

/** @type {unknown} */
let preetDashInstance = null;

let preetControlBridgeInstalled = false;

function isPlayInterruptedError(err) {
  const msg = formatAnyError(err);
  return (
    msg.indexOf("interrupted by a call to pause") >= 0 ||
    msg.indexOf("interrupted by a new load") >= 0 ||
    msg.indexOf("The play() request was interrupted") >= 0
  );
}

function preetBroadcastMediaStatus(includeMedia) {
  try {
    if (playerManager && typeof playerManager.broadcastStatus === "function") {
      playerManager.broadcastStatus(includeMedia !== false);
    }
  } catch (_e) {}
}

/**
 * Volume + play/pause from phone / Assistant → #castVideo + mpegts, and status back to senders.
 * Call once after CastReceiverContext.start().
 */
function installPreetRemoteControlBridge() {
  if (preetControlBridgeInstalled || !playerManager) return;
  preetControlBridgeInstalled = true;

  const Msg = cast.framework.messages.MessageType;
  const Ev = cast.framework.events.EventType;

  function applyReceiverVolume(level, muted) {
    const el = document.getElementById("castVideo");
    if (!el) return;
    const vol = Math.max(0, Math.min(1, Number(level) || 0));
    el.volume = muted ? 0 : vol;
    el.muted = !!muted;
  }

  try {
    applyReceiverVolume(playerManager.getVolumeLevel(), playerManager.isMute());
  } catch (_e) {}

  try {
    if (Ev && Ev.STREAM_VOLUME_CHANGED != null) {
      playerManager.addEventListener(Ev.STREAM_VOLUME_CHANGED, function (event) {
        const level =
          event && typeof event.volume === "number" ? event.volume : playerManager.getVolumeLevel();
        const muted =
          event && typeof event.isMute === "boolean" ? event.isMute : playerManager.isMute();
        applyReceiverVolume(level, muted);
        preetBroadcastMediaStatus(true);
      });
    }
  } catch (_e) {}

  try {
    playerManager.setMessageInterceptor(Msg.SET_VOLUME, function (data) {
      if (data) applyReceiverVolume(data.volume, data.isMute);
      return data;
    });
  } catch (_e) {}

  function interceptPlaybackCommand(msgType, shouldPlay) {
    if (msgType == null) return;
    try {
      playerManager.setMessageInterceptor(msgType, function (data) {
        if (preetMpegtsInstance) {
          try {
            if (shouldPlay) {
              if (typeof preetMpegtsInstance.play === "function") {
                const pr = preetMpegtsInstance.play();
                if (pr && typeof pr.catch === "function") {
                  pr.catch(function (err) {
                    if (isPlayInterruptedError(err)) return;
                    logError("remote PLAY → mpegts.play: " + formatAnyError(err));
                  });
                }
              }
            } else if (typeof preetMpegtsInstance.pause === "function") {
              preetMpegtsInstance.pause();
            }
          } catch (e) {
            logError("remote " + (shouldPlay ? "PLAY" : "PAUSE") + ": " + formatAnyError(e));
          }
        } else if (preetHlsInstance) {
          const vel = document.getElementById("castVideo");
          if (vel) {
            try {
              if (shouldPlay) {
                const pr = vel.play();
                if (pr && typeof pr.catch === "function") {
                  pr.catch(function (err) {
                    if (isPlayInterruptedError(err)) return;
                    logError("remote PLAY → video: " + formatAnyError(err));
                  });
                }
              } else {
                vel.pause();
              }
            } catch (e) {
              logError("remote " + (shouldPlay ? "PLAY" : "PAUSE") + " (hls): " + formatAnyError(e));
            }
          }
        } else if (preetDashInstance) {
          try {
            if (shouldPlay) {
              if (typeof preetDashInstance.play === "function") preetDashInstance.play();
            } else if (typeof preetDashInstance.pause === "function") {
              preetDashInstance.pause();
            }
          } catch (e) {
            logError("remote " + (shouldPlay ? "PLAY" : "PAUSE") + " (dash): " + formatAnyError(e));
          }
        }
        try {
          preetBroadcastMediaStatus(true);
        } catch (_b) {}
        return data;
      });
    } catch (_e) {}
  }

  interceptPlaybackCommand(Msg.PLAY, true);
  interceptPlaybackCommand(Msg.PAUSE, false);

  const v = document.getElementById("castVideo");
  if (v && !v.dataset.preetCtlWire) {
    v.dataset.preetCtlWire = "1";
    ["playing", "pause", "volumechange", "seeked", "ratechange"].forEach(function (name) {
      v.addEventListener(name, function () {
        preetBroadcastMediaStatus(true);
      });
    });
  }

  log("Remote control bridge: volume + PLAY/PAUSE + status sync (CAF / mpegts / Hls.js / dash.js)");
}

function destroyPreetHls() {
  if (!preetHlsInstance) return;
  try {
    preetHlsInstance.destroy();
  } catch (_e) {}
  preetHlsInstance = null;
}

function destroyPreetDash() {
  if (!preetDashInstance) return;
  try {
    if (typeof preetDashInstance.reset === "function") {
      preetDashInstance.reset();
    }
  } catch (_e) {}
  preetDashInstance = null;
}

function destroyAllCustomPlayers() {
  destroyPreetHls();
  destroyPreetDash();
  destroyPreetMpegts();
}

function destroyPreetMpegts() {
  if (!preetMpegtsInstance) return;
  try {
    if (typeof mpegts !== "undefined" && mpegts.Events) {
      preetMpegtsInstance.off(mpegts.Events.ERROR);
    }
  } catch (_e) {}
  try {
    if (typeof mpegts !== "undefined" && mpegts.Events && mpegts.Events.LOADING_COMPLETE) {
      preetMpegtsInstance.off(mpegts.Events.LOADING_COMPLETE);
    }
  } catch (_e0) {}
  try {
    if (typeof mpegts !== "undefined" && mpegts.Events && mpegts.Events.METADATA_ARRIVED) {
      preetMpegtsInstance.off(mpegts.Events.METADATA_ARRIVED);
    }
  } catch (_e0b) {}
  try {
    preetMpegtsInstance.pause();
  } catch (_e2) {}
  try {
    preetMpegtsInstance.unload();
  } catch (_e3) {}
  try {
    preetMpegtsInstance.detachMediaElement();
  } catch (_e4) {}
  try {
    preetMpegtsInstance.destroy();
  } catch (_e5) {}
  preetMpegtsInstance = null;
}

/**
 * @param {string} playbackUrl
 * @param {Record<string, string>} headers
 */
function tryStartPreetMpegts(playbackUrl, headers) {
  const videoEl = document.getElementById("castVideo");
  if (!videoEl) {
    logError("mpegts: missing #castVideo element in page");
    setReceiverLoaderVisible(false);
    showCastingFailedMessageImmediate("Receiver page is missing the video element.");
    return;
  }
  if (typeof mpegts === "undefined" || !mpegts.isSupported()) {
    logError("mpegts.js not loaded or MSE unsupported on this device");
    setReceiverLoaderVisible(false);
    showCastingFailedMessageImmediate("MPEG-TS playback is not supported on this Chromecast.");
    return;
  }
  destroyAllCustomPlayers();
  if (preetCastSession) preetCastSession.mpegtsInlineRecover = 0;
  const hdr = buildHeadersForPlaybackUrl(playbackUrl, preetCastSession ? preetCastSession.customData : {});
  log(
    "mpegts.js: bind to #castVideo, url=" +
      playbackUrl +
      " | header keys: " +
      (Object.keys(hdr).join(", ") || "(none)")
  );
  try {
    preetMpegtsInstance = mpegts.createPlayer(
      {
        type: "mpegts",
        isLive: true,
        url: playbackUrl,
        headers: hdr,
        hasAudio: true,
        hasVideo: true,
      },
      {
        enableWorker: false,
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
      }
    );
    preetMpegtsInstance.on(mpegts.Events.ERROR, function (etype, detail) {
      logError("mpegts.Events.ERROR type=" + stringifyForLog(etype) + " detail=" + stringifyForLog(detail));
      const detailStr = stringifyForLog(detail);
      const isHttpStatus =
        detailStr.indexOf("HttpStatusCodeInvalid") >= 0 || detailStr.indexOf("StatusCode") >= 0;

      if (
        isHttpStatus &&
        preetCastSession &&
        !preetCastSession.mpegtsRedirectRetried &&
        isIptvPortalRedirectUrl(playbackUrl)
      ) {
        preetCastSession.mpegtsRedirectRetried = true;
        logWarn("mpegts.js: HTTP status error on portal — resolving redirect with headers");
        resolveStream(playbackUrl, hdr, "video/mp2t")
          .then(function (resolved) {
            if (resolved.finalUrl && resolved.finalUrl !== playbackUrl) {
              log("mpegts.js: portal resolved → " + resolved.finalUrl);
              tryStartPreetMpegts(resolved.finalUrl, hdr);
              return;
            }
            setReceiverLoaderVisible(false);
            scheduleCastingFailedMessage(
              "MPEG-TS: " + stringifyForLog(etype) + " — " + stringifyForLog(detail)
            );
          })
          .catch(function (e) {
            logError("mpegts portal resolve failed: " + formatAnyError(e));
            setReceiverLoaderVisible(false);
            scheduleCastingFailedMessage(
              "MPEG-TS: " + stringifyForLog(etype) + " — " + stringifyForLog(detail)
            );
          });
        return;
      }

      if (!isHttpStatus && preetMpegtsInstance && preetCastSession && preetCastSession.mpegtsInlineRecover < 2) {
        preetCastSession.mpegtsInlineRecover++;
        logWarn("mpegts.js: inline reload attempt " + preetCastSession.mpegtsInlineRecover);
        try {
          preetMpegtsInstance.unload();
          preetMpegtsInstance.load();
          const pr = preetMpegtsInstance.play && preetMpegtsInstance.play();
          if (pr && typeof pr.catch === "function") {
            pr.catch(function (err) {
              if (isPlayInterruptedError(err)) return;
            });
          }
          return;
        } catch (e) {
          logWarn("mpegts inline reload failed: " + formatAnyError(e));
        }
      }
      setReceiverLoaderVisible(false);
      scheduleCastingFailedMessage("MPEG-TS: " + stringifyForLog(etype) + " — " + stringifyForLog(detail));
    });
    if (mpegts.Events && mpegts.Events.LOADING_COMPLETE) {
      preetMpegtsInstance.on(mpegts.Events.LOADING_COMPLETE, function () {
        log("mpegts: LOADING_COMPLETE");
        markPlaybackProgress();
        preetBroadcastMediaStatus(true);
        try {
          requestAnimationFrame(function () {
            try {
              if (typeof playerManager.play === "function") playerManager.play();
            } catch (_e) {}
          });
        } catch (_e2) {}
      });
    }
    if (mpegts.Events && mpegts.Events.METADATA_ARRIVED) {
      preetMpegtsInstance.on(mpegts.Events.METADATA_ARRIVED, function () {
        log("mpegts: METADATA_ARRIVED (first decodable timing)");
      });
    }
    preetMpegtsInstance.attachMediaElement(videoEl);
    preetMpegtsInstance.load();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        const inst = preetMpegtsInstance;
        if (!inst || typeof inst.play !== "function") return;
        const pr = inst.play();
        if (pr && typeof pr.catch === "function") {
          pr.catch(function (err) {
            if (isPlayInterruptedError(err)) return;
            logError("mpegts.play() rejected: " + formatAnyError(err));
            scheduleCastingFailedMessage(formatAnyError(err));
          });
        }
      });
    });
  } catch (e) {
    logError("mpegts.createPlayer failed: " + formatAnyError(e));
    setReceiverLoaderVisible(false);
    showCastingFailedMessageImmediate(formatAnyError(e));
  }
}

/**
 * @param {string} playbackUrl
 * @param {Record<string, string>} headers
 */
function tryStartPreetHls(playbackUrl, headers) {
  const videoEl = document.getElementById("castVideo");
  if (!videoEl) {
    logError("Hls.js: missing #castVideo");
    setReceiverLoaderVisible(false);
    showCastingFailedMessageImmediate("Receiver page is missing the video element.");
    return;
  }
  if (typeof Hls === "undefined" || !Hls.isSupported()) {
    logError("Hls.js not loaded or not supported");
    setReceiverLoaderVisible(false);
    showCastingFailedMessageImmediate("HLS.js playback is not supported on this Chromecast.");
    return;
  }
  destroyAllCustomPlayers();
  const hdr = headers && typeof headers === "object" ? headers : {};
  if (preetCastSession) preetCastSession.hlsInlineRecover = 0;
  log("Hls.js: attachMedia #castVideo, url=" + playbackUrl);
  try {
    preetHlsInstance = new Hls({
      enableWorker: false,
      lowLatencyMode: false,
      fragLoadingMaxRetry: 4,
      manifestLoadingMaxRetry: 3,
      levelLoadingMaxRetry: 3,
      xhrSetup: function (xhr) {
        Object.keys(hdr).forEach(function (k) {
          try {
            xhr.setRequestHeader(k, hdr[k]);
          } catch (_e) {}
        });
      },
    });
    preetHlsInstance.on(Hls.Events.ERROR, function (_ev, data) {
      if (data && data.fatal) {
        logError("Hls fatal: " + stringifyForLog(data.type) + " " + stringifyForLog(data.details));
        if (preetHlsInstance && preetCastSession && preetCastSession.hlsInlineRecover < 2) {
          preetCastSession.hlsInlineRecover++;
          try {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              logWarn("Hls.js: startLoad() recover attempt " + preetCastSession.hlsInlineRecover);
              preetHlsInstance.startLoad();
              return;
            }
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              logWarn("Hls.js: recoverMediaError() attempt " + preetCastSession.hlsInlineRecover);
              preetHlsInstance.recoverMediaError();
              return;
            }
          } catch (e) {
            logWarn("Hls.js inline recover failed: " + formatAnyError(e));
          }
        }
        setReceiverLoaderVisible(false);
        scheduleCastingFailedMessage("HLS: " + stringifyForLog(data.type) + " — " + stringifyForLog(data.details));
      }
    });
    preetHlsInstance.on(Hls.Events.MANIFEST_PARSED, function () {
      log("Hls.js: MANIFEST_PARSED");
      markPlaybackProgress();
      preetBroadcastMediaStatus(true);
    });
    preetHlsInstance.attachMedia(videoEl);
    preetHlsInstance.loadSource(playbackUrl);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        const v = document.getElementById("castVideo");
        if (!v || typeof v.play !== "function") return;
        const pr = v.play();
        if (pr && typeof pr.catch === "function") {
          pr.catch(function (err) {
            if (isPlayInterruptedError(err)) return;
            logError("Hls video.play: " + formatAnyError(err));
            scheduleCastingFailedMessage(formatAnyError(err));
          });
        }
      });
    });
  } catch (e) {
    logError("Hls.js setup failed: " + formatAnyError(e));
    setReceiverLoaderVisible(false);
    showCastingFailedMessageImmediate(formatAnyError(e));
  }
}

/**
 * @param {string} playbackUrl
 * @param {Record<string, string>} headers
 */
function tryStartPreetDash(playbackUrl, headers) {
  const videoEl = document.getElementById("castVideo");
  if (!videoEl) {
    logError("dash.js: missing #castVideo");
    setReceiverLoaderVisible(false);
    showCastingFailedMessageImmediate("Receiver page is missing the video element.");
    return;
  }
  if (typeof dashjs === "undefined") {
    logError("dash.js not loaded");
    setReceiverLoaderVisible(false);
    showCastingFailedMessageImmediate("DASH playback library failed to load.");
    return;
  }
  destroyAllCustomPlayers();
  const hdr = headers && typeof headers === "object" ? headers : {};
  if (preetCastSession) preetCastSession.dashInlineRecover = 0;
  log("dash.js: attachView #castVideo, url=" + playbackUrl);
  try {
    preetDashInstance = dashjs.MediaPlayer().create();
    try {
      if (typeof preetDashInstance.extend === "function") {
        preetDashInstance.extend(
          "RequestModifier",
          function () {
            return {
              modifyRequestHeader: function (xhr) {
                Object.keys(hdr).forEach(function (k) {
                  try {
                    xhr.setRequestHeader(k, hdr[k]);
                  } catch (_e) {}
                });
              },
            };
          },
          true
        );
      }
    } catch (_e) {}
    preetDashInstance.on(dashjs.MediaPlayer.events.ERROR, function (err) {
      logError("dashjs ERROR: " + formatAnyError(err));
      if (preetDashInstance && preetCastSession && preetCastSession.dashInlineRecover < 2) {
        preetCastSession.dashInlineRecover++;
        logWarn("dash.js: inline reset attempt " + preetCastSession.dashInlineRecover);
        try {
          preetDashInstance.reset();
          preetDashInstance.attachView(videoEl);
          preetDashInstance.attachSource(playbackUrl);
          return;
        } catch (e) {
          logWarn("dash.js inline reset failed: " + formatAnyError(e));
        }
      }
      setReceiverLoaderVisible(false);
      scheduleCastingFailedMessage("DASH: " + formatAnyError(err));
    });
    preetDashInstance.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, function () {
      log("dashjs: STREAM_INITIALIZED");
      markPlaybackProgress();
      preetBroadcastMediaStatus(true);
      try {
        if (typeof preetDashInstance.play === "function") preetDashInstance.play();
      } catch (_e) {}
    });
    preetDashInstance.attachView(videoEl);
    preetDashInstance.attachSource(playbackUrl);
  } catch (e) {
    logError("dash.js setup failed: " + formatAnyError(e));
    setReceiverLoaderVisible(false);
    showCastingFailedMessageImmediate(formatAnyError(e));
  }
}

/**
 * Inject headers into all CAF manifest/segment/license requests
 */
playerManager.setMediaPlaybackInfoHandler((loadRequestData, playbackConfig) => {
  try {
    const headers = extractPlaybackHeaders(loadRequestData.customData);
    log("CAF playback header keys: " + Object.keys(headers).join(", ") || "(none)");

    const apply = (request) => {
      if (!request || !request.headers) return;
      Object.entries(headers).forEach(([key, value]) => {
        request.headers[key] = value;
      });
    };

    playbackConfig.manifestRequestHandler = (request) => {
      apply(request);
    };
    playbackConfig.segmentRequestHandler = (request) => {
      apply(request);
    };
    playbackConfig.licenseRequestHandler = (request) => {
      apply(request);
    };

    try {
      if (!playbackConfig.shakaConfig) playbackConfig.shakaConfig = {};
      const sc = playbackConfig.shakaConfig;
      if (!sc.streaming) sc.streaming = {};
      if (!sc.streaming.retryParameters) {
        sc.streaming.retryParameters = {
          maxAttempts: 4,
          baseDelay: 1000,
          backoffFactor: 2,
          fuzzFactor: 0.5,
          timeout: 30000,
        };
      }
      if (sc.streaming.rebufferingGoal == null) sc.streaming.rebufferingGoal = 2;
      if (sc.streaming.bufferingGoal == null) sc.streaming.bufferingGoal = 10;
    } catch (_shakaCfg) {}

    return playbackConfig;
  } catch (e) {
    logError("setMediaPlaybackInfoHandler failed: " + formatAnyError(e));
    throw e;
  }
});

/**
 * Intercept LOAD — align with Android customData.streamRequest
 */
playerManager.setMessageInterceptor(cast.framework.messages.MessageType.LOAD, async (loadRequestData) => {
  try {
    clearCastingFailureUi();
    cancelStallWatchdog();
    destroyAllCustomPlayers();
    setReceiverLoaderVisible(true);
    setReceiverChannelSubtitle(extractChannelLabelFromLoadRequest(loadRequestData));

    const media = loadRequestData.media;
    const originalUrl = (media && (media.contentUrl || media.contentId)) || "";

    if (!media || !originalUrl) {
      setReceiverLoaderVisible(false);
      logError("LOAD failed: missing media URL (contentUrl and contentId empty)");
      showCastingFailedMessageImmediate("No stream URL was sent to the TV.");
      throw new cast.framework.messages.ErrorData(cast.framework.messages.ErrorType.LOAD_FAILED);
    }

    const customData = loadRequestData.customData || {};
    syncReceiverLogPanelFromSources(customData, "LOAD");
    const sr = customData.streamRequest && typeof customData.streamRequest === "object" ? customData.streamRequest : null;
    const senderResolved = sr && sr.url ? String(sr.url).trim() : "";
    const urlToResolve = senderResolved || originalUrl;

    let mimeType = media.contentType;
    if (!mimeType && sr && sr.contentType) {
      mimeType = String(sr.contentType).trim();
    }

    const candidateUrls = extractCandidateUrls(customData, urlToResolve);
    let startIndex = 0;
    const cdIdx = parseInt(String(customData.candidateIndex != null ? customData.candidateIndex : "0"), 10);
    if (Number.isFinite(cdIdx) && cdIdx >= 0 && cdIdx < candidateUrls.length) startIndex = cdIdx;

    log("--------------------------------");
    log("LOAD contentUrl/contentId: " + originalUrl);
    if (senderResolved && senderResolved !== originalUrl) {
      log("streamRequest.url (sender): " + senderResolved);
    }
    log("Candidates: " + candidateUrls.length + " (start index " + startIndex + ")");
    log("customData.sender: " + (customData.sender || "(none)"));
    log("--------------------------------");

    initPreetCastSession(loadRequestData, customData, candidateUrls, startIndex);
    if (preetCastSession) preetCastSession.mimeHint = mimeType || "";

    function buildStubOut(contentTypeStub, resolvedUrl) {
      const out = Object.assign({}, loadRequestData);
      out.media = Object.assign({}, media);
      out.media.contentId = resolvedUrl;
      out.media.contentUrl = STUB_MEDIA_URL;
      out.media.contentType = contentTypeStub || "video/mp4";
      out.media.streamType = cast.framework.messages.StreamType.LIVE;
      return out;
    }

    const result = await startPlaybackPipeline({ fromLoadInterceptor: true, resetEngines: true });
    if (!result.ok) {
      logError("LOAD pipeline failed: " + (result.reason || "unknown") + " — self-heal scheduled");
      preetAttemptSelfHeal("load-pipeline", "Could not start playback on the receiver.");
      return buildStubOut("video/mp4", urlToResolve);
    }

    const resolved = result.resolved || { finalUrl: urlToResolve };
    const finalUrl = resolved.finalUrl || urlToResolve;

    if (result.mode === "caf-interceptor" || result.engine === "caf") {
      let cafMime = result.mimeType || mimeType;
      if (!cafMime || cafMime === "application/octet-stream" || cafMime === "video/*") {
        cafMime = detectMimeTypeFromUrl(finalUrl) || inferMimeFromSenderHints(customData, finalUrl);
      }
      if (!cafMime) cafMime = "video/mp4";

      media.contentId = finalUrl;
      media.contentUrl = finalUrl;
      media.contentType = cafMime;
      log("LOAD CAF-native: " + finalUrl + " | contentType=" + cafMime);
      return loadRequestData;
    }

    const stubMime = result.engine === "dashjs" ? "application/dash+xml" : "video/mp4";
    log("LOAD custom stub (" + result.engine + "): " + finalUrl);
    return buildStubOut(stubMime, finalUrl);
  } catch (e) {
    if (e && e.type === cast.framework.messages.ErrorType.LOAD_FAILED) throw e;
    setReceiverLoaderVisible(false);
    logError("LOAD interceptor failed: " + formatAnyError(e));
    if (preetCastSession) {
      preetAttemptSelfHeal("load-interceptor", formatAnyError(e));
    } else {
      showCastingFailedMessageImmediate(formatAnyError(e));
    }
    throw e;
  }
});

playerManager.addEventListener(cast.framework.events.EventType.ERROR, (event) => {
  setReceiverLoaderVisible(false);
  logError("PLAYER ERROR: " + formatPlayerErrorEvent(event));
  try {
    const e = /** @type {Record<string, unknown>} */ (event || {});
    const code = e.detailedErrorCode != null ? Number(e.detailedErrorCode) : NaN;
    const session = preetCastSession;
    if (session && sessionRequiresMpegts(session) && (code === 104 || code === 905)) {
      if (session.engine !== "mpegts" && session.enginesTried.indexOf("mpegts") < 0) {
        logWarn("CAF error " + code + " on TS stream — switching to mpegts.js");
        cancelPendingCastingFailedMessage();
        startPlaybackPipeline({ engineOverride: "mpegts", resetEngines: false });
        return;
      }
    }
  } catch (_errHandler) {}
  scheduleCastingFailedMessage(formatPlayerErrorEvent(event));
});

playerManager.addEventListener(cast.framework.events.EventType.MEDIA_STATUS, () => {
  try {
    const mi = typeof playerManager.getMediaInformation === "function" ? playerManager.getMediaInformation() : null;
    const ps = typeof playerManager.getPlayerState === "function" ? playerManager.getPlayerState() : "";
    const idle =
      typeof playerManager.getIdleReason === "function" ? playerManager.getIdleReason() : null;
    const cid = mi && mi.contentId ? String(mi.contentId) : "";
    const short = cid.length > 100 ? cid.slice(0, 100) + "…" : cid;
    let line = "MEDIA_STATUS playerState=" + ps;
    if (idle != null) line += " idleReason=" + idle;
    if (short) line += " contentId=" + short;
    log(line);
    if (idle === 4) {
      logWarn("MEDIA_STATUS: idleReason=4 (ERROR) — playback failed");
      scheduleCastingFailedMessage("Playback stopped with an error on the receiver.");
    }
    try {
      const psNum = typeof ps === "number" ? ps : parseInt(String(ps), 10);
      if (psNum === 2) markPlaybackProgress();
    } catch (_ps) {}
  } catch (_e) {
    log("MEDIA_STATUS (update)");
  }
});

(function attachOptionalPlayerErrorChannels() {
  const E = cast.framework.events.EventType;
  const optional = [
    ["PLAYER_PRELOAD_ERROR", E.PLAYER_PRELOAD_ERROR],
    ["PLAYER_LOAD_ERROR", E.PLAYER_LOAD_ERROR],
  ];
  optional.forEach(([label, type]) => {
    if (!type) return;
    try {
      playerManager.addEventListener(type, (ev) => {
        logError(String(label) + ": " + formatPlayerErrorEvent(ev));
        scheduleCastingFailedMessage(String(label) + ": " + formatPlayerErrorEvent(ev));
      });
    } catch (_e) {
      /* older CAF builds may omit some event types */
    }
  });
})();

try {
  const videoEl = document.getElementById("castVideo");
  if (videoEl && typeof playerManager.setMediaElement === "function") {
    playerManager.setMediaElement(videoEl);
    log("PlayerManager.setMediaElement(#castVideo) OK");
  } else {
    logWarn("setMediaElement skipped (no #castVideo or API missing)");
  }
} catch (e) {
  logError("setMediaElement failed: " + formatAnyError(e));
  showCastingFailedMessageImmediate("Could not attach the video element: " + formatAnyError(e));
}

(function wirePreetCustomReceiverMessages() {
  let overlayPausedPlayback = false;
  let overlayWasPlayingBeforePause = false;

  function getCastVideoElement() {
    const el = document.getElementById("castVideo");
    return el instanceof HTMLVideoElement ? el : null;
  }

  function pausePlaybackForOverlay() {
    const video = getCastVideoElement();
    if (!video) return;
    overlayWasPlayingBeforePause = !video.paused && !video.ended;
    if (overlayWasPlayingBeforePause) {
      try {
        video.pause();
        overlayPausedPlayback = true;
        log("Overlay requested: paused receiver playback");
      } catch (e) {
        logWarn("Overlay pause failed: " + formatAnyError(e));
      }
    }
  }

  function resumePlaybackAfterOverlay() {
    const video = getCastVideoElement();
    if (!video) {
      overlayPausedPlayback = false;
      overlayWasPlayingBeforePause = false;
      return;
    }
    if (overlayPausedPlayback && overlayWasPlayingBeforePause && video.paused && !video.ended) {
      try {
        const p = video.play();
        if (p && typeof p.catch === "function") {
          p.catch((e) => logWarn("Overlay resume play() rejected: " + formatAnyError(e)));
        }
        log("Overlay dismissed: resumed receiver playback");
      } catch (e) {
        logWarn("Overlay resume failed: " + formatAnyError(e));
      }
    }
    overlayPausedPlayback = false;
    overlayWasPlayingBeforePause = false;
  }

  try {
    context.addCustomMessageListener(PREET_MSG_NS, (event) => {
      let data = event && event.data != null ? event.data : null;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch (_e) {
          return;
        }
      }
      if (!data || typeof data !== "object") return;
      const o = /** @type {Record<string, unknown>} */ (data);
      if (String(o.type || "") !== "continueOnPhoneOverlay") return;
      const vis = o.visible === true;
      const msg =
        typeof o.message === "string" && o.message.trim()
          ? String(o.message).trim()
          : "Please continue on your phone";
      const overlay = document.getElementById("castContinuePhoneOverlay");
      const textEl = document.getElementById("castContinuePhoneText");
      if (textEl) textEl.textContent = msg;
      if (overlay) {
        overlay.style.display = vis ? "flex" : "none";
        overlay.setAttribute("aria-hidden", vis ? "false" : "true");
      }
      if (vis) {
        pausePlaybackForOverlay();
      } else {
        resumePlaybackAfterOverlay();
      }
    });
    log("Custom message listener OK (" + PREET_MSG_NS + ")");
  } catch (e) {
    logWarn("addCustomMessageListener failed: " + formatAnyError(e));
  }
})();

context.start({
  disableIdleTimeout: true,
  useShakaForHls: true,
});

installPreetRemoteControlBridge();

log("=================================");
log("PreetTV Cast Receiver Ready (CAF started)");
log("=================================");
