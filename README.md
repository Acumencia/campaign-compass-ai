> Status update — October 19, 2026: the approved live evaluation and AI-assisted semantic review are complete. Earlier live-pending statements below are historical. See [verified outcomes](submission/week2-documentation.md) and evidence/live-evaluation-reviewed-2026-10-19.json. Two baseline validation errors remain ungradable. The current demo uses explicitly labelled offline fixtures; the earlier live evaluation is retained with its limitations.

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

`npm run build` produces ten static assets in `dist/`. Serve that folder with a static HTTP server; opening `index.html` as a `file://` URL will not load modules and CSV reliably. Static previews support deterministic demo mode only; API settings require the local Node server. No deployment was requested or configured. The development server binds to loopback and serves only explicitly allowlisted app files.

## What you can do

- **Overview:** total spend, attributed revenue, conversions and ad ROI; separate, aligned spend/conversion charts; channel return; anomaly evidence.
- **Platform comparison:** Facebook, Instagram, Pinterest and Twitter compared on weighted aggregate metrics.
- **Campaign details:** searchable campaign table with spend, clicks, conversions, ROAS and ad ROI.
- **Time series:** switch between daily spend, conversions, clicks and revenue; expandable accessible data table.
- **Shared filters:** inclusive dates, channel, audience and campaign goal update every view and the assistant. Search affects only the campaign table and is labelled accordingly.
- **Decision lab:** a constant-CPA budget simulation, with review required before exporting a proposal. Nothing executes advertising spend.
- **Glossary:** 21 searchable definitions, formulas and examples for CPA, ROAS, Ad ROI, CTR, attribution and the other terms used in the app.

## AI capability: honest scope

The app starts with API requests off. Open **API settings** for one provider selector and three steps: save a provider key, select a documented model (or custom ID), then explicitly allow billed requests. OpenAI Responses and Anthropic Messages have separate adapters and credentials. The ChatGPT login UI has been removed. [Setup, privacy and model suggestions](docs/api-key-setup.md).

**Live evaluation evidence is recorded in the Week 2 documentation.** Automated development checks use temporary synthetic keys and mocked vendor responses. Model dropdown suggestions are documentation-verified, not account-verified availability. No real credentials were read or migrated during this work.

The copilot supports campaign briefs, channel comparisons, efficiency questions and anomaly explanations. The model selects from server-computed facts; trusted local text renders the answer. Every displayed number references an exact metric ID and filter context. Unknown IDs, changed values, malformed output, arbitrary prose and stale dataset snapshots are rejected. Failure produces explicitly labelled deterministic fallback when the question is supported. Filter changes, new questions, account/model changes and closing the copilot cancel pending work. See [the inference contract](docs/inference-contract.md).

User-operated key saves go to ignored, protected, plaintext local key.json; only blank key.example.json is distributable. Model saves affect the current server run and leave request permission off. No setup step calls a vendor. API-only sessions cannot fall back to delegated plan inference.

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

Current verification is recorded in `evidence/api-only-test-results.txt` and `evidence/api-only-browser-qa.json`. Run `npm run check` and `npm run test:browser:api-only`. The browser suite starts isolated temporary servers and uses synthetic keys, mocked responses and installed Chrome. It covers both complete setup/request/error flows, switching, refresh, restart and missing-catalog/custom-ID fallback. Previous sign-in tests and demo recordings are historical evidence, not the current API-only UI. No live inference is claimed.

## License

The original project code is licensed under the [MIT License](LICENSE), applied with the owner's explicit approval. Dependencies and third-party services retain their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md).

## Week2 Knowledge foundation (local, no model connection)

Run `npm run knowledge:ingest`, then `npm start` and open **Knowledge**. The corpus contains 28 explicitly synthetic documents and 119 chunks with provenance, versions and historical hard negatives. Lexical search works offline. The UI provides embedding setup/consent, explicit live indexing and evaluation, and a same-question lexical / LLM-only / cited-RAG comparison. Claude or OpenAI can generate. Retrieval storage is explicitly Local or Pinecone: local/external-vector paths use OpenAI embeddings; supported Pinecone integrated indexes embed text themselves. [Pinecone setup and supported index types](docs/pinecone-setup.md).

Run `npm run knowledge:eval` for the 30-question lexical/provenance report, separating the unchanged original 15 from the expanded 15. Live vector quality and semantic answer review remain pending; mocked integration tests do not establish them. See [setup, limits, evaluation and demo](docs/week2-knowledge.md) and [runtime contracts](docs/rag-providers.md).

