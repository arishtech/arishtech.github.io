/* global cast */

const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();
const statusEl = document.getElementById("status");

let activeCandidates = [];
let activeCandidateIndex = 0;
let lastLoadTemplate = null;

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
  };
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
  const candidates = [];
  const seen = new Set();
  const push = (value) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    candidates.push(value);
  };

  push(baseUrl);

  if (customData && Array.isArray(customData.candidateUrls)) {
    customData.candidateUrls.forEach(push);
  }

  const lower = (baseUrl || "").toLowerCase();
  const looksLikeLivePhp = lower.includes("/live.php");
  let extensionHint = "";
  try {
    const u = new URL(baseUrl);
    extensionHint = (u.searchParams.get("extension") || u.searchParams.get("ext") || "").toLowerCase();
  } catch (_e) {}

  const looksTs = extensionHint === "ts" || lower.endsWith(".ts");
  const looksHls = extensionHint === "m3u8" || lower.endsWith(".m3u8");

  if (looksTs) {
    push(rewriteQueryParam(baseUrl, "extension", "m3u8"));
    push(rewriteQueryParam(baseUrl, "ext", "m3u8"));
  }

  if (looksHls) {
    push(rewriteQueryParam(baseUrl, "extension", "ts"));
    push(rewriteQueryParam(baseUrl, "ext", "ts"));
  }

  if (looksLikeLivePhp && !extensionHint) {
    push(appendQueryParam(baseUrl, "extension", "m3u8"));
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

    rewritten = applyTokenQueryPolicy(rewritten);
    rewritten = applyProxyPolicy(rewritten, requestType);
    networkRequestInfo.url = rewritten;

    mergeRequestHeaders(networkRequestInfo);
  } catch (e) {
    setStatus(`Network policy hook failed (${requestType}): ${e && e.message ? e.message : "unknown"}`);
  }
}

function prepareLoadForCandidate(loadRequestData, candidateUrl) {
  const cloned = Object.assign({}, loadRequestData);
  cloned.media = Object.assign({}, loadRequestData.media);
  cloned.media.contentUrl = candidateUrl;
  if (!cloned.media.contentType || cloned.media.contentType === "video/*") {
    cloned.media.contentType = inferContentType(candidateUrl);
  }
  return cloned;
}

async function tryLoadNextCandidateOnReceiverError() {
  if (!lastLoadTemplate) return;
  if (activeCandidateIndex >= activeCandidates.length - 1) {
    setStatus("All receiver fallback candidates exhausted");
    return;
  }

  activeCandidateIndex += 1;
  const nextUrl = activeCandidates[activeCandidateIndex];
  const nextLoad = prepareLoadForCandidate(lastLoadTemplate, nextUrl);
  setStatus(`Retrying candidate ${activeCandidateIndex + 1}/${activeCandidates.length}`);

  try {
    await playerManager.load(nextLoad);
  } catch (e) {
    setStatus(`Receiver retry failed: ${e && e.message ? e.message : "unknown"}`);
  }
}

playerManager.setMessageInterceptor(cast.framework.messages.MessageType.LOAD, (loadRequestData) => {
  try {
    const media = loadRequestData.media || {};
    const customData = asObject(loadRequestData.customData);
    const baseUrl = media.contentUrl;
    if (!baseUrl) return loadRequestData;

    activeContract = normalizeContract(customData);

    activeCandidates = buildCompatibilityCandidates(baseUrl, customData);
    activeCandidateIndex = Number.isInteger(customData.candidateIndex)
      ? Math.max(0, Math.min(customData.candidateIndex, activeCandidates.length - 1))
      : 0;

    const selectedUrl = activeCandidates[activeCandidateIndex] || baseUrl;
    const selectedLoad = prepareLoadForCandidate(loadRequestData, selectedUrl);
    lastLoadTemplate = loadRequestData;

    setStatus(`Loading ${activeCandidateIndex + 1}/${activeCandidates.length}`);
    return selectedLoad;
  } catch (e) {
    setStatus(`LOAD interceptor error: ${e && e.message ? e.message : "unknown"}`);
    return loadRequestData;
  }
});

playerManager.addEventListener(cast.framework.events.EventType.ERROR, () => {
  void tryLoadNextCandidateOnReceiverError();
});

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



