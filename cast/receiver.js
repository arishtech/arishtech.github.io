/* PreetTV Cast receiver — bundled (no ES modules). Built by tools/bundle_receiver.py */
/* global cast, Hls, dashjs, mpegts */
(function () {
"use strict";

/* --- receiver/constants.js --- */
/** @type {readonly string[]} */
const IPTV_USER_AGENTS = [
  "VLC/3.0.20 LibVLC/3.0.20",
  "Mozilla/5.0 (Linux; Android 11; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  "PreetTV Cast/1.0",
];

const DEFAULT_IPTV_USER_AGENT = IPTV_USER_AGENTS[1];
const CUSTOM_PLAYER_STUB_URL = "about:blank";
const DEBUG_HISTORY_LIMIT = 200;

const STALL_WATCHDOG_MS = 22000;
const STALL_WATCHDOG_BOOT_DEFER_MAX = 6;
const HLS_BOOT_TIMEOUT_MS = 35000;
const MPEGTS_BOOT_WALL_MS = 55000;

/* --- receiver/util.js --- */
/**
 * Shared parsing / coercion helpers (pure).
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return /** @type {Record<string, unknown>} */ (value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return /** @type {Record<string, unknown>} */ (parsed);
    } catch (_e) {}
  }
  return {};
}

/** @param {unknown} value */
function isTruthyFlag(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

/** @param {unknown} value */
function asStringArray(value) {
  return Array.isArray(value) ? value.map((v) => String(v || "").trim()).filter((v) => v.length > 0) : [];
}

/** @param {unknown} value */
function readSenderCandidateIndex(value) {
  if (value == null) return null;
  if (Number.isInteger(value)) return /** @type {number} */ (value);
  const parsed = parseInt(String(value).trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** @param {unknown} err */
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

/** @param {unknown} err */
function isPlayInterruptedError(err) {
  const msg = String((err && /** @type {{ message?: string }} */ (err).message) || err || "");
  return (
    msg.indexOf("interrupted by a call to pause") >= 0 ||
    msg.indexOf("interrupted by a new load") >= 0 ||
    msg.indexOf("The play() request was interrupted") >= 0
  );
}

/** @param {unknown} value */
function summarizeHeaders(value) {
  const h = asObject(value);
  const keys = Object.keys(h);
  return { count: keys.length, keys };
}

/* --- receiver/state.js --- */
/**
 * Single mutable session state for the Cast receiver (explicit data model).
 * Modules import `state` and mutate fields — avoids implicit globals.
 */
const defaultContract = {
  schemaVersion: 1,
  auth: {},
  token: {},
  proxy: {},
  networkPolicy: {},
  hosting: {},
  playback: {},
  channelName: "",
  debug: {},
};

const state = {
  useCastReceiver: false,
  context: null,
  playerManager: null,

  activeContract: { ...defaultContract },

  activeCandidates: [],
  activeCandidateIndex: 0,
  lastLoadTemplate: null,
  loadSessionPreferredStartIndex: 0,
  receiverBackwardFallbackUsed: false,
  candidatesExhausted: false,
  candidateAdvanceInFlight: false,

  activeIptvUaIndex: 0,

  hlsInstance: null,
  hlsJsInvocationCounter: 0,
  dashInstance: null,
  mpegtsInstance: null,

  activeCustomPlayer: null,
  activeCustomPlayerUrl: "",
  pendingCustomPlayerBoot: null,

  stallWatchdogTimer: null,
  stallWatchdogSerial: 0,
  stallWatchdogBootDeferCount: 0,

  shakaFilterRegistered: false,
  volumeBridgeInstalled: false,

  activeIptvNetworkShim: null,

  debugEnabled: false,
  debugSequence: 0,
  debugHistory: [],

  CUSTOM_PLAYER_STUB_URL,
};

/* --- receiver/logger.js --- */
const DEBUG_QUERY_FLAG = (() => {
  try {
    const query = new URLSearchParams(window.location.search || "");
    const value = String(query.get("debug") || "").trim().toLowerCase();
    return value === "1" || value === "true" || value === "yes" || value === "verbose";
  } catch (_e) {
    return false;
  }
})();

const ring = window.__preettvDebug || [];
window.__preettvDebug = ring;
state.debugHistory = ring;

state.debugEnabled = DEBUG_QUERY_FLAG || document.body.classList.contains("receiver-debug");

/**
 * @param {string} event
 * @param {Record<string, unknown>} [payload]
 */
function debugLog(event, payload) {
  const ev = String(event || "");
  const isNoise = ev === "network.policy.applied";
  if (isNoise && !state.debugEnabled) return;
  const entry = {
    seq: ++state.debugSequence,
    ts: new Date().toISOString(),
    event: ev,
    payload: payload || {},
  };
  state.debugHistory.push(entry);
  if (state.debugHistory.length > DEBUG_HISTORY_LIMIT) state.debugHistory.shift();
  if (typeof window.__preettvNotifyDebugLog === "function") {
    try {
      window.__preettvNotifyDebugLog();
    } catch (_e) {}
  }
}

/** @param {Record<string, unknown>} contract @param {Record<string, unknown>} rawCustom */
function applyDebugConfigFromContract(contract, rawCustom) {
  const dbg = /** @type {Record<string, unknown>} */ (contract.debug || {});
  const raw = /** @type {Record<string, unknown>} */ (rawCustom || {});
  const rawDbg = /** @type {Record<string, unknown>} */ (raw.debug || {});
  if (dbg.enabled === true || rawDbg.enabled === true || raw.castDebugEnabled === true) {
    state.debugEnabled = true;
    document.body.classList.add("receiver-debug");
  }
}

/* --- receiver/dom.js --- */
const statusEl = () => document.getElementById("status");
const brandEl = () => document.getElementById("preetBrand");
const nowPlayingEl = () => document.getElementById("preetNowPlaying");
const loaderEl = () => document.getElementById("preetLoader");
const loaderTextEl = () => document.getElementById("preetLoaderText");
const getCastVideoEl = () => document.getElementById("castVideo");

/** @param {string} text */
function setStatus(text) {
  const el = statusEl();
  if (el) el.textContent = text || "";
}

/** @param {boolean} visible */
function setBrandingVisible(visible) {
  const el = brandEl();
  if (el) el.style.display = visible ? "block" : "none";
}

/** @param {string} [text] */
function showLoader(text) {
  const l = loaderEl();
  const t = loaderTextEl();
  if (l) l.classList.remove("hidden");
  if (t) t.textContent = text || "Loading…";
}

function hideLoader() {
  const l = loaderEl();
  if (l) l.classList.add("hidden");
}

/** @param {string} name */
function updateCastChannelNameUi(name) {
  const el = nowPlayingEl();
  if (!el) return;
  const label = String(name || "").trim();
  if (!label) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.classList.remove("hidden");
  el.textContent = label;
}

/** @param {number} level @param {boolean} muted */
function applyReceiverVolume(level, muted) {
  const castVideoEl = getCastVideoEl();
  if (!castVideoEl) return;
  const vol = Math.max(0, Math.min(1, Number(level) || 0));
  castVideoEl.volume = muted ? 0 : vol;
  castVideoEl.muted = !!muted;
}

function installVolumeBridge() {
  const castGlobal = window.cast;
  const castVideoEl = getCastVideoEl();
  if (state.volumeBridgeInstalled || !state.playerManager || !castVideoEl || !castGlobal?.framework) return;
  state.volumeBridgeInstalled = true;
  try {
    applyReceiverVolume(state.playerManager.getVolumeLevel(), state.playerManager.isMute());
  } catch (_e) {}

  const Ev = castGlobal.framework.events.EventType;
  const volEv = Ev && Ev.STREAM_VOLUME_CHANGED;
  safeAddPlayerEventListener(volEv, (event) => {
    const level = event && typeof event.volume === "number" ? event.volume : state.playerManager.getVolumeLevel();
    const muted = event && typeof event.isMute === "boolean" ? event.isMute : state.playerManager.isMute();
    applyReceiverVolume(level, muted);
  }, "STREAM_VOLUME_CHANGED");

  try {
    state.playerManager.setMessageInterceptor(castGlobal.framework.messages.MessageType.SET_VOLUME, (data) => {
      if (data) applyReceiverVolume(data.volume, data.isMute);
      return data;
    });
  } catch (e) {
    debugLog("player.set_volume.interceptor_error", { message: e && e.message ? e.message : "unknown" });
  }
}

/**
 * @param {string|number|undefined|null} eventType
 * @param {(e: unknown) => void} handler
 * @param {string} label
 */
function safeAddPlayerEventListener(eventType, handler, label) {
  if (!state.playerManager || typeof state.playerManager.addEventListener !== "function") return;
  if (eventType == null || eventType === "") return;
  try {
    state.playerManager.addEventListener(eventType, handler);
  } catch (e) {
    debugLog("player.add_listener.error", { label, message: e && e.message ? e.message : "unknown" });
  }
}

function bindMediaElementToPlayer() {
  const castVideoEl = getCastVideoEl();
  if (castVideoEl && state.playerManager && state.useCastReceiver && typeof state.playerManager.setMediaElement === "function") {
    state.playerManager.setMediaElement(castVideoEl);
  }
}

function onPlaybackStartedUi() {
  hideLoader();
  setBrandingVisible(false);
  installVolumeBridge();
  if (state.useCastReceiver && state.playerManager) {
    try {
      requestAnimationFrame(() => {
        try {
          state.playerManager.play();
        } catch (_e) {}
      });
    } catch (_e) {}
  }
}

/* --- receiver/contract.js --- */
/**
 * Normalizes sender `customData` into the receiver contract (Phase 2).
 * @param {Record<string, unknown>} customData
 */
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

/* --- receiver/url.js --- */
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

function isProxyEnabled() {
  const proxyCfg = asObject(state.activeContract.proxy);
  return proxyCfg.enabled === true && String(proxyCfg.baseUrl || proxyCfg.manifestBaseUrl || "").trim() !== "";
}

function isStaticHosting() {
  const hosting = asObject(state.activeContract.hosting);
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

function xtreamNeedsDirectTsOnly() {
  const playback = asObject(state.activeContract.playback);
  if (playback.xtreamPreferTs === true || playback.vueottPreferTs === true) return true;
  return isStaticHosting() || !isProxyEnabled();
}

function toTsVariant(url) {
  return rewriteQueryParam(url, "extension", "ts") || rewriteQueryParam(url, "ext", "ts") || appendQueryParam(url, "extension", "ts");
}

function toM3u8Variant(url) {
  const repaired = repairStreamUrl(url);
  const rewritten = rewriteQueryParam(repaired, "extension", "m3u8") || rewriteQueryParam(repaired, "ext", "m3u8");
  if (rewritten) return normalizeCandidateUrl(rewritten);
  return normalizeCandidateUrl(appendQueryParam(repaired, "extension", "m3u8") || repaired);
}

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
  if (phoneResolved) push(phoneResolved);

  const phonePrimary = String(
    (customData && customData.streamBootstrap && customData.streamBootstrap.phonePrimaryUrl) || ""
  ).trim();
  if (phonePrimary) push(phonePrimary);

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

function inferContentType(url) {
  const lower = (url || "").toLowerCase();
  try {
    const u = new URL(url);
    const ext = (u.searchParams.get("extension") || u.searchParams.get("ext") || "").toLowerCase();
    const type = (u.searchParams.get("type") || u.searchParams.get("output") || u.searchParams.get("format") || "").toLowerCase();
    if (ext === "ts" || lower.endsWith(".ts")) return "video/mp2t";
    if (lower.endsWith(".m3u8") || ext === "m3u8" || type === "m3u8" || type === "hls") return "application/x-mpegURL";
    if (lower.endsWith(".mpd") || ext === "mpd" || type === "mpd" || type === "dash") return "application/dash+xml";
    if (type === "ts") return "video/mp2t";
    if (lower.endsWith(".mp4") || ext === "mp4" || type === "mp4") return "video/mp4";
    if (lower.endsWith(".webm") || ext === "webm" || type === "webm") return "video/webm";
  } catch (_e) {}
  return "video/*";
}

/**
 * @param {string} url
 * @param {{ forBrowser?: boolean }} [options]
 */
function getPlaybackStrategy(url, options) {
  const forBrowser = !!(options && options.forBrowser);
  const pb = asObject(state.activeContract.playback);
  const chStream = String(pb.channelStreamType || "").toLowerCase();

  if (!forBrowser && state.useCastReceiver) {
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
  if (!forBrowser && state.useCastReceiver && chStream.includes("hls")) {
    if (isHlsCandidate(url)) return "hlsjs";
    if (shouldAttemptHlsJs(url)) return "hlsjs";
  }
  if (!forBrowser && (chStream.includes("dash") || chStream.includes("mpd")) && isDashCandidate(url)) {
    return "dashjs";
  }
  if (isProgressiveCandidate(url)) return "native";
  if (isDashCandidate(url)) return "dashjs";
  if (isTsCandidate(url)) {
    if (state.useCastReceiver) return "caf-ts";
    return "mpegts";
  }
  if (isHlsCandidate(url)) {
    if (forBrowser) return "hlsjs";
    if (state.useCastReceiver) return "hlsjs";
    if (isXtreamStyleUrl(url) || isLikelyLiveStream(url)) return "hlsjs";
    return "caf-hls";
  }
  if (shouldAttemptHlsJs(url)) return "hlsjs";
  return "native";
}

function pickInitialUaIndex(url) {
  if (isXtreamStyleUrl(url) || isLikelyLiveStream(url)) return 0;
  return 1;
}

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

/* --- receiver/network.js --- */
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

function applyTokenQueryPolicy(url) {
  const tokenCfg = asObject(state.activeContract.token);
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

/**
 * Rewrites a plain URL string through the proxy contract (returns original if disabled).
 * @param {string} url
 * @param {string} requestType manifest|segment|license
 */
function applyProxyRewrite(url, requestType) {
  const proxyCfg = asObject(state.activeContract.proxy);
  if (proxyCfg.enabled !== true) return url;

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

    if (proxyCfg.addChannelName && state.activeContract.channelName) {
      proxyUrl.searchParams.set("channel", state.activeContract.channelName);
    }

    return proxyUrl.toString();
  } catch (_e) {
    return url;
  }
}

/** @param {string} url @param {string} [requestType] */
function resolveFetchUrl(url, requestType) {
  let out = normalizeCandidateUrl(url);
  const proxyCfg = asObject(state.activeContract.proxy);
  if (proxyCfg.enabled !== true) return out;
  return applyProxyRewrite(out, requestType || "manifest");
}

function mergeRequestHeaders(networkRequestInfo) {
  const authCfg = asObject(state.activeContract.auth);
  const policyCfg = asObject(state.activeContract.networkPolicy);
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

function applyDefaultIptvHeaders(networkRequestInfo) {
  const headers = asObject(networkRequestInfo.headers);
  const hasUserAgent = Object.keys(headers).some((name) => name.toLowerCase() === "user-agent");
  if (!hasUserAgent) {
    headers["User-Agent"] = IPTV_USER_AGENTS[state.activeIptvUaIndex] || DEFAULT_IPTV_USER_AGENT;
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

/**
 * @param {{ url?: string, headers?: Record<string, unknown> }} networkRequestInfo
 * @param {string} requestType
 */
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
    rewritten = applyProxyRewrite(rewritten, requestType);
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

function buildCafRequestHeaders(requestUrl, uaIndex) {
  const info = { url: normalizeCandidateUrl(requestUrl), headers: {} };
  const chosenUa = IPTV_USER_AGENTS[Number.isInteger(uaIndex) ? uaIndex : state.activeIptvUaIndex] || DEFAULT_IPTV_USER_AGENT;
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

function auditNetworkEnvironment(requestUrl) {
  const target = normalizeCandidateUrl(requestUrl);
  let streamOrigin = "";
  try {
    streamOrigin = new URL(target).origin;
  } catch (_e) {}
  let receiverOrigin = "";
  try {
    receiverOrigin = window.location.origin;
  } catch (_e) {}
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

function rotateIptvUserAgent(reason) {
  state.activeIptvUaIndex = (state.activeIptvUaIndex + 1) % IPTV_USER_AGENTS.length;
  debugLog("network.ua.rotate", {
    reason,
    activeIptvUaIndex: state.activeIptvUaIndex,
    userAgent: IPTV_USER_AGENTS[state.activeIptvUaIndex],
  });
}

function classifyCafShakaRequestType(type) {
  if (type === 0) return "manifest";
  if (type === 1) return "segment";
  if (type === 2) return "license";
  return "segment";
}

function ensureShakaRequestFilters() {
  if (state.shakaFilterRegistered || !state.playerManager) return;
  try {
    const player = typeof state.playerManager.getPlayer === "function" ? state.playerManager.getPlayer() : null;
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
    state.shakaFilterRegistered = true;
    debugLog("network.shaka_filter.registered", {});
  } catch (e) {
    debugLog("network.shaka_filter.error", { message: e && e.message ? e.message : "unknown" });
  }
}

function createPlaybackConfig() {
  const castGlobal = window.cast;
  const playbackConfig = new castGlobal.framework.PlaybackConfig();
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
      const url = typeof input === "string" ? input : input && input.url ? input.url : "";
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
    const nativeSend = xhr.send;
    xhr.send = function patchedSend() {
      if (shouldShim(xhrUrl)) {
        Object.keys(headers).forEach((name) => {
          try {
            nativeSetHeader.call(xhr, name, headers[name]);
          } catch (_e) {}
        });
      }
      return nativeSend.apply(xhr, arguments);
    };
    return xhr;
  }
  PatchedXHR.prototype = OriginalXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;

  state.activeIptvNetworkShim = {
    restore() {
      if (originalFetch) window.fetch = originalFetch;
      window.XMLHttpRequest = OriginalXHR;
      state.activeIptvNetworkShim = null;
    },
  };
  return state.activeIptvNetworkShim;
}

function removeIptvNetworkShim() {
  if (state.activeIptvNetworkShim && typeof state.activeIptvNetworkShim.restore === "function") {
    state.activeIptvNetworkShim.restore();
  }
}

/* --- receiver/players.js --- */
/* global Hls, dashjs, mpegts */
function stopPlaybackKeepalive() {}

function destroyHls() {
  if (state.hlsInstance) {
    try {
      state.hlsInstance.destroy();
    } catch (_e) {}
    state.hlsInstance = null;
  }
}

function destroyDash() {
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

function destroyMpegts() {
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

function clearCustomPlayer() {
  state.activeCustomPlayer = null;
  state.activeCustomPlayerUrl = "";
  stopPlaybackKeepalive();
}

function readVideoBlobUrl() {
  const castVideoEl = getCastVideoEl();
  if (!castVideoEl) return "";
  const mediaSrc = castVideoEl.currentSrc || castVideoEl.src || "";
  return mediaSrc.startsWith("blob:") ? mediaSrc : "";
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
      const h = /** @type {Record<string, string>} */ (info.headers || {});
      Object.keys(h).forEach((k) => {
        try {
          xhr.setRequestHeader(k, h[k]);
        } catch (_e) {}
      });
    },
  };
}

function hlsIsAvailable() {
  const castVideoEl = getCastVideoEl();
  return castVideoEl && typeof Hls !== "undefined" && Hls.isSupported();
}

function dashIsAvailable() {
  const castVideoEl = getCastVideoEl();
  return castVideoEl && typeof dashjs !== "undefined";
}

function mpegtsIsAvailable() {
  const castVideoEl = getCastVideoEl();
  return castVideoEl && typeof mpegts !== "undefined" && mpegts.isSupported();
}

/**
 * @param {unknown} loadRequestData
 * @param {string} candidateUrl
 * @param {number} [retryIndex]
 */
function prepareLoadForCandidate(loadRequestData, candidateUrl, retryIndex) {
  const cloned = Object.assign({}, loadRequestData);
  cloned.media = Object.assign({}, asObject(loadRequestData && loadRequestData.media));
  cloned.media.contentId = candidateUrl;
  cloned.media.contentUrl = candidateUrl;
  cloned.media.contentType = inferContentType(candidateUrl);
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

function prepareCustomPlayerStubLoad(selectedLoad, sourceUrl, playerType) {
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

function finalizeCustomPlayerLoad(selectedLoad, sourceUrl, playerType) {
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

function buildCafNativeTsLoad(selectedLoad, sourceUrl) {
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
function startHlsJsPlayback(rawSourceUrl, selectedLoad, hooks) {
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
function startMpegtsPlayback(rawSourceUrl, selectedLoad, hooks) {
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
function startDashJsPlayback(sourceUrl, selectedLoad, hooks) {
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

async function tryNativeCafHlsReload(sourceUrl) {
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

async function tryNativeCafTsReload(sourceUrl) {
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
async function handleCustomInterceptorFailure(playerType, err, selectedLoad, sourceUrl, advanceCandidate) {
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

/* --- receiver/pipeline.js --- */
function clearStallWatchdog() {
  if (state.stallWatchdogTimer) {
    clearTimeout(state.stallWatchdogTimer);
    state.stallWatchdogTimer = null;
  }
}

function armStallWatchdog(source) {
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

function markCandidatesExhausted(reason) {
  if (state.candidatesExhausted) return;
  state.candidatesExhausted = true;
  hideLoader();
  setBrandingVisible(true);
  updateCastChannelNameUi("");
  setStatus("All receiver fallback candidates exhausted");
  debugLog("candidate.exhausted", { reason, activeCandidateIndex: state.activeCandidateIndex, candidateCount: state.activeCandidates.length });
}

async function tryLoadNextCandidateOnReceiverError(reason) {
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

async function advanceCandidateAfterCustomFailure(reason) {
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

function installCastPipeline() {
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

function registerUnhandledRejection() {
  window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev && ev.reason;
    const message = reason && reason.message ? reason.message : String(reason || "unknown");
    debugLog("receiver.unhandledrejection", { reason: message });
    if (message === "HttpStatusCodeInvalid" || message.includes("HttpStatusCodeInvalid")) {
      if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
    }
  });
}

/* --- receiver/app.js --- */
/**
 * PreetTV Cast receiver — entry (ES modules).
 * Depends on: cast_receiver_framework.js, Hls, dashjs, mpegts (globals from index.html).
 */
const castGlobal = window.cast;
const hasCastFramework = !!(castGlobal && castGlobal.framework && castGlobal.framework.CastReceiverContext);
const context = hasCastFramework ? castGlobal.framework.CastReceiverContext.getInstance() : null;
const playerManager = context ? context.getPlayerManager() : null;

const browserTestMode = isBrowserTestMode();
state.useCastReceiver = !!(hasCastFramework && playerManager && context && !browserTestMode);
state.context = context;
state.playerManager = playerManager;

bindMediaElementToPlayer();
registerUnhandledRejection();

if (state.useCastReceiver) {
  installCastPipeline();
  // Same idea as minimal receivers (e.g. cast-receiver-main): Shaka for HLS improves CAF native HLS.
  // https://developers.google.com/cast/docs/web_receiver/shaka_migration
  context.start({
    useShakaForHls: true,
    playbackConfig: createPlaybackConfig(),
  });
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
window.__preetCastReceiverBooted = true;

function initBrowserPlayback() {
  const castVideoEl = getCastVideoEl();

  function browserLoadCandidate(candidateUrl) {
    if (!candidateUrl || !castVideoEl) return;
    destroyHls();
    destroyDash();
    destroyMpegts();
    castVideoEl.removeAttribute("src");
    castVideoEl.load();

    if (isDashCandidate(candidateUrl)) {
      state.dashInstance = dashjs.MediaPlayer().create();
      state.dashInstance.attachView(castVideoEl);
      state.dashInstance.attachSource(candidateUrl);
      state.dashInstance.play();
      setStatus("Browser: DASH");
      return;
    }
    if (isHlsCandidate(candidateUrl) && hlsIsAvailable()) {
      state.hlsInstance = new Hls(buildHlsJsConfig());
      state.hlsInstance.attachMedia(castVideoEl);
      state.hlsInstance.loadSource(candidateUrl);
      state.hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        castVideoEl.play().catch(() => {});
      });
      setStatus("Browser: HLS");
      return;
    }
    if (isTsCandidate(candidateUrl) && mpegtsIsAvailable()) {
      state.mpegtsInstance = mpegts.createPlayer(
        { type: "mpegts", isLive: true, url: candidateUrl, hasAudio: true, hasVideo: true },
        buildMpegtsPlayerConfig()
      );
      state.mpegtsInstance.attachMediaElement(castVideoEl);
      state.mpegtsInstance.load();
      state.mpegtsInstance.play().catch(() => {});
      setStatus("Browser: MPEG-TS");
      return;
    }
    castVideoEl.src = candidateUrl;
    castVideoEl.play().catch(() => {});
    setStatus("Browser: progressive");
  }

  function browserLoadUrl(url) {
    if (!url) return;
    const bcCandidates = buildCompatibilityCandidates(url, {}).map((c) => normalizeCandidateUrl(c));
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

})();
