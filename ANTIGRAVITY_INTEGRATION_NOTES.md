# Antigravity Provider Integration Notes

This document summarizes the custom implementation details and schema transformations applied to `modelrelay` to seamlessly support the Antigravity provider (Google Cloud Code Assist).

Because the Antigravity provider relies on an internal Cloud Code API structure natively, it is incompatible with the standard OpenAI schema used by `modelrelay` for its APIs and proxy behaviors.

### 1. Pinging & Health Checks
Previously, `pingModel` was sending the generic OpenAI `{ model, messages, max_tokens }` body. The backend responded with HTTP 404s and 400s which mapped the models explicitly to `{ status: 'down' }`. 
*   **Fix (`lib/server.js`)**: Updated the `ping` utility specifically for `ANTIGRAVITY_PROVIDER_KEY` to wrap the health-check prompt inside the expected Cloud Code Assist schema: `project`, `model`, `request.contents`, `requestType: "agent"`.
*   **Fix (`lib/server.js`)**: Corrected the destination `providerUrl` away from the publisher paths directly to the global endpoint: `https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse`.

### 2. Telemetry Tab UI Filter Fixes
Because the Antigravity API keys are managed differently compared to other OpenRouter/Ollama sources, `GET /api/config` assigns them `hasKey: false`. 
When evaluating the `providerConfigs` filtering:
*   **Issue**: On the first `refresh` of models, model relays successfully populated 20 new models but the sidebar Filter Group left the new "Antigravity" checkbox formally unchecked by default (falling outside the previous cache).
*   **Fix (`public/index.html`)**: Added a check in `renderProviderFilterGroup` to verify if a provider is newly generated. If `existingKeys.has(cb.value)` is false, it automatically ticks the label, ensuring the user isn't blind to new models.

### 3. Request Translation Layer (The Proxy Adapter)
When routing chat completions over `POST /v1/chat/completions`:
*   **Issue**: Modelrelay attempts to eagerly pipeline `req.body` directly to downstream providers. Cloud Code rejects the `messages` array payload causing "Bad Request" and "messages: Cannot find field" errors.
*   **Fix (`lib/server.js`)**: Built an interception block that mutates `JSON.stringify(payload)` out to `proxyPayloadRaw`. It correctly reduces alternating OpenAI `assistant`/`user` roles down to `model`/`user` roles, packing the values into `parts: [{text: ""}]` arrays.

### 4. Response Stream Translation & Aggregation
By default, `modelrelay` expects downstream hosts to stream Server-Sent Events (SSE) structured around `choices[0].delta.content`.
*   **Issue**: The Antigravity SSE stream utilizes drastically different property hierarchies (e.g. `data: {"response": {"candidates": [{"content": {"parts": [{"text": "Hello"}]}}]}}`). When these proprietary packets were pipelined straight to the UI, the client parser failed to understand the packets.
*   **Fix (`lib/server.js`)**: We piped `Readable.fromWeb(selectedResponse.body)` into a deeply decoupled Node stream `Transform` (`antigravityFilter`) before emitting to `captureStream` and the client.
    *   If `stream: true`, the transform translates and emits standard `{"choices": [{"delta": {"content": "..."}}]}` SSEs.
    *   If `stream: false`, it buffers the stream memory, suppresses the SSE architecture entirely, intercepts and forcefully overwrites the `content-type` header, and emits a single, large OpenAI completion object.
