import { asObject, isTruthyFlag } from "./util.js";
import { state } from "./state.js";

export function repairStreamUrl(url) {
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

export function rewriteQueryParam(url, key, value) {
  try {
    const u = new URL(repairStreamUrl(url));
    if (!u.searchParams.has(key)) return null;
    u.searchParams.set(key, value);
    return normalizeCandidateUrl(u.toString());
  } catch (_e) {
    return null;
  }
}

export function appendQueryParam(url, key, value) {
  try {
    const u = new URL(repairStreamUrl(url));
    u.searchParams.set(key, value);
    return normalizeCandidateUrl(u.toString());
  } catch (_e) {
    return null;
  }
}

export function normalizeCandidateUrl(url) {
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

export function stripConflictingHlsHintsOnTsUrl(url) {
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

export function isHlsCandidate(url) {
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

export function isProgressiveCandidate(url) {
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

export function isLikelyLiveStream(url) {
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

export function isTsCandidate(url) {
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

export function shouldAttemptHlsJs(url) {
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

export function isDashCandidate(url) {
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

export function isXtreamStyleUrl(url) {
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

export function isProxyEnabled() {
  const proxyCfg = asObject(state.activeContract.proxy);
  return proxyCfg.enabled === true && String(proxyCfg.baseUrl || proxyCfg.manifestBaseUrl || "").trim() !== "";
}

export function isStaticHosting() {
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

export function xtreamNeedsDirectTsOnly() {
  const playback = asObject(state.activeContract.playback);
  if (playback.xtreamPreferTs === true || playback.vueottPreferTs === true) return true;
  return isStaticHosting() || !isProxyEnabled();
}

export function toTsVariant(url) {
  return rewriteQueryParam(url, "extension", "ts") || rewriteQueryParam(url, "ext", "ts") || appendQueryParam(url, "extension", "ts");
}

export function toM3u8Variant(url) {
  const repaired = repairStreamUrl(url);
  const rewritten = rewriteQueryParam(repaired, "extension", "m3u8") || rewriteQueryParam(repaired, "ext", "m3u8");
  if (rewritten) return normalizeCandidateUrl(rewritten);
  return normalizeCandidateUrl(appendQueryParam(repaired, "extension", "m3u8") || repaired);
}

export function phoneReceiverWantsM3u8BeforeTsForLivePhp(baseUrl, customData) {
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

export function buildCompatibilityCandidates(baseUrl, customData) {
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

export function inferContentType(url) {
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
export function getPlaybackStrategy(url, options) {
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

export function pickInitialUaIndex(url) {
  if (isXtreamStyleUrl(url) || isLikelyLiveStream(url)) return 0;
  return 1;
}

export function getStreamUrlFromPage() {
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

export function isBrowserTestMode() {
  try {
    const query = new URLSearchParams(window.location.search || "");
    const flag = String(query.get("browser") || query.get("test") || "").trim().toLowerCase();
    if (flag === "1" || flag === "true" || flag === "yes") return true;
  } catch (_e) {}
  return !!getStreamUrlFromPage();
}
