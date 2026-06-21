/* global cast, Hls, dashjs, mpegts */
// receiver.js — PreetTV Cast custom receiver (CAF v3)
// Compatible with Android sender: customData.streamRequest { url, contentType, headers },
// customData.auth.headers, and optional customData.headers.

const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();

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
    applyCastingFailedOverlayNow(d);
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
    clearCastingFailureUi();
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
    if (typeof mpegts !== "undefined" && mpegts.isSupported()) return { engine: "mpegts", reason: "streamBootstrap.preferReceiverEngine=" + prefer + " → mpegts.js" };
    return { engine: "caf", reason: "preferReceiverEngine=" + prefer + " but mpegts.js unavailable" };
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
    if (typeof mpegts !== "undefined" && mpegts.isSupported()) return { engine: "mpegts", reason: "TS / video/mp2t or phonePlayingAsTs" };
    return { engine: "caf", reason: "TS path needed but mpegts.js unavailable" };
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
  const hdr = headers && typeof headers === "object" ? headers : {};
  log("mpegts.js: bind to #castVideo, url=" + playbackUrl);
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
      setReceiverLoaderVisible(false);
      scheduleCastingFailedMessage("Please wait or try again. MPEG-TS: " + stringifyForLog(etype) + " — " + stringifyForLog(detail));
    });
    if (mpegts.Events && mpegts.Events.LOADING_COMPLETE) {
      preetMpegtsInstance.on(mpegts.Events.LOADING_COMPLETE, function () {
        log("mpegts: LOADING_COMPLETE");
        clearCastingFailureUi();
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
  log("Hls.js: attachMedia #castVideo, url=" + playbackUrl);
  try {
    preetHlsInstance = new Hls({
      enableWorker: false,
      lowLatencyMode: false,
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
        setReceiverLoaderVisible(false);
        scheduleCastingFailedMessage("HLS: " + stringifyForLog(data.type) + " — " + stringifyForLog(data.details));
      }
    });
    preetHlsInstance.on(Hls.Events.MANIFEST_PARSED, function () {
      log("Hls.js: MANIFEST_PARSED");
      clearCastingFailureUi();
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
      setReceiverLoaderVisible(false);
      scheduleCastingFailedMessage("DASH: " + formatAnyError(err));
    });
    preetDashInstance.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, function () {
      log("dashjs: STREAM_INITIALIZED");
      clearCastingFailureUi();
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
    const headers = extractPlaybackHeaders(customData);
    const sr = customData.streamRequest && typeof customData.streamRequest === "object" ? customData.streamRequest : null;
    const senderResolved = sr && sr.url ? String(sr.url).trim() : "";
    const urlToResolve = senderResolved || originalUrl;

    let mimeType = media.contentType;
    if (!mimeType && sr && sr.contentType) {
      mimeType = String(sr.contentType).trim();
    }
    const probeHint = mimeType || (sr && sr.contentType ? String(sr.contentType) : "") || "";

    log("--------------------------------");
    log("LOAD contentUrl/contentId: " + originalUrl);
    if (senderResolved && senderResolved !== originalUrl) {
      log("streamRequest.url (sender): " + senderResolved);
    }
    log("customData.sender: " + (customData.sender || "(none)"));
    log("--------------------------------");

    const resolved = await resolveStream(urlToResolve, headers, probeHint);

    if (!mimeType) {
      mimeType = resolved.mimeType;
    }
    if (!mimeType) {
      mimeType = detectMimeTypeFromUrl(resolved.finalUrl);
    }
    if (mimeType === "application/x-mpegURL" && detectMimeTypeFromUrl(resolved.finalUrl) === "video/mp2t") {
      mimeType = "video/mp2t";
    }

    const decision = choosePlaybackEngine(customData, resolved.finalUrl, mimeType || "");
    log("LOAD strategy=" + decision.engine + " (" + decision.reason + ")");

    function buildStubOut(contentTypeStub) {
      const out = Object.assign({}, loadRequestData);
      out.media = Object.assign({}, media);
      out.media.contentId = resolved.finalUrl;
      out.media.contentUrl = STUB_MEDIA_URL;
      out.media.contentType = contentTypeStub || "video/mp4";
      out.media.streamType = cast.framework.messages.StreamType.LIVE;
      return out;
    }

    if (decision.engine === "mpegts") {
      const out = buildStubOut("video/mp4");
      setTimeout(function () {
        tryStartPreetMpegts(resolved.finalUrl, headers);
      }, 100);
      return out;
    }
    if (decision.engine === "hlsjs") {
      const out = buildStubOut("video/mp4");
      setTimeout(function () {
        tryStartPreetHls(resolved.finalUrl, headers);
      }, 100);
      return out;
    }
    if (decision.engine === "dashjs") {
      const out = buildStubOut("application/dash+xml");
      setTimeout(function () {
        tryStartPreetDash(resolved.finalUrl, headers);
      }, 100);
      return out;
    }

    let cafMime = mimeType;
    if (!cafMime || cafMime === "application/octet-stream" || cafMime === "video/*") {
      cafMime = detectMimeTypeFromUrl(resolved.finalUrl) || inferMimeFromSenderHints(customData, resolved.finalUrl);
    }
    if (!cafMime) {
      cafMime = "video/mp4";
    }

    media.contentId = resolved.finalUrl;
    media.contentUrl = resolved.finalUrl;
    media.contentType = cafMime;

    log("LOAD CAF-native: " + resolved.finalUrl + " | contentType=" + cafMime);

    return loadRequestData;
  } catch (e) {
    setReceiverLoaderVisible(false);
    logError("LOAD interceptor failed: " + formatAnyError(e));
    showCastingFailedMessageImmediate(formatAnyError(e));
    throw e;
  }
});

playerManager.addEventListener(cast.framework.events.EventType.ERROR, (event) => {
  setReceiverLoaderVisible(false);
  logError("PLAYER ERROR: " + formatPlayerErrorEvent(event));
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
  const PREET_MSG_NS = "urn:x-cast:com.arishtech.preetplayer";
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
