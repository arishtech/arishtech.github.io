# PreetTV Custom Cast Receiver

Google Cast **Custom Web Receiver** (CAF v3) for PreetTV: IPTV-friendly URL handling, multi-candidate fallbacks, optional **Hls.js**, **dash.js**, and **mpegts.js** stacks (chosen at runtime from sender `customData` plus URL/MIME hints), and a `customData` contract aligned with the Android sender.

## What Chromecast loads

[`index.html`](index.html) loads, in order:

1. **Hls.js** — parses **`.m3u8` / HLS** manifests and feeds MSE (there is no separate “M3U8 library”; M3U8 is the HLS playlist format).
2. **dash.js** — **DASH / `.mpd`** playback when that engine is selected.
3. **mpegts.js** — **MPEG-TS** transmux when TS playback is selected.
4. **CAF v3** (`cast_receiver_framework.js`).
5. **[`receiver.js`](receiver.js)** — single classic script (no ES module graph on device).

If you remove Hls.js or dash.js from `index.html`, the corresponding branches in `receiver.js` will not run (those globals will be missing). **mpegts-only** is enough only if you never route to HLS or DASH in `choosePlaybackEngine`.

## CAF bootstrap

The receiver starts CAF with **`useShakaForHls: true`** so the **native HLS path uses Shaka** instead of the older default stack ([Shaka migration](https://developers.google.com/cast/docs/web_receiver/shaka_migration)). Custom engines (Hls.js / dash.js / mpegts.js) attach to `#castVideo` when the LOAD interceptor selects them.

We keep a plain **`<video id="castVideo">`** for those custom players; `<cast-media-player>` stays present for CAF but is not the primary surface for every format.

## On-screen UI (TV)

- **Branding header** (top): **title** “Preet Live Streaming Player” (`#castBrandTitle`, bold in `index.html`) and **subtitle** current channel (`#castChannelSubtitle`), filled from LOAD `customData.channelName` or media metadata title (`setReceiverChannelSubtitle` in `receiver.js`). To put the **channel** as the larger line instead, swap the order of those two `<div>`s in `index.html` and move the static string onto the element you want as the product name.
- **Loader** — full-screen overlay from LOAD until `#castVideo` fires `playing` / `canplaythrough`, or on errors (see `setReceiverLoaderVisible` in `receiver.js`).

## Buffering (live stability)

The receiver uses **larger forward buffers** than typical defaults to reduce stalls and frame drops on Chromecast (at the cost of more delay behind the live edge):

- **CAF / Shaka** (native HLS/DASH when Shaka/MPL is used): `PlaybackConfig.shakaConfig.streaming` — `bufferingGoal`, `rebufferingGoal`, `bufferBehind` (see `PREET_SHAKA_STREAMING_BUFFER` in `receiver.js`). Also `autoResumeDuration` / `autoPauseDuration` hints for non-Shaka paths.
- **mpegts.js**: larger `stashInitialSize` and relaxed `liveBufferLatency*` / `liveSync*` (see `PREET_MPEGTS_BUFFER_CONFIG`).
- **Hls.js**: `maxBufferLength` / `maxMaxBufferLength` / timeouts (see `PREET_HLS_BUFFER_CONFIG`).
- **dash.js**: `updateSettings` streaming targets (see `PREET_DASH_STREAMING_SETTINGS`).

Tune those constants in **`receiver.js`** if you need even more buffer or lower latency.

## Source layout

| File | Role |
|------|------|
| `index.html` | Styles, **loader / top branding (title + channel subtitle)**, debug log, CDN libs, CAF SDK, **`receiver.js`** |
| `receiver.js` | All receiver logic — **edit this file** for behavior changes |
| `test-browser.html` | Optional local HLS/native smoke test (not used by Cast) |

There is **no** Python bundler or `receiver/*.js` module tree in this repo; deploy **`index.html` + `receiver.js`** together.

## Phase 2 `customData`

Same contract as the app (`schemaVersion`, `candidateUrls`, `auth`, `token`, `proxy`, `networkPolicy`, `playback`, `streamBootstrap`, etc.). See `BACKEND_PROXY_REFERENCE.md` at repo root if present.

## Deploy (including GitHub Pages)

1. Commit **`cast-receiver/index.html`** and **`cast-receiver/receiver.js`** after edits.
2. Cast SDK Console → Custom Receiver → URL = your hosted `index.html`.
3. Confirm `https://<host>/.../receiver.js` returns **200** as JavaScript.

## Debugging on the TV

- The **on-screen log** (`#debug`) follows the app **Cast debug** switch (Settings): when off, the sender omits `customData.debug` / `castDebugEnabled` and the panel stays hidden (lines still go to the **browser console**).
- **Receiver URL only:** `?log=1`, `?receiverLog=1`, `?castDebug=1`, or `?dock=1` forces the panel on; `=0` / `false` / `off` forces it off (overrides sender for that session).

## Notes

- **Android sender volume:** With a Cast session connected, the right-edge swipe uses `CastManager.setVolume` (`RemoteMediaClient.setStreamVolume` + `CastSession.setVolume`) so the receiver’s playback level updates, not only the phone’s `STREAM_MUSIC` volume.
- `window.__preetCastReceiverBooted` may be set when the script finishes; HTML can use it to surface load failures if wired.
- **STREAM_VOLUME_CHANGED** may be missing on some CAF builds; volume interceptors still target `#castVideo` where applicable.
