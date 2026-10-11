# Continue with ChatGPT: local personal integration

## Current verification status

Campaign Compass implements the documented local-personal ChatGPT plan flow. Authorization, token/session logic and inference are tested with synthetic mocks, including real JWT signature validation and a temporary Windows DPAPI fixture. **No real sign-in, account eligibility or live model response has been verified by these tests.** Until the user signs in and selects a model, the app remains in deterministic demo mode.

The local runtime uses `jose` for JWT validation and `proper-lockfile` for interprocess serialization. The official `@siwc/local` package was not available from npm when this integration was built; its repository marks it private. No DevKit source, assets or credentials were copied. This is an original implementation of the public protocol.

## User-operated setup

1. On Windows with Node.js 22+, run `npm ci --ignore-scripts`, then `npm start`.
2. Open **http://127.0.0.1:4173/** in your normal browser. Keep the server running.
3. Open **ChatGPT connection**, choose a new connection or an existing registration, and personally click **Continue with ChatGPT**.
4. Review the account/workspace and requested permissions on OpenAI's website. Approve only if you want this local app to use your ChatGPT plan. Do not send passwords, codes or tokens in chat.
5. After returning to the app, acknowledge the first-use explanation, review **Manage usage**, select **Load available models**, and choose a listed model.
6. Explicitly request a campaign brief. A completed and grounded answer is labelled **ChatGPT model**; errors, rejected claims and timeouts produce **deterministic fallback** or an explicit error. Neither sign-in nor a model listing establishes inference eligibility.

