import { state } from "./state.js";
import { debugLog } from "./logger.js";

const statusEl = () => document.getElementById("status");
const brandEl = () => document.getElementById("preetBrand");
const nowPlayingEl = () => document.getElementById("preetNowPlaying");
const loaderEl = () => document.getElementById("preetLoader");
const loaderTextEl = () => document.getElementById("preetLoaderText");
export const getCastVideoEl = () => document.getElementById("castVideo");

/** @param {string} text */
export function setStatus(text) {
  const el = statusEl();
  if (el) el.textContent = text || "";
}

/** @param {boolean} visible */
export function setBrandingVisible(visible) {
  const el = brandEl();
  if (el) el.style.display = visible ? "block" : "none";
}

/** @param {string} [text] */
export function showLoader(text) {
  const l = loaderEl();
  const t = loaderTextEl();
  if (l) l.classList.remove("hidden");
  if (t) t.textContent = text || "Loading…";
}

export function hideLoader() {
  const l = loaderEl();
  if (l) l.classList.add("hidden");
}

/** @param {string} name */
export function updateCastChannelNameUi(name) {
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
export function applyReceiverVolume(level, muted) {
  const castVideoEl = getCastVideoEl();
  if (!castVideoEl) return;
  const vol = Math.max(0, Math.min(1, Number(level) || 0));
  castVideoEl.volume = muted ? 0 : vol;
  castVideoEl.muted = !!muted;
}

export function installVolumeBridge() {
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
export function safeAddPlayerEventListener(eventType, handler, label) {
  if (!state.playerManager || typeof state.playerManager.addEventListener !== "function") return;
  if (eventType == null || eventType === "") return;
  try {
    state.playerManager.addEventListener(eventType, handler);
  } catch (e) {
    debugLog("player.add_listener.error", { label, message: e && e.message ? e.message : "unknown" });
  }
}

export function bindMediaElementToPlayer() {
  const castVideoEl = getCastVideoEl();
  if (castVideoEl && state.playerManager && state.useCastReceiver && typeof state.playerManager.setMediaElement === "function") {
    state.playerManager.setMediaElement(castVideoEl);
  }
}

export function onPlaybackStartedUi() {
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
