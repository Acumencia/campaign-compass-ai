# Campaign Compass — contemporaneous development log

## 2026-10-11 — initialization

Actual user brief: “go ahead create a compelling ad-campaign dashboard is AI Native. Create a github public project for it, capture a video recording, and other materials required for the submission.”

The delegated implementation brief requires a new isolated project, synthetic data only, four shared-filter analysis views, grounded AI interactions, budget proposals with human review, tests, public GitHub code, genuine development screenshots, and a real demo under five minutes. Private projects and prior proprietary code are excluded.

Assignment read from its public text export. Path B allows another stack and specifies Facebook, Instagram, Pinterest and Twitter. Required submission artifacts are a Google Doc, demo video, and GitHub code.

Observed setup: Node 24.14.0, npm 11.9.0, Python 3.14.3 and Git 2.55.0 are installed. Normal shell setup failed; authorized elevated shell execution works. No model API configuration was present in the inspected process environment. No model inference connector is exposed. Do not call generated text live AI.

GitHub connector identity is jawabuddha. Organization membership returned an empty list; repository search for the requested slug in Acumencia returned no matches. Repository-creation capability is absent from this connector.

Browser inventory returned no enabled browser surfaces; in-app browser creation reports unavailable. This is a verification blocker to resolve, not evidence of successful browser testing.

Implementation decision: a dependency-free browser UI and Node development server, a deterministic seeded CSV, a pure metric engine and guarded provider boundary. Deterministic demo mode is visible throughout. No advertising account integration or spend execution.

## 2026-10-11 — first implementation

Implemented the required four views, shared date/channel/audience/goal filters, campaign search, separately scaled spend and conversion charts, accessible data tables, synthetic-data disclosures and responsive CSS. Added a deterministic assistant and structured provider boundary. Added a scenario that preserves total spend and requires acknowledgment before a JSON proposal export.

Actual assistant design statement during development: “I’m building a clean, dark ‘campaign control room’ with four connected views and an evidence panel that makes every insight traceable to the active filters. Budget changes will remain reviewable simulations, and the UI will clearly distinguish deterministic assistance from live model output.” This was an implementation decision, not an additional user prompt.

First syntax/build run succeeded but reported zero tests because tests had not yet been written. It is not counted as test verification.

## 2026-10-11 — calculation and interaction checks

The first 21 tests passed: calculations, weighted ratios, reproducible data, shared filters, zero denominators, CSV validation, budget conservation, unsupported claims, stale contexts, deterministic/model mode labelling, fallback and HTTP asset isolation.

Added jsdom as a development-only dependency. Its installation audit reported zero vulnerabilities. Runtime remains dependency-free.

The first expanded run had 28 passes and two failures. The failing tests inspected assistant text while it still read “Checking evidence…”. The provider promise crossed the Node/jsdom realms; a single Promise.resolve() did not settle the complete answer pipeline. Updated the test harness to await the next event-loop turn via setImmediate, without changing the assertion or app answer. All 30 tests then passed. This was a test synchronization issue, not evidence of a previously working browser recording.

Code inspection identified an unbounded future provider invocation. Added an eight-second timeout with labelled deterministic fallback and a real never-resolving-provider regression test using a ten-millisecond test timeout.

DOM checks verify state, labels and HTML escaping. They do not prove layout, contrast, native dialog focus, keyboard operation or mobile overflow. Those real-browser checks remain pending.

## 2026-10-11 — publication route recovered

The existing local Git Credential Manager account successfully authenticated read-only API requests without creating, displaying or saving a token. The API verified active administrator membership in Acumencia and no existing campaign-compass-ai repository. This differs from the narrower connector membership result. Publication will use the existing connection, scoped to the new synthetic demo repository.

## Evidence integrity

No screenshots or video have been fabricated. The browser inventory exposed no enabled surfaces, and both in-app-browser and Chrome-tab requests returned unavailable. Native recording/encoding tools were not installed. The available deliverables at this stage are actual source files, the generator, test output, this contemporaneous log and a walkthrough script. User-browser capture still needs a working browser connection.

## 2026-10-11 — actual browser access and visual iteration

After the user asked “is there anything for me to test and take a look?”, the local preview was started and verified to return HTTP 200. Opening the preview made the in-app browser connection available. The app was inspected in the user's browser, with genuine screenshots captured at the default preview size, a 1440-pixel desktop viewport and a 390-pixel mobile viewport.