The app does not purchase credits, create API keys or switch billing paths. Usage follows the account/app limits and any existing-credit settings chosen in ChatGPT. The app displays returned token counts for the last completed request, but does not invent a plan balance or reset time. Review limits at [ChatGPT Settings → Usage](https://chatgpt.com/settings/usage).

The implementation is for a locally running personal project. It is not an authorized remotely hosted shared inference service. The code is MIT licensed; eligibility for the OpenAI service and its terms remain separate.

## Storage and browser boundary

On Windows, app-owned connection records live under `%LOCALAPPDATA%/CampaignCompass/ChatGPT`, outside the checkout and submission bundle. Credentials are encrypted with Windows DPAPI for the current OS user, stored in an owner-only directory, and replaced atomically. Writes and rotating refreshes use an interprocess lock. Only the user-operated sign-in action creates the host record. Opening the dashboard or checking disconnected status does not create a grant or credential record.

No existing Codex/ChatGPT credential files or environment tokens are imported. Access, refresh and retained ID tokens never appear in browser JavaScript, browser storage, logs, source or artifacts. ID-token hints, when retained, are sent only in a native server redirect to OpenAI's authorization endpoint. The browser receives a separate HttpOnly, SameSite=Lax application-session cookie; because the required callback is HTTP loopback, this local-only cookie does not use the HTTPS Secure attribute. Session IDs and CSRF values rotate after OAuth completion. The server accepts loopback Host headers only and checks origin/fetch metadata and CSRF for account-changing operations and connected inference.

Other operating systems can use demo mode; secure sign-in currently fails closed there. No insecure plaintext-storage fallback is provided. Credentials belong to this app and the current Windows user, not to other OS users or remotely hosted sessions.

Each account registration retains its own issued client ID and verified issuer/subject, even for identical email addresses. Each browser session must complete its own OAuth flow before it can use a saved registration. Merely knowing a profile ID does not grant inference access. Verified registrations can be switched within that browser session; switching or closing the copilot cancels pending work.

## OAuth and lifecycle protections

New registration uses `dynamic_agent_client`, the stable installation UUID host identifier, and `Campaign Compass` as the app-name hint. Each attempt creates fresh state, nonce and PKCE S256 values. State is browser-session-bound, expires after ten minutes and is consumed once. The callback is exactly `http://127.0.0.1:<port>/auth/callback`. The issued client ID is retained before exchange, so an expired code does not discard registration. Returning sign-in reuses the issued client ID; changed client IDs or verified identities are rejected.

The ID token must pass JWKS signature, issuer, audience, expiry, subject and nonce checks. Plan requests require granted `resource.invoke` and `chatgpt.tokens.use.direct` scopes. The requested scope set is exactly the documented identity, renewable-session and plan-use set. A valid identity without plan permission stays visible but cannot invoke a model.

Refreshes use the selected registration's client ID and rotating refresh token. A received replacement is encrypted and staged before asynchronous identity verification, preventing loss of a rotation during a transient verification failure. Terminal refresh errors clear unusable tokens and require sign-in; transient failures preserve them. Disconnect stops requests, attempts session revocation with bounded retry, and clears local tokens while retaining registration/host identity. If remote revocation cannot be confirmed, the app explicitly directs the user to disconnect in ChatGPT Settings.

## Inference contract and limits

The selected account's model choices come from `GET https://api.openai.com/v1/models`. Inference uses only `POST https://api.openai.com/v1/responses`, with bearer OAuth authorization, `store:false`, `stream:true`, an input array and `instructions`. No undocumented ChatGPT backend endpoint, unsupported generation fields, tools, automatic retries or alternate billing are used.

The server accepts a result only after `response.completed`, then parses and validates the complete JSON evidence object. Partial, failed or interrupted streams are rejected. Output and stream size are bounded. Every claim must match the authoritative server metric registry and SHA-256 dataset/filter snapshot. The browser independently verifies that identity and exact metric values before rendering. Filter edits, a new question, dialog closure, account/model changes and disconnect invalidate or abort outstanding work.

Only one inference request per account registration may run at a time. Each brief has a 30-second deadline. Usage-limit and unentitled-account errors pause further model requests; they do not cause an OAuth loop or billing fallback. Resuming after a usage limit requires an explicit user action. Other failures show a labelled deterministic fallback when the question is supported by demo mode. The app never executes ad spend.

## Official implementation references

Documentation was checked on October 11, 2026; account-specific availability is still unverified.

- [Overview and availability](https://developers.openai.com/siwc/token-sharing-open-source)
- [Quickstart](https://developers.openai.com/siwc/quickstart)
- [Local app cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)
- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)
- [Usage and UI guidance](https://developers.openai.com/siwc/ui-ux-guidelines)

## Native sign-in navigation fix

The user reported `cross_origin` after clicking Continue with ChatGPT. A real native Chrome form reproduced the failure before OAuth: the dashboard's previous `Referrer-Policy: no-referrer` made the POST carry the literal `Origin: null`. The strict origin check correctly rejected it. The earlier browser lifecycle test posted through an API helper with a supplied Origin header and therefore missed native navigation behavior.

The dashboard document now uses `Referrer-Policy: same-origin`, which preserves its exact origin for the local form. OAuth start/callback responses and API responses retain `no-referrer`. The Origin, Host, port and CSRF checks are unchanged; opaque, foreign and mismatched-port requests still fail. Provider top-level GET callbacks may have no Origin and remain protected by browser-bound, single-use state, nonce/PKCE, verified identity and the exact redirect URI used for code exchange.

After updating an already-open app, reload the dashboard at `http://127.0.0.1:4173/` before retrying the button so the document receives the corrected policy. Do not reload or share an OAuth callback URL. Sign-in still requires the user's own consent.

The current regression suite clicks the actual button and follows a mock provider on a second loopback address. It covers the original failure, valid return without Origin, no referrer leakage on redirects, invalid CSRF, same-tab/popup behavior, opaque/cross-site/different-port attacks and forged callbacks. HTTP tests additionally verify an absent Origin on the start navigation, exact host/port rejection, forwarding-header resistance and preservation of a valid pending flow after rejected requests. No live eligibility or inference is implied.

The relevant browser behavior is specified in [Fetch: append an Origin header](https://fetch.spec.whatwg.org/#append-a-request-origin-header).
