# Campaign Compass

An evidence-grounded campaign intelligence dashboard built for the **Mastering Agentic AI — Week 1** project. All advertising records are synthetic. Campaign Compass is a demo title, not a trademark claim.

## Run locally

Requirements: **Node.js 22+**. No API keys, ad accounts, paid services or database are needed.

```sh
git clone https://github.com/Acumencia/campaign-compass-ai.git
cd campaign-compass-ai
npm ci --ignore-scripts
npm start
```

Open **http://127.0.0.1:4173** in your browser. The browser dashboard uses plain JavaScript. The local server uses two small runtime libraries for JWT verification and file locking. To run development checks:

```sh
npm ci --ignore-scripts
npm run check
node scripts/privacy-check.mjs
```

`npm run build` produces nine static assets in `dist/`. Serve that folder with a static HTTP server; opening `index.html` as a `file://` URL will not load modules and CSV reliably. Static previews support deterministic demo mode only; ChatGPT sign-in requires the local Node server on Windows. No deployment was requested or configured. The development server binds to loopback and serves only explicitly allowlisted app files.

## What you can do

- **Overview:** total spend, attributed revenue, conversions and ad ROI; separate, aligned spend/conversion charts; channel return; anomaly evidence.
- **Platform comparison:** Facebook, Instagram, Pinterest and Twitter compared on weighted aggregate metrics.
- **Campaign details:** searchable campaign table with spend, clicks, conversions, ROAS and ad ROI.
- **Time series:** switch between daily spend, conversions, clicks and revenue; expandable accessible data table.
- **Shared filters:** inclusive dates, channel, audience and campaign goal update every view and the assistant. Search affects only the campaign table and is labelled accordingly.
- **Decision lab:** a constant-CPA budget simulation, with review required before exporting a proposal. Nothing executes advertising spend.
- **Glossary:** 21 searchable definitions, formulas and examples for CPA, ROAS, Ad ROI, CTR, attribution and the other terms used in the app.

## AI capability: honest scope

The app starts in **clearly labelled deterministic demo mode**. It now implements the official local-personal **Continue with ChatGPT** flow, a server-side streaming Responses adapter, and browser transport. The user must personally sign in, review consent, load the available models and select a model before making a model request. See [local sign-in instructions and security boundaries](docs/chatgpt-local-sign-in.md).

**Live account eligibility and inference are not yet verified.** OAuth, refresh, model discovery, streaming, usage errors and disconnect have passed synthetic mocked tests. Those tests do not establish real account access. No existing Codex credentials are imported, and no real account grant was created during development.

The copilot supports campaign briefs, channel comparisons, efficiency questions and anomaly explanations. The model selects from server-computed facts; trusted local text renders the answer. Every displayed number references an exact metric ID and filter context. Unknown IDs, changed values, malformed output, arbitrary prose and stale dataset snapshots are rejected. Failure produces explicitly labelled deterministic fallback when the question is supported. Filter changes, new questions, account/model changes and closing the copilot cancel pending work. See [the inference contract](docs/inference-contract.md).

Credentials created through user-operated sign-in are encrypted with Windows DPAPI in this app's private storage outside the checkout. Browser JavaScript never receives OAuth tokens. Other operating systems retain demo mode and fail closed for secure sign-in. Plan/app limits and existing-credit settings remain controlled by the user in ChatGPT; the app never purchases credits or switches billing paths.

The overview insight card remains deterministic even when the copilot is connected. Observational differences are not causal findings. Budget proposals use explicit constant-CPA assumptions and never execute ad spend.

## Dataset and definitions

`data/campaigns.csv` contains **336 daily campaign records**: 28 days (September 14–October 11, 2026), 12 campaigns, four channels, three audiences and three goals. It is generated from scratch with a seeded linear congruential generator (`271828`). The audience and goal are intentionally paired in this small teaching dataset, so some filter combinations are empty and audience/goal effects cannot be separated.

```sh
npm run generate
```

