# Antigravity OAuth — Implementation Tasks

Tracking checklist for the Google Cloud Code Assist browser OAuth provider feature.

---

## Core Auth

- [x] `lib/auth/pkce.js` — PKCE code verifier + S256 challenge generation
- [x] `lib/auth/pkce.js` — `generateState()` for CSRF protection
- [x] `lib/auth/antigravityOAuth.js` — `buildAuthUrl()` with correct scopes and PKCE params
- [x] `lib/auth/antigravityOAuth.js` — `exchangeCodeForTokens()` — PKCE code exchange
- [x] `lib/auth/antigravityOAuth.js` — `getValidAccessToken()` — auto-refresh when expired
- [x] `lib/auth/antigravityOAuth.js` — `fetchUserEmail()` — Google userinfo endpoint
- [x] `lib/auth/antigravityOAuth.js` — `fetchProjectId()` — Cloud Code Assist project discovery
- [x] `lib/auth/antigravityOAuth.js` — `fetchAntigravityModels()` — list available Gemini models
- [x] `lib/auth/antigravityOAuth.js` — `openBrowser()` — cross-platform browser launcher
- [x] `lib/auth/antigravityOAuth.js` — `getRedirectUri()` — derives callback URL from server port

## Config & Storage

- [x] `lib/config.js` — `getOAuthCredential(config, provider)` helper
- [x] `lib/config.js` — `setOAuthCredential(config, provider, cred)` helper
- [x] `lib/config.js` — `deleteOAuthCredential(config, provider)` helper
- [x] Credential persisted to `~/.modelrelay.json` under `oauth.antigravity`

## Provider Registration

- [x] `sources.js` — Added `antigravity` provider entry
- [x] `lib/providerLinks.js` — Added Antigravity product URL

## Server Routes

- [x] `GET /auth/antigravity/start` — Generate PKCE + state, open browser, redirect caller
- [x] `GET /auth/antigravity/callback` — Exchange code for tokens, persist, enable provider, refresh models
- [x] `GET /auth/antigravity/status` — Return login state (loggedIn, email, projectId, expired)
- [x] `POST /auth/antigravity/logout` — Clear credential, disable provider, clear dynamic models

## Proxy Integration

- [x] `resolveProviderAuthToken` — OAuth credential resolution with silent token refresh
- [x] `refreshAntigravityModels` — Fetch live models after login; skips silently if not logged in
- [x] Wired into startup model refresh sequence
- [x] Wired into periodic refresh scheduler
- [x] Wired into `triggerImmediateProviderPing` dispatch
- [x] `buildOAuthResultPage` — HTML success/failure page shown after callback

## CLI Onboarding

- [x] `lib/onboard.js` — Antigravity skips API key prompt, shows OAuth URL instead

## Web Dashboard UI

- [x] Antigravity provider card rendered with Sign in with Google button (proper Google SVG logo)
- [x] Status pill (`⏳ Checking…` → `✅ Logged in as ...` → `⚠️ Not logged in`)
- [x] Logout button (shown only when logged in)
- [x] Ping interval field preserved
- [x] Model count + refresh button preserved
- [x] `updateAntigravityStatusPill()` — fetches `/auth/antigravity/status` and updates pill
- [x] `pollAntigravityStatus()` — polls every 2s for up to 3 minutes after clicking Sign In
- [x] `antigravityLogout()` — POST to logout route, reload settings

## Tests

- [x] PKCE verifier length and charset
- [x] PKCE base64url challenge format
- [x] PKCE uniqueness per call
- [x] `generateState` returns non-empty hex, unique per call
- [x] `getOAuthCredential` returns null when missing
- [x] `setOAuthCredential` stores under `oauth[provider]`
- [x] `getOAuthCredential` returns stored value
- [x] `deleteOAuthCredential` removes entry
- [x] `setOAuthCredential` overwrites existing
- [x] Multiple provider independence
- [x] `sources['antigravity']` exists and has correct shape
- [x] All 147 tests pass

## Dependencies

- [x] Zero new npm dependencies (uses `node:crypto`, `node:child_process`, `fetch` only)
