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

/**
 * Append one line to #debug (DOM text nodes — selectable, no innerHTML).
 * @param {string} line
 * @param {"info"|"error"|"warn"} level
 */
function appendLogLine(line, level) {
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

/**
 * Live TS / octet-stream IPTV URLs must never use an unconstrained GET in the receiver:
 * the body is effectively infinite and will hang or fail the LOAD interceptor.
 */
function shouldSkipHttpBodyProbe(url, contentTypeHint) {
  const u = String(url || "").toLowerCase();
  const ct = String(contentTypeHint || "").toLowerCase();
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

function destroyPreetMpegts() {
  if (!preetMpegtsInstance) return;
  try {
    if (typeof mpegts !== "undefined" && mpegts.Events) {
      preetMpegtsInstance.off(mpegts.Events.ERROR);
    }
  } catch (_e) {}
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
 * @param {string} mime
 * @param {string} url
 */
function isMpeg2TransportStreamPlayback(mime, url) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("mp2t") || m.includes("mpegts")) return true;
  const u = String(url || "").toLowerCase();
  if (u.includes("extension=ts") || u.includes("ext=ts")) return true;
  if (u.includes("video_type=") && u.includes("octet-stream")) return true;
  return false;
}

/**
 * @param {string} playbackUrl
 * @param {Record<string, string>} headers
 */
function tryStartPreetMpegts(playbackUrl, headers) {
  const videoEl = document.getElementById("castVideo");
  if (!videoEl) {
    logError("mpegts: missing #castVideo element in page");
    return;
  }
  if (typeof mpegts === "undefined" || !mpegts.isSupported()) {
    logError("mpegts.js not loaded or MSE unsupported on this device");
    return;
  }
  destroyPreetMpegts();
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
    });
    preetMpegtsInstance.attachMediaElement(videoEl);
    preetMpegtsInstance.load();
    const pr = preetMpegtsInstance.play();
    if (pr && typeof pr.catch === "function") {
      pr.catch(function (err) {
        logError("mpegts.play() rejected: " + formatAnyError(err));
      });
    }
  } catch (e) {
    logError("mpegts.createPlayer failed: " + formatAnyError(e));
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
    destroyPreetMpegts();

    const media = loadRequestData.media;
    const originalUrl = (media && (media.contentUrl || media.contentId)) || "";

    if (!media || !originalUrl) {
      logError("LOAD failed: missing media URL (contentUrl and contentId empty)");
      throw new cast.framework.messages.ErrorData(cast.framework.messages.ErrorType.LOAD_FAILED);
    }

    const customData = loadRequestData.customData || {};
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
    if (!mimeType) {
      mimeType = "application/x-mpegURL";
    }
    if (mimeType === "application/x-mpegURL" && detectMimeTypeFromUrl(resolved.finalUrl) === "video/mp2t") {
      mimeType = "video/mp2t";
    }

    const useMpegtsPath =
      isMpeg2TransportStreamPlayback(mimeType, resolved.finalUrl) &&
      typeof mpegts !== "undefined" &&
      mpegts.isSupported();

    if (useMpegtsPath) {
      const out = Object.assign({}, loadRequestData);
      out.media = Object.assign({}, media);
      out.media.contentId = resolved.finalUrl;
      out.media.contentUrl = STUB_MEDIA_URL;
      out.media.contentType = "video/mp4";
      out.media.streamType = cast.framework.messages.StreamType.LIVE;
      log(
        "LOAD: MPEG-TS → mpegts.js + #castVideo (CAF native cannot play video/mp2t; avoids MPL 104/905 on raw TS)"
      );
      setTimeout(function () {
        tryStartPreetMpegts(resolved.finalUrl, headers);
      }, 0);
      return out;
    }

    if (isMpeg2TransportStreamPlayback(mimeType, resolved.finalUrl)) {
      if (typeof mpegts === "undefined") {
        logWarn("MPEG-TS: mpegts.js not loaded — CAF will likely return detailedErrorCode 104");
      } else if (!mpegts.isSupported()) {
        logWarn("MPEG-TS: mpegts.isSupported() is false — CAF will likely return 104");
      }
    }

    media.contentId = resolved.finalUrl;
    media.contentUrl = resolved.finalUrl;
    media.contentType = mimeType;

    log("LOAD applied finalUrl + contentType: " + resolved.finalUrl + " | " + mimeType);

    return loadRequestData;
  } catch (e) {
    logError("LOAD interceptor failed: " + formatAnyError(e));
    throw e;
  }
});

playerManager.addEventListener(cast.framework.events.EventType.ERROR, (event) => {
  logError("PLAYER ERROR: " + formatPlayerErrorEvent(event));
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
}

context.start({
  disableIdleTimeout: true,
  useShakaForHls: true,
});

log("=================================");
log("PreetTV Cast Receiver Ready (CAF started)");
log("=================================");
