# CampaignCompass — Week 3 Guided Discovery MVP

Build a fictional Luma Trail walking and cycling collection from one brief: sourced trail evidence, two product sheets, a collection overview, LinkedIn, email, blog and ad drafts, critique/revision, human approval and local export. The animated Under the Hood inspector shows recorded execution events, provenance and explicit live/offline labels; accessible text and reduced-motion views are supported.

## Run locally

Requires Node.js 22.13+ and npm.

```sh
git clone --branch week3-guided-discovery-submission https://github.com/Acumencia/campaign-compass-ai.git
cd campaign-compass-ai
npm ci --ignore-scripts
npm start
```

Open http://127.0.0.1:4173/campaign.html and choose **Offline templates**. No provider key or payment is needed. To exercise mocked specialist/revision flows, run `node scripts/campaign-mock-review-server.mjs` and open http://127.0.0.1:4185/campaign.html. These are canned replies with zero provider calls.

```sh
npm run check
npm run trails:validate
```

The sanitized source snapshot passed **389 offline tests** plus its build checks. These checks do not establish live provider execution. On Windows with restricted temporary-directory access, set `TEMP` and `TMP` to an existing local `.tmp` directory before running tests.

## Verified live-assisted QA and limitations

An isolated QA run reused the existing Pinecone vector-only brand retrieval path and real Anthropic generation/review. The latest QA bundle passed fresh model review, version-bound test approval and local export after two model revision proposals and explicitly labelled testing-assistant editorial corrections across all seven outputs. This was **live-assisted QA, not fully autonomous campaign production**; test approval did not publish or approve a real commercial campaign.

Recorded QA comprised 25 Anthropic calls, with $1.520772 token-derived known model cost and $5.631048 full model reservations. Retrieval used 24 provider requests, including two vector queries, two reported read units and 28 embedding tokens, with $0.240000 retrieval reservations. Combined reservations were $5.871048 within the separately authorized $10 total repair/verification cap. Usage estimates and reservations are not provider invoices. Ordinary campaigns retain their $2 default budget.

The distributed source includes no credentials, startup credential pointers, private ledgers or temporary QA permissions. Live access requires separately configured approved integrations, explicit request consent and spending authorization. Main-app persistent Pinecone startup access was not granted; verified QA used scoped transient access. A fresh clone does not inherit access to the private index. Offline templates and mocks remain available without those integrations.

Corpus: **25 curated factual trail dossiers** (23 eligible for fictional concepts), **28 synthetic brand documents / 119 existing brand chunks/vectors**, and **zero trail vectors**. The target is 1,000 distinct curated US routes, not a completed dataset or a popularity ranking. Official source provenance is retained; brand documents, factual routes and fictional commercial offers remain distinct. Prices, availability and commercial permissions are not represented as real. No representative-user or scale benchmark is claimed.

## Documentation

- [MVP launch and architecture](docs/week3-mvp.md)
- [Vector RAG repair and verification](docs/week3-vector-rag-repair.md)
- [MCP evidence tools](docs/mcp-evidence.md)

This branch contains the sanitized source snapshot. It omits private live evidence, credential configuration, machine-specific rehearsal/recording scripts and submission documents/video. The generic privacy scan can flag clearly labelled synthetic test credentials; such fixture matches require review and are not evidence of real secrets. No repository visibility change, deployment, campaign publication or merge is part of this source release.