## API setup

Run `npm start`, then open **API settings**. Choose OpenAI or Anthropic, save a key if needed, choose a model, and explicitly allow billed requests. Keys and explicitly saved nonsecret settings survive restart; request permission remains off. Embeddings are configured separately for RAG and never gate campaign generation. See [the current guide](docs/api-key-setup.md).

## Pinecone retrieval

Knowledge → Live RAG setup and billing now includes backend selection, a masked Pinecone key field, existing index configuration, a separate connection check, upload/search permission and explicit corpus upload. Saving settings or refreshing does not call Pinecone. No index is created/deleted, and every upload uses a fresh corpus/configuration-specific namespace. Claude/OpenAI generation and the local index path remain available.

See [the setup guide](docs/pinecone-setup.md) for exact supported modes, disclosure, version checks and user steps. Run `npm run test:browser:pinecone` for isolated mock-only browser checks. No live Pinecone account access, upload or retrieval quality is claimed by these tests. Existing lexical evaluation artifacts remain unchanged.

## Practical RAG follow-up

Knowledge now supplements semantic results with bounded keyword matches and adds clearly labeled linked historical context for version comparisons. Device-fit clarifications request physical dimensions. These fixes passed offline checks. A separately approved seven-case live development check completed five cases; K08/K30 still failed citation validation. The original failures remain recorded. See [practical question testing and current limits](submission/week2-documentation.md).

## Dedicated Ask workspace

Choose **Ask** at the top of the navigation for brand/product questions. Select an example (it only fills the question), then choose **Ask**. Accepted answers show quotes and source buttons; selecting a citation opens numbered source text beside the answer, or below it on narrow screens. Quote matching is not semantic proof.

**Answer mode, source filter and comparison** contains offline search, source selection, top-k and the optional LLM-only comparison. Retrieval diagnostics are collapsed below the answer. Comparison can use two generation calls. **Sources & indexing** manages the corpus/index and evaluations; **API settings** manages generation credentials/models/permission. Ask links to both and displays readiness without enabling permissions or making provider calls automatically.

Completed questions, answers, inspected sources and filters survive dashboard navigation within this page session. Editing a question/mode/filter clears stale output. Navigation or cancellation aborts pending requests and suppresses late responses; work already started by a provider may still be billed. Reload does not restore prior answers. Changed corpus versions invalidate retained results.

Verification: `npm run check`; `node scripts/ask-workspace-browser-qa.mjs`; `node scripts/knowledge-coverage-browser-qa.mjs`; `npm run test:browser:rag-fixtures`; `npm run test:browser:pinecone`. Browser QA uses isolated mock fixtures, never live providers. Screenshots in `evidence/ask-workspace-*.png` are explicitly test-only.

Demo note: older screenshots showing the question form inside Knowledge Sources are outdated. The existing submission video remains a labeled replay of retained live evidence, not a walkthrough of this new navigation. No live results were rerun for this interface change.

## Conversational Ask

Ask keeps a visible transcript in the current page session. Follow-ups such as “Is it safe?” can refer to a previously named product; missing intended use is requested locally. Replying “For hiking” carries that product into a fresh retrieval request. Product resolution is conservative and scoped to the teaching corpus; ambiguous products prompt clarification.

Up to four completed exchanges are sent as user/assistant context (eight messages, 800 characters per message, 5,000 encoded bytes total). The latest question and source filter remain authoritative. Prior assistant answers are untrusted context, never evidence: every factual answer retrieves fresh passages and must pass existing citation validation. Resolved follow-up queries go to retrieval/embedding providers; bounded history goes to the generation provider. Comparison's no-fresh-retrieval arm also sees that history, so it may contain previous answers.

New chat clears conversation and displayed sources without changing permissions. Navigation preserves completed turns; reload and corpus changes clear them. Cancelled, failed and offline lexical requests are excluded from model context. Up to twenty turns remain visible, with buttons to reopen accepted answers and sources.

Local clarification retains session/CSRF checks and makes no provider calls. Resolved questions needing evidence retain all billing and freshness gates. No live answer-quality claim is made by fixture tests.


## Rejected-answer diagnostics and feature coverage

Rejected answers now show bounded validation rule/index details and trusted retrieved/supplied source metadata. Rejected answer text never appears or enters history. Broad feature queries use improved generic-word filtering; product source claims and strict citation validation are unchanged. See submission/week2-documentation.md for the current offline tests, recording and limitations.
