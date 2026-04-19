# Antigravity Browser OAuth Provider

Implementation walkthrough for the Google Cloud Code Assist (Antigravity) provider in modelrelay.

---

## Overview

This adds a new **`antigravity`** provider that authenticates via browser-based Google OAuth (Authorization Code + PKCE) to access **Google Cloud Code Assist** — a free Gemini model tier available to Google accounts.

The approach mirrors the authentication used by [`sipeed/picoclaw`](https://github.com/sipeed/picoclaw), translated from Go into Node.js using only built-in APIs (`node:crypto`, `node:child_process`, `fetch`).

---

## Files

### New

| File | Purpose |
|------|---------|
| `lib/auth/pkce.js` | PKCE code verifier/challenge generation and random state token using `node:crypto` |
| `lib/auth/antigravityOAuth.js` | Full OAuth orchestration: build auth URL, exchange code for tokens, refresh tokens, fetch user email, fetch Cloud Code Assist project ID, fetch available models |

### Modified

| File | What Changed |
|------|--------------|
| `sources.js` | Added `antigravity` provider entry |
| `lib/providerLinks.js` | Added Antigravity product URL |
| `lib/config.js` | Added `oauth` config section and `getOAuthCredential`, `setOAuthCredential`, `deleteOAuthCredential` helpers |
| `lib/onboard.js` | Special-cased Antigravity in CLI onboarding to show the OAuth URL instead of prompting for an API key |
| `lib/server.js` | OAuth imports, `ANTIGRAVITY_PROVIDER_KEY` constant, `resolveProviderAuthToken` hook for OAuth tokens with auto-refresh, `refreshAntigravityModels` function wired into the scheduler, 4 new HTTP routes, `buildOAuthResultPage` helper |
| `public/index.html` | Antigravity provider card with "Sign in with Google" button, login status pill, logout button, and JS polling helpers |
| `test/test.js` | 11 new tests: PKCE generation correctness and OAuth credential storage helpers |

---

## OAuth Flow

```
User clicks "Sign in with Google" in the dashboard
    ↓
GET /auth/antigravity/start
    → Generates PKCE (verifier + S256 challenge) and random state
    → Stores state → verifier map in memory (10 min TTL)
    → Opens Google OAuth consent screen in a new browser tab
    → Redirects the caller to Google's auth URL

User grants consent
    ↓
Google redirects to:
GET /auth/antigravity/callback?code=...&state=...
    → Validates the state against the in-memory map
    → Exchanges (code + verifier) for access + refresh tokens
    → Fetches user email from googleapis.com/userinfo
    → Fetches Cloud Code Assist project ID
    → Persists credential to ~/.modelrelay.json under oauth.antigravity
    → Marks provider as enabled in config
    → Triggers immediate model refresh
    → Returns a success page (auto-closes after 4 seconds)

Dashboard polls GET /auth/antigravity/status every 2 seconds
    → Updates the status pill: "✅ Logged in as user@gmail.com"
    → Shows Sign Out button
    → Refreshes the model list via fetchData()
```

---

## Additional Routes

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/auth/antigravity/start` | Initiates the OAuth flow |
| `GET` | `/auth/antigravity/callback` | Google redirect target; exchanges code for tokens |
| `GET` | `/auth/antigravity/status` | Returns current login state for the dashboard to poll |
| `POST` | `/auth/antigravity/logout` | Clears the stored OAuth credential and disables the provider |

---

## Proxy Request Auth

When a request is routed to an Antigravity model:

1. `resolveProviderAuthToken` looks up the stored OAuth credential from config
2. If the access token is expired, `getValidAccessToken` silently refreshes it using the refresh token and saves the updated credential back to disk
3. The valid Bearer token is attached to the upstream request to `cloudcode-pa.googleapis.com`

Token refresh is transparent — no user action required until the refresh token itself expires (typically 6 months of inactivity).

---

## Credential Storage

Credentials are stored in the existing `~/.modelrelay.json` config file under an `oauth` key:

```json
{
  "oauth": {
    "antigravity": {
      "accessToken": "ya29...",
      "refreshToken": "1//...",
      "expiresAt": "2026-04-19T11:00:00.000Z",
      "email": "you@gmail.com",
      "projectId": "cloudcode-pa-project-id"
    }
  }
}
```

---

## Zero New Dependencies

The entire implementation uses only Node.js built-ins:
- `node:crypto` — PKCE and state generation
- `node:child_process` — opens the browser (`open` on macOS, `xdg-open` on Linux, `start` on Windows)
- `fetch` — all HTTP calls to Google OAuth and Cloud Code APIs

No new entries in `package.json`.

---

## Test Results

```
▶ PKCE generation
  ✔ generates a code verifier of correct length and charset
  ✔ generates a base64url code challenge from the verifier
  ✔ generates a different verifier on each call
  ✔ generateState returns a non-empty hex string

▶ OAuth credential storage
  ✔ get returns null when no oauth section exists
  ✔ set stores credential under oauth[provider]
  ✔ get returns stored credential
  ✔ deleteOAuthCredential removes the provider entry
  ✔ set overwrites an existing credential
  ✔ handles multiple providers independently
  ✔ sources includes antigravity provider entry

ℹ tests 147 | suites 32 | pass 147 | fail 0
```
