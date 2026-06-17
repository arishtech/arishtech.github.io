import { asObject } from "./util.js";

/**
 * Normalizes sender `customData` into the receiver contract (Phase 2).
 * @param {Record<string, unknown>} customData
 */
export function normalizeContract(customData) {
  const root = asObject(customData);
  const play = asObject(root.playback);
  const sb = asObject(root.streamBootstrap);
  const streamReq = asObject(root.streamRequest);
  const auth = asObject(root.auth);
  const mergedAuthHeaders = Object.assign({}, asObject(auth.headers), asObject(streamReq.headers));
  return {
    schemaVersion: Number(root.schemaVersion) || 1,
    auth: Object.assign({}, auth, { headers: mergedAuthHeaders }),
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
    streamRequest: streamReq,
  };
}
