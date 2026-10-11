# Server inference contract, version 1

## Status

The original provider-neutral contract now has a server-side ChatGPT adapter and browser transport. **No real account sign-in or live inference has been validated yet.** The app remains in deterministic demo mode until the user personally completes the official local-personal consent flow and selects a listed model. Static builds contain no server API and retain demo mode.

The local server selects the adapter from a verified browser session, never from arbitrary client provider configuration. `server/chatgpt*.mjs` implements OAuth, protected storage and streaming inference; `src/chatgpt-client.mjs` implements dataset-bound browser transport. See [local ChatGPT sign-in](chatgpt-local-sign-in.md) for the separate account/session boundary and user steps.

## HTTP boundary

The server binds to `127.0.0.1`. POST JSON to the same application origin. It rejects cross-origin requests, unexpected Host headers, unsupported fields and bodies over 8192 bytes (including chunked bodies). Questions must be nonempty strings of at most 500 characters. Responses disable caching. There is no CORS permission and no execution endpoint.

First obtain a server-computed identity:

```http
POST /api/snapshot
Content-Type: application/json

{"filters":{"start":"2026-09-14","end":"2026-10-11","channel":"All","audience":"All","goal":"All"}}
```

The response contains `version: 1`, `contextId`, `snapshotId`, `evidence` (dataset label, filters, row count) and `mode`. Mode is `demo` without an injected adapter, or `adapter_configured` when trusted host code injected one. A verified browser session can configure the ChatGPT adapter, while tests may inject a mock. Configured does not mean live-verified. Connected requests require the browser session cookie and its `X-CC-CSRF` value from `/api/chatgpt/session`; demo requests do not use plan access.

Then POST `/api/brief` with exactly `filters`, `question`, `contextId` and `snapshotId`, copying the identifiers from that response. The server reloads its authoritative CSV, calculates metrics, and checks the identity before any inference. It never accepts client-supplied metrics, prompts, endpoints or model configuration. The SHA-256 snapshot binds all dataset rows and every filter; the compact UI context label alone is not sufficient. Object key order in the filter request does not alter identity.

The server checks the dataset again before returning an answer. An old identity or a revision during inference returns HTTP 409 `stale_snapshot`. No obsolete evidence is returned. Empty slices return HTTP 422 `empty_snapshot` without invoking an adapter.

## Adapter boundary

Tests or trusted server bootstrap code may supply `createServer({invoke, timeoutMs})`. `invoke` has this provider-neutral signature:

```text
async invoke(request, {signal}) -> structured JavaScript object

request = {system, question, contextId, snapshotId, facts}
response = {contextId, snapshotId, intent, claims, recommendationId}
claims = [{metricId, value}]
```

`system` is the exact exported `PROVIDER_PROMPT` in `server/inference.mjs`. `facts` is a private deeply frozen copy of server-computed facts, including IDs, labels, values and units. Raw campaign rows are not sent to the adapter. Questions remain untrusted data. A provider-specific adapter must parse its response into an object, bound response size and forward the `AbortSignal` to its upstream request. The host must verify this behavior with the actual authorized provider before calling the product live AI.

Only four intents and three recommendation IDs are allowed, as enumerated in the prompt. Each of 1-8 unique claims must reference a known metric, preserve its exact finite numeric value, and have no extra fields. Undefined ratios are not evidence. Both identities must match. Prose, causal explanations, action instructions, unknown fields, duplicate evidence and invented values are rejected. The client may render only trusted local prose and validated facts, never arbitrary provider output.

Successful output has the common identity/evidence envelope plus `mode` and `answer`. `answer` contains the validated `contextId`, `intent`, `claims` and `recommendationId`; `snapshotId` remains in the envelope.

| Outcome | HTTP | Envelope or error |
|---|---|---|
| No adapter; supported demo question | 200 | `mode: demo` |
| Injected adapter; validated answer | 200 | `mode: model` (mocks exercise this branch; no live verification is implied) |
| Adapter times out, fails or returns invalid evidence | 200 | `mode: fallback`, explicit deterministic notice, reason `timeout`, `provider_unavailable` or `invalid_response` |
| Failed adapter and question unsupported by demo | 422 | `fallback_unavailable`; no answer |
| No adapter and question unsupported by demo | 422 | `unsupported_question`; no answer |
| Dataset or filters no longer match identity | 409 | `stale_snapshot`; no answer |
| Invalid request or filters | 400 | Sanitized error code/message |
| Internal dataset/service failure | 500 | Generic message; no internal diagnostics |

## Cancellation and client responsibilities

The standalone `runInference` default is eight seconds; the application server uses 30 seconds. Trusted host code can set 1-30000 milliseconds. Timeout aborts the adapter signal and returns labelled fallback. A disconnected HTTP client aborts the adapter signal and produces no fallback response. A direct `runInference` caller can provide a signal; cancellation rejects with code `cancelled` and status 499. A disconnected HTTP client cannot receive that status.

Timers and listeners are cleaned up. Late resolutions cannot replace a timeout result. As with any JavaScript wrapper, the server cannot forcibly stop an injected function that ignores its signal; a real adapter must cancel upstream work and avoid uncontrolled retries.

The UI client aborts pending calls when filters change, the dialog closes or a newer question supersedes the old one. It compares returned identities against the captured request and current filter state before rendering, and distinguishes demo, model and fallback. Concurrent server requests keep independent snapshots, even when they finish out of order. The browser also computes the SHA-256 dataset/filter identity independently before accepting the authoritative snapshot. Account/model changes cancel pending requests.

## Test evidence and publication scope

`tests/inference.test.mjs` tests structured output, exact numbers, immutable facts, snapshot changes, invalid/missing/duplicate fields, malformed output, null ratios, sanitized failure, timeout, late resolution, cancellation and listener cleanup. `tests/inference-http.test.mjs` exercises the actual loopback HTTP boundary with mocks, including tampering, chunked size limits, cross-origin/Host guards, disconnects, out-of-order replies and data revisions during a request.

No test makes a real provider request. The connection implementation adds `jose` and `proper-lockfile` runtime dependencies. Tests cover mock OAuth, signed JWTs, refresh rotation, token isolation, usage errors, stream completion, browser cancellation and Windows encrypted storage with synthetic fixtures. Passing mocks does not verify account eligibility or live output.
