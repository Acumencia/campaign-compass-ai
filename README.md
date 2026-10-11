# Campaign Compass

An evidence-grounded campaign intelligence dashboard built for the **Mastering Agentic AI — Week 1** project. All advertising records are synthetic. Campaign Compass is a demo title, not a trademark claim.

## Run locally

Requirements: **Node.js 22+**. No API keys, ad accounts, paid services or database are needed.

```sh
git clone https://github.com/Acumencia/campaign-compass-ai.git
cd campaign-compass-ai
npm start
```

Open **http://127.0.0.1:4173** in your browser. The app has **zero runtime dependencies**. To run development tests:

```sh
npm ci --ignore-scripts
npm run check
node scripts/privacy-check.mjs
```

`npm run build` produces seven static assets in `dist/`. Serve that folder with a static HTTP server; opening `index.html` as a `file://` URL will not load modules and CSV reliably. No deployment was requested or configured. The development server binds to loopback and serves only explicitly allowlisted app files.

## What you can do

- **Overview:** total spend, attributed revenue, conversions and ad ROI; separate, aligned spend/conversion charts; channel return; anomaly evidence.
- **Platform comparison:** Facebook, Instagram, Pinterest and Twitter compared on weighted aggregate metrics.
- **Campaign details:** searchable campaign table with spend, clicks, conversions, ROAS and ad ROI.
- **Time series:** switch between daily spend, conversions, clicks and revenue; expandable accessible data table.
- **Shared filters:** inclusive dates, channel, audience and campaign goal update every view and the assistant. Search affects only the campaign table and is labelled accordingly.
- **Decision lab:** a constant-CPA budget simulation, with review required before exporting a proposal. Nothing executes advertising spend.
- **Glossary:** 21 searchable definitions, formulas and examples for CPA, ROAS, Ad ROI, CTR, attribution and the other terms used in the app.

## AI capability: honest scope

The current app is an **AI-assisted build and a prototype of a grounded AI workflow**. Its running copilot uses **clearly labelled deterministic demo mode**, intent routing and templates. It is not a live language model and does not perform open-ended reasoning. No authorized model inference connection was available during this build.

The copilot supports campaign briefs, channel comparisons, efficiency questions and anomaly explanations. Every displayed number is computed first, then referenced by a metric ID and filter-context ID. Unsupported questions return an explicit limitation. Filter changes invalidate old answers. Observational differences are not presented as causal findings.

`server/inference.mjs` and the loopback HTTP server provide a provider-neutral inference contract. The server computes metrics from its own CSV, binds answers to a SHA-256 dataset/filter snapshot, and accepts only exact metric claims. Unknown IDs, changed values, malformed output, extra prose and stale contexts fail validation. Timeouts and provider failures produce explicitly labelled deterministic fallback; cancellation aborts the adapter signal. Client input cannot configure providers or replace authoritative facts.

The new contract is tested with mocks only: **live model inference has not been configured or tested**. `npm start` injects no adapter, and the UI intentionally uses only `DeterministicProvider`. An authorized inference service, a server-side provider adapter and UI transport wiring remain pending. See [the full contract and integration boundaries](docs/inference-contract.md). No keys belong in browser code.

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
server/inference.mjs         Provider-neutral server contract and cancellation
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

The current automated suite passes **51 tests**, including mocked server inference and its HTTP boundary; the earlier recorded milestone had 32. Current output is in `evidence/inference-test-results.txt`. The app was also inspected in **the user's browser** at default, 1440-pixel desktop and 390-pixel mobile widths. That inspection found and corrected a clipped mobile metric selector; genuine before/after images are in `evidence/`. Native Escape/focus return, filters, empty states and scenario review were checked. A separate isolated-Chrome Playwright run passes **12 browser checks**, including local proposal download and a dataset-loading error; it was rerun against the updated server (`evidence/inference-browser-qa.json`). Run it with the local server active: `node scripts/browser-qa.mjs` (requires installed Chrome).

See `evidence/development-log.md` and `submission/recording-notes.md` for genuine capture details. These checks are not a complete accessibility audit. Live model inference remains unavailable and unverified.

## License

No software license is granted by this repository. Public visibility does not imply a permissive license. A licensing decision is reserved for the owner.