The generator deliberately reduces clicks for one synthetic campaign in the last week, creating an analyzable signal. The UI does not claim it discovered the true real-world cause. There are no customer identifiers, real campaign exports, proprietary prompts, prior project code or external trackers.

| Field/metric | Definition |
|---|---|
| `spend`, `revenue` in CSV | Nonnegative integer USD cents; displayed as USD |
| `impressions`, `clicks`, `conversions` | Nonnegative integer counts; conversions represent synthetic attributed purchases |
| ROAS | Sum(revenue) ÷ sum(ad spend) |
| **Ad ROI** | (Sum(revenue) − sum(ad spend)) ÷ sum(ad spend) × 100% |
| CPA | Sum(ad spend in USD) ÷ sum(conversions) |
| CTR | Sum(clicks) ÷ sum(impressions) × 100% |
| CVR | Sum(conversions) ÷ sum(clicks) × 100% |

Ad ROI is an advertising return measure, **not net business profit**: product, fulfillment, staffing and other non-ad costs are excluded. Attributed revenue is not incremental lift. Ratios are computed from totals, never averaged across daily rows. Undefined ratios are shown as `—`; absent rows produce an explicit empty state.

The anomaly rule compares the latest two observed seven-day windows per campaign. It needs at least 14 records, at least 10 conversions in each window, and a CPA increase above 25%. No flag is not proof of stability. No statistical significance or confidence interval is claimed.

Budget scenarios preserve total period spend, transferring 1–25% of a source channel's budget. Expected conversions use each channel's observed CPA, held constant. Saturation, auction changes, audience overlap and attribution shifts are omitted. The result is arithmetic sensitivity analysis, **not a forecast or causal estimate**.

## Structure

```text
index.html / styles.css      Accessible responsive dashboard shell
src/metrics.mjs              CSV validation, shared filters, metrics and scenarios
src/assistant.mjs            Deterministic intent routing and grounding validation
server/inference.mjs         Server facts, strict claim validation and cancellation
server/chatgpt*.mjs          Official OAuth protocol, encrypted storage and lifecycle
src/chatgpt-client.mjs       Dataset-bound browser API transport
src/connection-ui.mjs        User-operated account/model/usage controls
src/app.mjs                  Views, charts, UI state and proposal review
data/campaigns.csv           Reproducible synthetic dataset
scripts/generate.mjs        Seeded dataset generator
server.mjs                  Loopback assets and authoritative snapshot/brief API
tests/                      Calculation, assistant, HTTP and DOM tests
evidence/                   Actual development log and test output
submission/                 Documentation content, demo script and completion checklist
```

## Verification and remaining limits

Automated checks cover calculations, filter consistency, zero/empty/error states, CSV validation, scenario conservation and review, prompt injection-like input, numeric grounding, stale context rejection, model fallback, HTML escaping and server file isolation. DOM checks use jsdom, which does not verify layout, native keyboard focus or real browser behavior.

The current suite passes **81 automated tests**, including real JWT signature checks, HTTP session/CSRF boundaries and a Windows DPAPI test using temporary synthetic fixtures. Current output is in `evidence/chatgpt-test-results.txt`; earlier logs remain historical evidence. A separate isolated-Chrome run passes **12 dashboard checks** and **eight mocked connection lifecycle checks**. Run:

```sh
npm run test:browser            # requires npm start in another terminal and installed Chrome
npm run test:browser:chatgpt    # starts its own mock-only temporary loopback server
```

The app was inspected in **the user's browser**, including the new disconnected connection dialog and its 390-pixel mobile layout. Escape returned focus correctly. Earlier inspection found and corrected a clipped mobile metric selector; genuine before/after images are retained. These checks are not a complete accessibility audit.

See `evidence/development-log.md` and `submission/recording-notes.md` for capture details. The existing 3:33 video shows the earlier deterministic UI and 32-test milestone, not this later ChatGPT integration. A live demo refresh must follow user consent and successful real inference.

## License

The original project code is licensed under the [MIT License](LICENSE), applied with the owner's explicit approval. Dependencies and third-party services retain their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md).
