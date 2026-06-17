// receiver.js — PreetTV Cast custom receiver (CAF v3)
// Compatible with Android sender: customData.streamRequest { url, contentType, headers },
// customData.auth.headers, and optional customData.headers.

const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();

function log(msg) {
  const line = typeof msg === "string" ? msg : (() => {
    try {
      return JSON.stringify(msg);
    } catch (_e) {
      return String(msg);
    }
  })();
  console.log(line);
  const div = document.getElementById("debug");
  if (div) {
    div.innerHTML += line + "<br>";
  }
}

log("=================================");
log("PreetTV Cast Receiver Starting");
log("=================================");

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
 * Resolve URL and inspect response (browser may ignore some header names on fetch).
 */
async function resolveStream(url, headers) {
  const hdr = headers && typeof headers === "object" ? headers : {};
  try {
    log("Resolving URL: " + url);
    log("Request header keys: " + Object.keys(hdr).join(", ") || "(none)");

    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: hdr,
    });

    const finalUrl = response.url;
    const contentType = response.headers.get("content-type");
    log("Resolved URL: " + finalUrl);
    log("Response Content-Type: " + (contentType || "(none)"));

    return {
      finalUrl,
      mimeType: detectMimeTypeFromHeader(contentType),
    };
  } catch (e) {
    console.error("Resolution failed", e);
    log("Resolution failed: " + (e && e.message ? e.message : String(e)));
    return {
      finalUrl: url,
      mimeType: null,
    };
  }
}

/**
 * Inject headers into all CAF manifest/segment/license requests
 */
playerManager.setMediaPlaybackInfoHandler((loadRequestData, playbackConfig) => {
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
});

/**
 * Intercept LOAD — align with Android customData.streamRequest
 */
playerManager.setMessageInterceptor(cast.framework.messages.MessageType.LOAD, async (loadRequestData) => {
  try {
    const media = loadRequestData.media;
    const originalUrl = (media && (media.contentUrl || media.contentId)) || "";

    if (!media || !originalUrl) {
      log("LOAD failed: missing media URL");
      throw new cast.framework.messages.ErrorData(cast.framework.messages.ErrorType.LOAD_FAILED);
    }

    const customData = loadRequestData.customData || {};
    const headers = extractPlaybackHeaders(customData);
    const sr = customData.streamRequest && typeof customData.streamRequest === "object" ? customData.streamRequest : null;
    const senderResolved = sr && sr.url ? String(sr.url).trim() : "";
    const urlToResolve = senderResolved || originalUrl;

    log("--------------------------------");
    log("LOAD contentUrl/contentId: " + originalUrl);
    if (senderResolved && senderResolved !== originalUrl) {
      log("streamRequest.url (sender): " + senderResolved);
    }
    log("customData.sender: " + (customData.sender || "(none)"));
    log("--------------------------------");

    const resolved = await resolveStream(urlToResolve, headers);

    media.contentId = resolved.finalUrl;
    if (media.contentUrl !== undefined) {
      media.contentUrl = resolved.finalUrl;
    }

    let mimeType = media.contentType;
    if (!mimeType && sr && sr.contentType) {
      mimeType = String(sr.contentType).trim();
    }
    if (!mimeType) {
      mimeType = resolved.mimeType;
    }
    if (!mimeType) {
      mimeType = detectMimeTypeFromUrl(resolved.finalUrl);
    }
    if (!mimeType) {
      mimeType = "application/x-mpegURL";
    }
    media.contentType = mimeType;

    log("LOAD applied finalUrl + contentType: " + resolved.finalUrl + " | " + mimeType);

    return loadRequestData;
  } catch (e) {
    console.error("LOAD interceptor error", e);
    log("LOAD interceptor error: " + (e && e.message ? e.message : String(e)));
    throw e;
  }
});

playerManager.addEventListener(cast.framework.events.EventType.ERROR, (event) => {
  console.error("PLAYER ERROR", event);
  log("PLAYER ERROR: " + (event && event.detailedErrorCode != null ? "code=" + event.detailedErrorCode : String(event)));
});

playerManager.addEventListener(cast.framework.events.EventType.MEDIA_STATUS, (event) => {
  log("MEDIA_STATUS: " + (event && event.mediaSession ? "session update" : "update"));
});

context.start({
  disableIdleTimeout: true,
  useShakaForHls: true,
});

log("=================================");
log("PreetTV Cast Receiver Ready (CAF started)");
log("=================================");
