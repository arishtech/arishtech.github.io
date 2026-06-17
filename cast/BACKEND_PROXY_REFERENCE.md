# Phase 2.1 – Backend Proxy Reference Implementation

This document defines the **exact HTTP contract** between the Cast receiver
(bundled as **`receiver.js`**; sources in `receiver/*.js`, network policy in `receiver/network.js`) and your backend proxy so your server team can wire up token
refresh and header signing without touching the receiver code.

---

## 1. Overview

When `proxy.enabled = true` in `customData`, the receiver rewrites every
manifest, segment, and DRM-license request through your backend instead of
hitting the origin IPTV server directly.  Your backend is then responsible for:

- injecting provider credentials (cookies, tokens, signed headers)
- short-lived token refresh / re-signing
- rate-limiting / domain allow-listing (SSRF protection)
- access logging

---

## 2. Receiver → Backend Request Shape

### 2.1 Manifest / Segment (`GET /stream`)

```
GET /stream?url=<encoded-origin-url>&channel=<channel-name>&<extra-passthrough-params>
Host: your-proxy-backend.example.com
X-PreetTV-Schema: 2.1
X-PreetTV-Request-Type: manifest | segment
X-PreetTV-Channel: <channelName from customData>
Authorization: Bearer <receiver-side bearer token, if auth.strategy=bearer>
```

| Query Param | Required | Description |
|---|---|---|
| `url` | ✅ | URL-encoded original IPTV stream URL |
| `channel` | optional | Value of `customData.channelName` (when `proxy.addChannelName=true`) |
| any `token.queryValues` keys | optional | Additional query params the receiver appends before proxying |

**Example URL the receiver emits:**
```
https://your-proxy-backend.example.com/stream
  ?url=https%3A%2F%2Fiptv-origin.example.com%2Flive.php%3Fid%3D123%26extension%3Dm3u8
  &channel=BBC-One
  &token=abc123
```

### 2.2 DRM License (`POST /license`)

```
POST /license?url=<encoded-license-server-url>&channel=<channel-name>
Host: your-proxy-backend.example.com
Content-Type: application/octet-stream
X-PreetTV-Schema: 2.1
X-PreetTV-Request-Type: license
Authorization: Bearer <bearer token>

<raw Widevine / PlayReady license request body from CAF>
```

| Query Param | Required | Description |
|---|---|---|
| `url` | ✅ | URL-encoded original DRM license server URL |
| `channel` | optional | Channel name for logging/scoping |

---

## 3. Backend → Origin (Provider) Request Shape

Your backend fetches the original URL, enriching it with secrets the receiver
cannot hold.

```
GET <decoded url param>
Host: iptv-origin.example.com
X-Forwarded-For: <client IP if you wish to forward>
Authorization: Bearer <provider token (refreshed server-side)>
X-Custom-Provider-Header: <signed value>
Cookie: provider_session=<session cookie>
```

Your backend MUST:
- decode `url` query param and validate it against a domain allow-list
- refresh / re-sign token if TTL < threshold before forwarding
- strip any internal headers before forwarding to origin (`Host` rewrite)
- stream the response body back without buffering (chunk transfer)

---

## 4. Backend → Receiver Response Shape

### 4.1 Success (manifest or segment)

```
HTTP 200 OK
Content-Type: application/x-mpegURL | video/MP2T | video/mp4 | application/dash+xml
Cache-Control: no-store
X-PreetTV-Token-Refreshed: true | false   (informational)
X-PreetTV-Token-Expires-In: <seconds>     (informational)

<streamed body from origin>
```

### 4.2 Success (DRM license)

```
HTTP 200 OK
Content-Type: application/octet-stream

<raw license response body from DRM server>
```

### 4.3 Token Expired – Receiver Retry Signal

When the origin returns **401 / 403** and your backend cannot refresh the
token, return:

```
HTTP 401 Unauthorized
Content-Type: application/json

{
  "error": "token_expired",
  "retryAfterMs": 0,
  "message": "Token could not be refreshed. Re-send stream with updated customData."
}
```