Actual mobile inspection found that the time-series metric buttons crowded their heading and the last option clipped at the panel edge. The page-level overflow check did not detect this local clipping. Changed the mobile heading layout to a block and allowed the metric buttons to wrap. Captured the before state (`05-mobile-before-fix.jpg`) and the corrected state (`06-mobile-after-fix.jpg`). This is a real visual defect and repair, not a reconstructed example.

A browser label lookup also revealed that explicit names were more reliable for the filter selects. Added explicit accessible labels matching the visible labels. Verified global filters across platform and campaign views, an empty slice, and the budget review gate. Escape closes the native copilot dialog and returns focus to the launch button. The browser reported no captured console errors or warnings during this inspection.

The user then requested: “Can you create a glossary of terms used (CPA, etc.) accessible from the app?” Added a searchable 21-term glossary in the app navigation, with definitions, formulas, illustrative examples and honest metric limitations. Captured the working glossary in the user's browser. The automated suite now passes 32 tests.

An additional isolated-Chrome Playwright pass verifies desktop/mobile rendering, keyboard navigation, shared filters, search, empty states, review-gated proposal download and simulated dataset failure. Its 12 checks pass. These real-browser checks supplement the earlier jsdom tests.

## 2026-10-11 — recording and repository preparation

Created the new public Acumencia/campaign-compass-ai repository only after verifying ownership and slug availability. No license was selected. No existing repository was overwritten.

Prepared a continuous recording of actual app interactions in isolated Chrome. The first recording launch failed because the installed Playwright package expected a newer encoder revision. Installed the official matching encoder in this task's private tooling directory and retried. The walkthrough uses disclosed Microsoft Zira Desktop synthetic narration; it does not impersonate the user. The final recording result and duration are reported in the handoff and recording metadata.

The first completed recording ran for about 3 minutes 33 seconds. Video QA confirmed actual app frames and an audio track, but found an overly narrow evidence-text column and Windows console character corruption in the displayed test log. Corrected the evidence grid's minimum sizing and explicit UTF-8 handling, then recorded the real app again. Original app screenshots and the mobile before/after evidence were preserved. A Python console print also encountered a Windows encoding error after the UTF-8 test file had been written; final verification avoids printing Unicode test output through that console.

## 2026-10-11 - provider-neutral server groundwork after recording

The originating task asked for independent adapter groundwork while the user's provider choice and authorized inference connection remained pending. The instruction explicitly prohibited provider calls, credential configuration and live-verification claims. No provider was called or selected.

Moved the future adapter boundary from the browser module into a dedicated server module. Added loopback POST snapshot and brief endpoints, authoritative server-side calculations, a SHA-256 identity binding all synthetic data and filters, and a second dataset check before releasing a response. A frozen private evidence registry prevents an adapter from changing the values used to validate its own answer. Unsupported request fields cannot inject a provider, endpoint, prompt or fabricated metrics.

The first expanded run passed 49 tests, including mocked cancellation, timeout, invalid output, stale snapshots, data revisions during inference and sanitized failure. Added two further HTTP cases for chunked body limits and concurrent requests finishing out of order; the complete suite then passed 51 tests. A separate isolated-Chrome run against the updated server on a temporary loopback port passed all 12 browser checks. The common-secret-pattern scan found zero matches and npm audit reported zero vulnerabilities. The temporary verification server was stopped afterward.

The visible dashboard remains in deterministic demo mode and still uses its local provider. The new HTTP API has no configured model adapter. Actual provider integration and UI transport wiring remain pending. The retained video genuinely shows the earlier UI and 32-test milestone; the documentation now distinguishes this historical recording from the newer backend-only work. No replacement screenshots or staged video evidence were created for this iteration.

## 2026-10-11 - official local-personal ChatGPT integration and MIT approval

The originating task relayed the user's choice of the official local-personal Continue with ChatGPT route and, separately, explicit MIT approval. Read the official sign-in, sessions, models/inference, limitations, recovery and UI guidance. Public OIDC discovery was checked read-only. No real OAuth flow, plan request or account-token import was performed.

The referenced @siwc/local package returned npm 404 and its official repository marked the package private. Implemented the public protocol independently using jose for signed JWT verification and proper-lockfile for refresh/write serialization. No DevKit code or brand assets were copied. Added the approved MIT license and third-party notices.

Implemented protected app-owned Windows DPAPI storage, dynamic client/host registration, fresh session-bound state/nonce/PKCE, callback identity checks, per-browser profile approval, rotating refresh preservation, cancellation, usage blocks and revocation. Added the browser API transport and account/model/usage dialog. The existing authoritative metric/snapshot validator remains the output boundary; only computed facts and trusted prose can render.

