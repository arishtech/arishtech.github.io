# PreetTV Custom Cast Receiver

Google Cast **Custom Web Receiver** (CAF v3) for PreetTV: IPTV-friendly URL repair, multi-candidate fallbacks, Hls.js / dash.js / mpegts.js with CAF native escape hatches, and a Phase 2 `customData` contract aligned with the Android sender.

## CAF bootstrap (reference: `cast-receiver-main`)

The Eyevinn-style minimal receiver (`cast-receiver-main`) starts CAF with **`useShakaForHls: true`** so the **native HLS path uses Shaka** instead of the older default stack ([Shaka migration](https://developers.google.com/cast/docs/web_receiver/shaka_migration)). PreetTV adopts the same flag in `receiver/app.js` while keeping this project’s custom `<video>`, LOAD interceptor, and Hls.js / mpegts fallbacks.

We do **not** mirror `<cast-media-player>` from that template: this receiver needs a plain `<video id="castVideo">` for custom players and UI. Optional extras there (build-time `CAST_RECEIVER_OPTIONS`, Parcel, Docker) are optional for self-hosted builds only.

## Source layout (modular) + what Cast actually loads

Logic lives in **`receiver/*.js`** (ES modules for maintainability). **Chromecast and many static hosts do not reliably load nested ES modules** (404 / MIME / path issues), so **`index.html` loads a single classic script: `receiver.js`**.

After you change any file under `receiver/`, regenerate **`receiver.js`** in one of these ways:

### Option A — GitHub Actions (no Python on your PC)

If this repo is on GitHub, use the workflow **“Bundle Cast receiver”** (`.github/workflows/cast-receiver-bundle.yml`):

1. Push your edits under `cast-receiver/receiver/*.js` (or change `cast-receiver/tools/bundle_receiver.py`).
2. Actions runs on GitHub’s servers, runs the bundler, and **commits an updated `cast-receiver/receiver.js`** when it differs.
3. GitHub Pages serves the new bundle on the next site build.

You can also open **Actions → Bundle Cast receiver → Run workflow** to rebuild without changing sources.

**Repo setting:** *Settings → Actions → General → Workflow permissions* → **Read and write** so the workflow can push (some orgs restrict this).

### Option B — Local Python

From the **repository root**:

```bash
python cast-receiver/tools/bundle_receiver.py
```

Or from `cast-receiver/`:

```bash
python tools/bundle_receiver.py
```

That overwrites **`receiver.js`** next to `index.html`. **Deploy or commit both** `index.html` and `receiver.js` for GitHub Pages.

| Module | Role |
|--------|------|
| `receiver/app.js` | Cast vs browser test mode, `context.start()`, pipeline |
| `receiver/state.js` | Session state (candidates, players, flags) |
| `receiver/constants.js` | Timeouts, UA list, stub URL |
| `receiver/util.js` | `asObject`, serialization, flags |
| `receiver/logger.js` | `window.__preettvDebug`, verbose from sender / `?debug=` |
| `receiver/dom.js` | Status, loader, volume bridge, safe CAF listeners |
| `receiver/contract.js` | `normalizeContract(customData)` |
| `receiver/url.js` | URL repair, candidates, strategy |
| `receiver/network.js` | `PlaybackConfig`, proxy, token rewrite, mpegts fetch shim |
| `receiver/players.js` | Hls.js / dash.js / mpegts, stub loads, CAF native fallbacks |
| `receiver/pipeline.js` | CAF `LOAD` / `ERROR`, watchdog, candidate advance |

Legacy reference: `receiver.legacy.full.js`.

## Files

- `index.html` — CAF + libs + UI + **`receiver.js`** (bundled)
- `receiver.js` — **generated**; do not hand-edit (use `tools/bundle_receiver.py`)
- `receiver/*.js` — module sources
- `tools/bundle_receiver.py` — concat/strip `import`/`export` into one IIFE

## Debugging on the TV

- A **status line** is always shown at the bottom (loading, errors, “Playing …”). If you see a **“Receiver failed to run…”** message, `receiver.js` did not execute (missing on server, parse error, or blocked).
- Tap **Logs** for the bottom dock. Cast debug from the app does not open the dock by default. Optional: **`?dock=1`** on the receiver URL.
- Verbose `network.policy.applied` needs `?debug=1` or sender debug flags.

## Phase 2 `customData`

Same contract as before (`schemaVersion`, `candidateUrls`, `auth`, `token`, `proxy`, `networkPolicy`, `playback`, `streamBootstrap`, etc.). See `BACKEND_PROXY_REFERENCE.md`.

## Deploy (including GitHub Pages)

1. Ensure **`cast-receiver/receiver.js`** is current (Option A or B above). For **github.io**, use **Option A** after each change to `receiver/*.js`, or commit an already-generated `receiver.js` from any machine that can run the script once.
2. Cast SDK Console → Custom Receiver → URL = your hosted `index.html`.
3. Confirm `https://<user>.github.io/.../receiver.js` returns **200** and is served as JavaScript.

## Notes

- `window.__preetCastReceiverBooted` is set when the bundled script finishes; the HTML uses it to surface load failures.
- **STREAM_VOLUME_CHANGED** may be missing on some CAF builds; **`SET_VOLUME`** interceptor still applies.
