/**
 * PreetTV Cast receiver — entry (ES modules).
 * Depends on: cast_receiver_framework.js, Hls, dashjs, mpegts (globals from index.html).
 */
import { state } from "./state.js";
import { debugLog } from "./logger.js";
import { bindMediaElementToPlayer, installVolumeBridge, setBrandingVisible, setStatus, getCastVideoEl } from "./dom.js";
import { createPlaybackConfig } from "./network.js";
import { installCastPipeline, registerUnhandledRejection } from "./pipeline.js";
import {
  isBrowserTestMode,
  getStreamUrlFromPage,
  buildCompatibilityCandidates,
  normalizeCandidateUrl,
  isDashCandidate,
  isHlsCandidate,
  isTsCandidate,
} from "./url.js";
import {
  destroyHls,
  destroyDash,
  destroyMpegts,
  buildMpegtsPlayerConfig,
  buildHlsJsConfig,
  hlsIsAvailable,
  mpegtsIsAvailable,
} from "./players.js";

const castGlobal = window.cast;
const hasCastFramework = !!(castGlobal && castGlobal.framework && castGlobal.framework.CastReceiverContext);
const context = hasCastFramework ? castGlobal.framework.CastReceiverContext.getInstance() : null;
const playerManager = context ? context.getPlayerManager() : null;

const browserTestMode = isBrowserTestMode();
state.useCastReceiver = !!(hasCastFramework && playerManager && context && !browserTestMode);
state.context = context;
state.playerManager = playerManager;

bindMediaElementToPlayer();
registerUnhandledRejection();

if (state.useCastReceiver) {
  installCastPipeline();
  // Same idea as minimal receivers (e.g. cast-receiver-main): Shaka for HLS improves CAF native HLS.
  // https://developers.google.com/cast/docs/web_receiver/shaka_migration
  context.start({
    useShakaForHls: true,
    playbackConfig: createPlaybackConfig(),
  });
  installVolumeBridge();
  setBrandingVisible(true);
  setStatus("PreetTV receiver started");
  debugLog("receiver.started", {
    href: window.location.href,
    hlsJs: typeof Hls !== "undefined",
    dashjs: typeof dashjs !== "undefined",
    mpegts: typeof mpegts !== "undefined",
  });
} else {
  initBrowserPlayback();
}
window.__preetCastReceiverBooted = true;

function initBrowserPlayback() {
  const castVideoEl = getCastVideoEl();

  function browserLoadCandidate(candidateUrl) {
    if (!candidateUrl || !castVideoEl) return;
    destroyHls();
    destroyDash();
    destroyMpegts();
    castVideoEl.removeAttribute("src");
    castVideoEl.load();

    if (isDashCandidate(candidateUrl)) {
      state.dashInstance = dashjs.MediaPlayer().create();
      state.dashInstance.attachView(castVideoEl);
      state.dashInstance.attachSource(candidateUrl);
      state.dashInstance.play();
      setStatus("Browser: DASH");
      return;
    }
    if (isHlsCandidate(candidateUrl) && hlsIsAvailable()) {
      state.hlsInstance = new Hls(buildHlsJsConfig());
      state.hlsInstance.attachMedia(castVideoEl);
      state.hlsInstance.loadSource(candidateUrl);
      state.hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        castVideoEl.play().catch(() => {});
      });
      setStatus("Browser: HLS");
      return;
    }
    if (isTsCandidate(candidateUrl) && mpegtsIsAvailable()) {
      state.mpegtsInstance = mpegts.createPlayer(
        { type: "mpegts", isLive: true, url: candidateUrl, hasAudio: true, hasVideo: true },
        buildMpegtsPlayerConfig()
      );
      state.mpegtsInstance.attachMediaElement(castVideoEl);
      state.mpegtsInstance.load();
      state.mpegtsInstance.play().catch(() => {});
      setStatus("Browser: MPEG-TS");
      return;
    }
    castVideoEl.src = candidateUrl;
    castVideoEl.play().catch(() => {});
    setStatus("Browser: progressive");
  }

  function browserLoadUrl(url) {
    if (!url) return;
    const bcCandidates = buildCompatibilityCandidates(url, {}).map((c) => normalizeCandidateUrl(c));
    browserLoadCandidate(bcCandidates[0] || url);
  }

  window.__bcLoadUrl = browserLoadUrl;
  window.__bcStop = function () {
    destroyHls();
    destroyDash();
    destroyMpegts();
    if (castVideoEl) {
      castVideoEl.removeAttribute("src");
      castVideoEl.load();
    }
    setStatus("Stopped");
  };
  window.__getStreamUrlFromPage = getStreamUrlFromPage;

  window.bcLoad = function () {
    const input = document.getElementById("bcStreamUrl");
    const v = input && input.value ? input.value.trim() : "";
    if (v) browserLoadUrl(v);
  };
  window.bcStop = function () {
    window.__bcStop();
  };

  try {
    const u = getStreamUrlFromPage();
    if (u) browserLoadUrl(u);
  } catch (_e) {}
}
