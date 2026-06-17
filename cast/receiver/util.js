/**
 * Shared parsing / coercion helpers (pure).
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function asObject(value) {
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
export function isTruthyFlag(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

/** @param {unknown} value */
export function asStringArray(value) {
  return Array.isArray(value) ? value.map((v) => String(v || "").trim()).filter((v) => v.length > 0) : [];
}

/** @param {unknown} value */
export function readSenderCandidateIndex(value) {
  if (value == null) return null;
  if (Number.isInteger(value)) return /** @type {number} */ (value);
  const parsed = parseInt(String(value).trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** @param {unknown} err */
export function serializeReceiverError(err) {
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
export function isPlayInterruptedError(err) {
  const msg = String((err && /** @type {{ message?: string }} */ (err).message) || err || "");
  return (
    msg.indexOf("interrupted by a call to pause") >= 0 ||
    msg.indexOf("interrupted by a new load") >= 0 ||
    msg.indexOf("The play() request was interrupted") >= 0
  );
}

/** @param {unknown} value */
export function summarizeHeaders(value) {
  const h = asObject(value);
  const keys = Object.keys(h);
  return { count: keys.length, keys };
}
