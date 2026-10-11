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
