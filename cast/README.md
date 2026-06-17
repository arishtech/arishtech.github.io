# PreetTV Custom Cast Receiver

Google Cast **Custom Web Receiver** (CAF v3) for PreetTV: IPTV-friendly URL repair, multi-candidate fallbacks, Hls.js / dash.js / mpegts.js with CAF native escape hatches, and a Phase 2 `customData` contract aligned with the Android sender.

## Architecture (modular)

The receiver is implemented as **ES modules** (single logical app, split for clarity). Entry point: `receiver/app.js` (loaded from `index.html` as `<script type="module">`).

| Module | Role |
|--------|------|
| `receiver/app.js` | Detects Cast vs browser test mode, starts CAF context, wires pipeline |
| `receiver/state.js` | Mutable session model (candidates, players, flags) — explicit instead of scattered globals |
| `receiver/constants.js` | Timeouts, UA list, stub URL |
| `receiver/util.js` | Pure helpers (`asObject`, serialization, flags) |
| `receiver/logger.js` | Ring buffer `window.__preettvDebug`, verbose policy from sender / `?debug=` |
| `receiver/dom.js` | Status line, loader, volume bridge, safe CAF event subscription |
| `receiver/contract.js` | `normalizeContract(customData)` for Phase 2 fields |
| `receiver/url.js` | URL repair / normalization, compatibility candidates, playback strategy |
| `receiver/network.js` | `PlaybackConfig` handlers, proxy + token query rewrite, IPTV fetch shim for mpegts |
| `receiver/players.js` | Hls.js / dash.js / mpegts attach, stub loads, native CAF reload fallbacks |
| `receiver/pipeline.js` | CAF `LOAD` + `ERROR` interceptors, stall watchdog, candidate advance |

Legacy monolithic reference (not loaded by default): `receiver.legacy.full.js`.

## Files

- `index.html` — CAF v3 + Hls.js / dash.js / mpegts.js, `<video id="castVideo">`, UI shell, inline log dock renderer
- `receiver/*.js` — modular receiver (see table above)

## Debugging on the TV

- A **status line** is always shown at the bottom (loading, errors, “Playing …”).
- Tap **Logs** to toggle the **bottom log dock**. Enabling **Cast logs** in the Android app enables verbose capture; the dock **stays closed** until opened. Optional: **`?dock=1`** or **`?logdock=1`** on the receiver URL opens the dock on load.
- With the dock open, logs **auto-scroll only near the bottom**; scrolling up **preserves position** on refresh.
- Verbose `network.policy.applied` lines require `?debug=1` or `receiver-debug` on `<body>` / sender debug flags.

## Phase 2 `customData`

Same contract as documented previously (`schemaVersion`, `candidateUrls`, `auth`, `token`, `proxy`, `networkPolicy`, `playback`, `streamBootstrap`, etc.). See `BACKEND_PROXY_REFERENCE.md` for proxy backend shapes.

## Deploy

1. Host this folder over **HTTPS** (correct `Content-Type` for `.js` — required for `type="module"` imports).
2. Cast SDK Console → Custom Receiver → URL = your `index.html`.
3. Set `cast_receiver_app_id` in the Android app to the new receiver app ID.

## Notes

- **Proxy URL resolution**: `resolveFetchUrl` applies the string-based `applyProxyRewrite` path (fixes a class of bugs where an object was mistakenly passed as the URL).
- **STREAM_VOLUME_CHANGED** may be missing on some CAF builds; volume still follows **`SET_VOLUME`** via the message interceptor.
- `CC1AD845` may remain as a default sender app id in other configs; this folder only documents the custom receiver.
