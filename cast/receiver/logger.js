import { DEBUG_HISTORY_LIMIT } from "./constants.js";
import { state } from "./state.js";

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
export function debugLog(event, payload) {
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
export function applyDebugConfigFromContract(contract, rawCustom) {
  const dbg = /** @type {Record<string, unknown>} */ (contract.debug || {});
  const raw = /** @type {Record<string, unknown>} */ (rawCustom || {});
  const rawDbg = /** @type {Record<string, unknown>} */ (raw.debug || {});
  if (dbg.enabled === true || rawDbg.enabled === true || raw.castDebugEnabled === true) {
    state.debugEnabled = true;
    document.body.classList.add("receiver-debug");
  }
}
