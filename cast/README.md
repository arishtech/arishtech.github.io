# PreetTV Custom Cast Receiver (Phase Scaffold + Phase 2 Hardening + Phase 2.1 Backend Reference)

This folder contains a minimal Custom Web Receiver app for Google Cast.

## Files

- `index.html` - CAF v3, pinned Hls.js / dash.js / mpegts.js, `<video id="castVideo">`, status line, **Logs** bottom dock (toggle)
- `receiver.js` - LOAD interceptor, URL candidates, Hls.js / dash.js / mpegts.js / CAF native paths, network policy
- `receiver.legacy.full.js` - previous monolithic receiver (backup / diff reference)

## Debugging on the TV

- A **status line** is always shown at the bottom (loading, errors, “Playing …”).
- Tap **Logs** to toggle the **bottom log dock** only. Enabling **Cast logs** in the Android app turns on verbose capture on the receiver; the dock **stays closed** until you open it (no auto-open from sender debug flags). For QA you can still append **`?dock=1`** or **`?logdock=1`** to the receiver URL to open the dock on load.
- While the dock is open, new log lines **auto-scroll only if you were already at the bottom**; if you scroll up to read history, scroll position is **preserved** when the buffer refreshes.
- Verbose `network.policy.applied` lines only appear when `?debug=1` (or `receiver-debug` on `<body>`).
- If **mpegts.js** never reaches playback (common with strict CDNs / blocked `User-Agent` in fetch), the receiver now **times out after ~55s** and **caps watchdog boot defers** (~6×22s) so it can fall back to **CAF native TS** or the **next candidate URL** instead of looping forever.
- The receiver also reads `customData.streamUrl` if CAF omits `media.contentUrl` / `contentId`.

## What It Supports

- sender-provided `customData.candidateUrls`
- IPTV URL fallback patterns:
  - `extension=ts` -> `extension=m3u8`
  - `extension=m3u8` -> `extension=ts`
  - `/live.php` without extension -> adds `extension=m3u8` and `extension=ts`

## Phase 2 Contract (`customData`)

Sender now emits `schemaVersion=2` plus these optional contract objects:

```json
{
  "schemaVersion": 2,
  "streamUrl": "https://...",
  "candidateUrls": ["..."],
  "candidateIndex": 0,
  "channelName": "Channel",
  "auth": {
    "strategy": "none|bearer",
    "tokenHeaderName": "Authorization",
    "bearerToken": "",
    "headers": { "X-Custom": "value" }
  },
  "token": {
    "passthroughQueryKeys": ["token", "play_token"],
    "queryValues": { "token": "override-value" }
  },
  "proxy": {
    "enabled": false,
    "baseUrl": "https://proxy.example.com/stream",
    "manifestBaseUrl": "",
    "segmentBaseUrl": "",
    "licenseBaseUrl": "",
    "originalUrlParam": "url",
    "addChannelName": true
  },
  "networkPolicy": {
    "allowedHeaderNames": ["authorization", "x-custom"],
    "blockedHeaderNames": ["cookie"]
  }
}
```

### Receiver hook behavior

`receiver.js` applies this policy in CAF `PlaybackConfig` handlers:

- `manifestRequestHandler`
- `segmentRequestHandler`
- `licenseRequestHandler`

Per request, receiver can:

1. rewrite URL via proxy policy (`proxy.*`)
2. apply token query overrides (`token.queryValues`)
3. merge allowlisted headers (`auth.headers`)
4. inject bearer token when `auth.strategy = bearer`
5. remove denylisted headers (`networkPolicy.blockedHeaderNames`)

## Backend Proxy Hook Points

When `proxy.enabled=true`, receiver rewrites stream URLs to your backend endpoint and passes original target URL in query param (default `url`).

Suggested backend routes:

- `GET /stream?url=<encoded>` for manifest/segment passthrough
- `POST /license?url=<encoded>` for DRM license forwarding

Suggested backend responsibilities:

- short-lived token refresh/signing
- provider header/cookie injection
- request throttling/rate limiting
- domain allowlisting for SSRF protection
- access logging and abuse protection

## Deploy Steps

1. Host this folder on HTTPS (Firebase Hosting, Netlify, Cloudflare Pages, etc.).
2. In Google Cast SDK Console, create a **Custom Receiver** app.
3. Set receiver URL to your hosted `index.html`.
4. Copy the generated Receiver App ID.
5. In Android sender app, set `app/src/main/res/values/strings.xml`:

```xml
<string name="cast_receiver_app_id">YOUR_RECEIVER_APP_ID</string>
```

6. Build and run the Android app.

## Phase 2.1 – Backend Proxy Reference

See **[BACKEND_PROXY_REFERENCE.md](./BACKEND_PROXY_REFERENCE.md)** for the full
server-team guide, including:

- Exact `GET /stream` and `POST /license` request / response shapes
- Token refresh loop design and Redis token-store schema
- HMAC header-signing contract
- SSRF domain allow-list implementation
- Minimal Express.js skeleton your server team can fork immediately
- Receiver `customData` wiring quick-reference
- Deployment checklist

## Notes

- `CC1AD845` remains the default fallback app ID in sender config.
- Receiver hardening hooks are no-op unless contract fields are provided.
- For production protected streams (headers/cookies/token refresh), enable `proxy` and move secret handling to backend.

## Receiver Debug Mode (Verbose)

You can enable verbose debug logs on receiver in two ways:

1. Query string on receiver URL:

`https://your-host/cast/index.html?debug=1`

2. Sender `customData.debug.verbose = true`

When enabled, receiver logs detailed events such as:

- `load.received`
- `load.candidates`
- `network.policy.applied`
- `player.error`
- `candidate.retry` / `candidate.exhausted`

Remote inspect the receiver via Chrome:

- `chrome://inspect/#devices`
- Select your Cast device and inspect receiver target.

Debug history is also exposed as `window.__preettvDebug` in receiver DevTools console.