The first expanded DOM run failed because its old test harness did not load the newly imported transport/UI classes. Updated the harness to load those modules without weakening assertions. The temporary Windows DPAPI fixture then found an inherited PowerShell 7 module-path incompatibility in the Windows PowerShell helper. Restricted that helper to the standard Windows PowerShell module directory; real synthetic-fixture encryption, ACL and concurrent-write checks passed. The complete automated suite now passes 80 tests.

Eight isolated-Chrome checks passed through mock OAuth and inference: read-only disconnected UI, mobile/focus behavior, mock callback/first-use confirmation, listed-model selection, grounded output without token exposure, usage-limit fallback and pause, upstream cancellation, and disconnect. All external browser traffic was blocked; server provider methods were mocks. The original 12 dashboard browser checks also passed against the updated preview.

Restarted only the task-owned preview and inspected the disconnected controls in the user's browser. Captured actual readiness and 390-pixel mobile screenshots. Horizontal containment and Escape focus return passed; no captured browser errors or warnings. Did not click Continue with ChatGPT. Real sign-in and inference require the user's consent; these mock tests and screenshots do not establish eligibility or live AI.

The original 3:33 video remains unchanged and is explicitly labelled as the earlier deterministic UI/32-test milestone. Submission text now distinguishes current integration readiness from that genuine historical recording. No private project content, account tokens or host paths are part of public source or the submission bundle.

The final packaging-path rerun exposed a second Windows environment edge case: Python uppercased PSMODULEPATH, leaving it alongside PSModulePath in a plain child-process environment object. Removed all case variants before setting the protected helper module path and added a regression test. The original direct-PowerShell fixture had passed; this failure was observed only through the Python-launched verifier. Console-only Unicode output also required ASCII-safe status printing; the complete test log remains UTF-8.

## 2026-10-11 - user-reported native sign-in rejection

The user attempted Continue with ChatGPT and reported `cross_origin`. Safe diagnostics confirmed the current published preview, zero saved registrations and no app-owned credential-storage directory. The request was rejected before a completed consent flow; no existing tokens were inspected.

Reproduced the native form in isolated Chrome with a mocked server protocol. Its POST carried literal Origin null, Sec-Fetch-Site same-origin and mode navigate. The global no-referrer document policy caused this browser behavior. The previous browser lifecycle helper supplied Origin manually and did not exercise the real button navigation, a meaningful gap in verification.

Changed only the dashboard document response to same-origin referrer policy; retained no-referrer on OAuth and API responses and preserved every origin/CSRF guard. Added native-navigation regressions and four HTTP tests. The raw Host-header test first used fetch, which did not preserve that override; changed the test transport to node:http so it actually sends the attack header. No production protection was loosened.

An initial navigation harness timed out at its intercepted redirect destination. Broad route interception was not reliable for modeling redirected navigation, so accepted evidence now uses an actual second loopback mock provider and blocks HTTPS. No real consent, token exchange or inference was performed. A browser attempt to omit the POST Origin through interception was also not reliable; the natural provider GET without Origin is covered in the browser, and absent-Origin POST behavior is covered at the HTTP boundary. Final navigation evidence contains no OAuth query, cookie, body or token values.


## 2026-10-11 - provider-page JSON error and independent transport hardening

The next user attempt displayed an HTML-versus-JSON parse error on the official provider's login page. Read-only browser inspection confirmed the provider origin/path and error text, while the local session endpoint returned valid JSON and disconnected state. No provider HTTP status, media type or redirect chain was available from the browser tool. An observed authorization-continue asset is a candidate boundary, not a proven failed request. Did not replay login or capture authentication parameters, screenshots, bodies or credentials.

Rechecked the documented protocol; no parameter/endpoint mismatch was found. Added normal-system-browser recovery guidance, explicitly unverified as a fix for the provider page. Separately replaced the client's unconditional response.json call with bounded content-type/shape checks and redirect rejection, and added safe operation/status/media categories at the server's provider JSON parser. Added six automated cases and five isolated-browser checks for HTML fallback, login-page failure, unexpected redirects, malformed/oversized payloads and stale contracts. Existing credential-preservation coverage now includes invalid_response. No OAuth protections or endpoints changed.

The requested searchable 21-term glossary was reopened and CPA verified in the user's browser in a separate dashboard tab, preserving the provider error page. The glossary and demo features remain available during the unresolved real sign-in issue.
