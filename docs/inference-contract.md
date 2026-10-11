# Server inference contract, version 1

## Status

This is provider-neutral groundwork, tested with mocked adapters only. **No live model is configured, called or validated.** `npm start` has no adapter and the visible dashboard continues to use its clearly labelled local deterministic copilot. The server endpoints below are ready for a future authorized integration; the UI is not yet wired to them. Static builds contain no server API.

The missing integration is an authorized inference service plus a small server-side adapter and client wiring. No provider, endpoint, model, credential format or payment arrangement is assumed. No credentials are read by this code. The adapter must not be configured from HTTP input or browser JavaScript.

## HTTP boundary

The server binds to `127.0.0.1`. POST JSON to the same application origin. It rejects cross-origin requests, unexpected Host headers, unsupported fields and bodies over 8192 bytes (including chunked bodies). Questions must be nonempty strings of at most 500 characters. Responses disable caching. There is no CORS permission and no execution endpoint.

First obtain a server-computed identity:

```http
POST /api/snapshot
Content-Type: application/json

{"filters":{"start":"2026-09-14","end":"2026-10-11","channel":"All","audience":"All","goal":"All"}}
```

The response contains `version: 1`, `contextId`, `snapshotId`, `evidence` (dataset label, filters, row count) and `mode`. Mode is `demo` without an injected adapter, or `adapter_configured` when trusted host code injected one. Configured does not mean live-verified.

Then POST `/api/brief` with exactly `filters`, `question`, `contextId` and `snapshotId`, copying the identifiers from that response. The server reloads its authoritative CSV, calculates metrics, and checks the identity before any inference. It never accepts client-supplied metrics, prompts, endpoints or model configuration. The SHA-256 snapshot binds all dataset rows and every filter; the compact UI context label alone is not sufficient. Object key order in the filter request does not alter identity.

The server checks the dataset again before returning an answer. An old identity or a revision during inference returns HTTP 409 `stale_snapshot`. No obsolete evidence is returned. Empty slices return HTTP 422 `empty_snapshot` without invoking an adapter.

## Adapter boundary

Trusted server bootstrap code may eventually supply `createServer({invoke, timeoutMs})`. `invoke` has this provider-neutral signature:

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

The default adapter deadline is eight seconds; trusted host code can set 1-30000 milliseconds. Timeout aborts the adapter signal and returns labelled fallback. A disconnected HTTP client aborts the adapter signal and produces no fallback response. A direct `runInference` caller can provide a signal; cancellation rejects with code `cancelled` and status 499. A disconnected HTTP client cannot receive that status.

Timers and listeners are cleaned up. Late resolutions cannot replace a timeout result. As with any JavaScript wrapper, the server cannot forcibly stop an injected function that ignores its signal; a real adapter must cancel upstream work and avoid uncontrolled retries.

A future UI client must abort pending calls when filters change, the dialog closes or a newer question supersedes the old one. It must compare returned identities against the captured request and the current filter state before rendering, and clearly distinguish demo, model and fallback. Concurrent server requests keep independent snapshots, even when they finish out of order. The current local UI already discards superseded demo answers; live transport wiring remains pending.

## Test evidence and publication scope

`tests/inference.test.mjs` tests structured output, exact numbers, immutable facts, snapshot changes, invalid/missing/duplicate fields, malformed output, null ratios, sanitized failure, timeout, late resolution, cancellation and listener cleanup. `tests/inference-http.test.mjs` exercises the actual loopback HTTP boundary with mocks, including tampering, chunked size limits, cross-origin/Host guards, disconnects, out-of-order replies and data revisions during a request.

No test makes a provider request. There is no runtime dependency added. This work changes the server groundwork and shared validation, without switching the visible product out of demo mode.
