import { DEFAULT_IPTV_USER_AGENT, IPTV_USER_AGENTS } from "./constants.js";
import { state } from "./state.js";
import { asObject, asStringArray, summarizeHeaders } from "./util.js";
import { debugLog } from "./logger.js";
import { setStatus } from "./dom.js";
import { normalizeCandidateUrl } from "./url.js";

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

export function applyTokenQueryPolicy(url) {
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
export function applyProxyRewrite(url, requestType) {
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
export function resolveFetchUrl(url, requestType) {
  let out = normalizeCandidateUrl(url);
  const proxyCfg = asObject(state.activeContract.proxy);
  if (proxyCfg.enabled !== true) return out;
  return applyProxyRewrite(out, requestType || "manifest");
}

export function mergeRequestHeaders(networkRequestInfo) {
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

export function applyDefaultIptvHeaders(networkRequestInfo) {
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

export function classifyHlsRequestType(url) {
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
export function applyNetworkPolicy(networkRequestInfo, requestType) {
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

export function buildCafRequestHeaders(requestUrl, uaIndex) {
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

export function buildFetchRequestHeaders(requestUrl, uaIndex) {
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

export function buildIptvRequestHeaders(requestUrl, uaIndex) {
  return buildCafRequestHeaders(requestUrl, uaIndex);
}

export function auditNetworkEnvironment(requestUrl) {
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

export function rotateIptvUserAgent(reason) {
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

export function ensureShakaRequestFilters() {
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

export function createPlaybackConfig() {
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

export function streamHostsMatch(requestUrl, candidateUrl) {
  try {
    const a = new URL(normalizeCandidateUrl(requestUrl));
    const b = new URL(normalizeCandidateUrl(candidateUrl));
    return a.host === b.host;
  } catch (_e) {
    return false;
  }
}

export function installIptvNetworkShim(requestUrl) {
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

export function removeIptvNetworkShim() {
  if (state.activeIptvNetworkShim && typeof state.activeIptvNetworkShim.restore === "function") {
    state.activeIptvNetworkShim.restore();
  }
}