The receiver will surface this as a playback error and fall through to the next
candidate URL (standard CAF error retry flow).

### 4.4 Proxy Error

```
HTTP 502 Bad Gateway
Content-Type: application/json

{
  "error": "origin_unreachable",
  "originUrl": "<redacted or hashed>",
  "message": "Could not reach origin server"
}
```

---

## 5. Token Refresh Contract (Server-Side)

Your backend should maintain a token store keyed by `channel` (or provider
account). The refresh loop looks like:

```
┌────────────────────────────────────────────────────────────────┐
│  Incoming /stream?url=...&channel=BBC-One                      │
│                                                                │
│  1. Decode + validate URL (domain allow-list)                  │
│  2. Look up token for channel=BBC-One in token store           │
│  3. If token TTL < 60 s → call provider token refresh endpoint │
│       POST https://auth.iptv-provider.com/token/refresh        │
│       { refresh_token: "<stored>", channel: "BBC-One" }        │
│     → store new access_token + expiry                          │
│  4. Inject fresh token into request to origin                  │
│  5. Stream origin response back to Cast receiver               │
└────────────────────────────────────────────────────────────────┘
```

### Token Store Schema (Redis / in-memory)

```json
{
  "channel:BBC-One": {
    "accessToken": "eyJ...",
    "refreshToken": "dGhp...",
    "expiresAt": 1746800000,
    "providerAccountId": "acct_123",
    "lastRefreshed": 1746796400
  }
}
```

---

## 6. Header Signing Contract

If your IPTV provider requires HMAC-signed request headers:

```
X-Signature: HMAC-SHA256(secret, method + "\n" + path + "\n" + timestamp)
X-Timestamp: <unix epoch seconds>
```

Your backend computes and injects these; the receiver sends **no** signing
material itself (keeping secrets server-side only).

---

## 7. SSRF Protection – Domain Allow-List

Validate decoded `url` before forwarding to origin:

```js
// Node.js example
const ALLOWED_ORIGINS = new Set([
  'iptv-provider-1.example.com',
  'streams.provider-2.com',
]);

function isAllowed(rawUrl) {
  try {
    const { hostname } = new URL(rawUrl);
    return ALLOWED_ORIGINS.has(hostname);
  } catch {
    return false;
  }
}
```

Reject with `403 Forbidden` and log if the hostname is not on the allow-list.

---

## 8. Minimal Express.js Reference Skeleton

