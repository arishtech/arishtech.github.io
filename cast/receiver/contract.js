import { asObject } from "./util.js";

/**
 * Normalizes sender `customData` into the receiver contract (Phase 2).
 * @param {Record<string, unknown>} customData
 */
export function normalizeContract(customData) {
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