```js
// proxy-server.js  (Node 18+, Express 4)
import express from 'express';
import { pipeline } from 'node:stream/promises';
import fetch from 'node-fetch'; // or native fetch in Node 18

const app = express();
const ALLOWED_ORIGINS = new Set(['iptv-origin.example.com']);
const TOKEN_STORE = new Map(); // replace with Redis in production

function getToken(channel) {
  const entry = TOKEN_STORE.get(`channel:${channel}`);
  if (!entry) return null;
  const ttl = entry.expiresAt - Math.floor(Date.now() / 1000);
  return { ...entry, ttl };
}

async function refreshTokenIfNeeded(channel) {
  const t = getToken(channel);
  if (t && t.ttl > 60) return t.accessToken;          // still fresh

  // Call provider refresh endpoint
  const res = await fetch('https://auth.iptv-provider.example.com/token/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: t?.refreshToken, channel }),
  });
  if (!res.ok) return t?.accessToken ?? null;          // best-effort

  const json = await res.json();
  TOKEN_STORE.set(`channel:${channel}`, {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? t?.refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + json.expires_in,
    lastRefreshed: Math.floor(Date.now() / 1000),
  });
  return json.access_token;
}

// ── /stream  (manifest + segments) ──────────────────────────────────────────
app.get('/stream', async (req, res) => {
  const { url, channel = 'default', ...rest } = req.query;
  if (!url) return res.status(400).json({ error: 'missing_url' });

  let decoded;
  try { decoded = new URL(decodeURIComponent(url)); }
  catch { return res.status(400).json({ error: 'invalid_url' }); }

  if (!ALLOWED_ORIGINS.has(decoded.hostname))
    return res.status(403).json({ error: 'forbidden_origin', hostname: decoded.hostname });

  // Merge any extra passthrough query params back onto origin URL
  Object.entries(rest).forEach(([k, v]) => decoded.searchParams.set(k, v));

  const token = await refreshTokenIfNeeded(channel);

  const originRes = await fetch(decoded.toString(), {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-PreetTV-Proxy': '2.1',
    },
  });

  if (!originRes.ok && (originRes.status === 401 || originRes.status === 403)) {
    return res.status(401).json({ error: 'token_expired', retryAfterMs: 0 });
  }
  if (!originRes.ok) {
    return res.status(502).json({ error: 'origin_unreachable' });
  }

  res.setHeader('Content-Type', originRes.headers.get('content-type') || 'video/*');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-PreetTV-Token-Refreshed', token ? 'true' : 'false');

  await pipeline(originRes.body, res);
});

// ── /license  (DRM) ─────────────────────────────────────────────────────────
app.post('/license', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const { url, channel = 'default' } = req.query;
  if (!url) return res.status(400).json({ error: 'missing_url' });

  let decoded;
  try { decoded = new URL(decodeURIComponent(url)); }
  catch { return res.status(400).json({ error: 'invalid_url' }); }

  if (!ALLOWED_ORIGINS.has(decoded.hostname))
    return res.status(403).json({ error: 'forbidden_origin' });

  const token = await refreshTokenIfNeeded(channel);

  const licenseRes = await fetch(decoded.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: req.body,
  });

  res.status(licenseRes.status);
  res.setHeader('Content-Type', 'application/octet-stream');
  await pipeline(licenseRes.body, res);
});

app.listen(3000, () => console.log('PreetTV proxy listening on :3000'));
```

---

## 9. Receiver `customData` Wiring (Quick Reference)

Sender sets this in Android `MediaInfo.Builder`:

```json
{
  "schemaVersion": 2,
  "streamUrl": "https://iptv-origin.example.com/live.php?id=123&extension=m3u8",
  "channelName": "BBC-One",
  "proxy": {
    "enabled": true,
    "baseUrl": "https://your-proxy-backend.example.com/stream",
    "manifestBaseUrl": "https://your-proxy-backend.example.com/stream",
    "segmentBaseUrl": "https://your-proxy-backend.example.com/stream",
    "licenseBaseUrl": "https://your-proxy-backend.example.com/license",
    "originalUrlParam": "url",
    "addChannelName": true
  },
  "auth": {
    "strategy": "none"
  },
  "token": {
    "passthroughQueryKeys": ["token"],
    "queryValues": {}
  },
  "networkPolicy": {
    "allowedHeaderNames": [],
    "blockedHeaderNames": ["cookie"]
  }
}
```

> **Note:** Set `auth.strategy = "none"` when token injection is handled
> entirely server-side (recommended). Only use `auth.strategy = "bearer"` if
> you want the receiver to inject a short-lived public token that your backend
> also validates.

---

## 10. Checklist for Server Team

- [ ] Deploy Express skeleton (or equivalent) behind HTTPS
- [ ] Populate `ALLOWED_ORIGINS` with all known provider hostnames
- [ ] Replace `TOKEN_STORE` Map with Redis (TTL-backed keys)
- [ ] Implement real provider token-refresh endpoint call in `refreshTokenIfNeeded`
- [ ] Add HMAC signing in origin request headers if provider requires it
- [ ] Wire `licenseBaseUrl` for DRM streams
- [ ] Set `proxy.baseUrl` in Android sender `customData` to your deployed URL
- [ ] Load-test with concurrent Cast sessions (one token store entry per channel)
- [ ] Enable access logging and alert on sustained 401/502 rates

