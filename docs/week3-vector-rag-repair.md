# Week 3 vector-RAG repair

This record describes the current campaign retrieval path and the bounded repair rehearsal. It supersedes older Week 3 statements that campaign brand retrieval is lexical-only or that no live retrieval has been exercised. **The isolated QA rehearsal passed fresh live review, explicit version approval and local export, after local testing-assistant editorial corrections.** The [verification summary](../evidence/rag-repair/verification-summary.json) records the checkpoint and its limitations.

## What changed

Week 2's existing Pinecone integration and indexed brand corpus are retained. The initial Week 3 campaign flow bypassed vector retrieval by obtaining brand matches through the lexical MCP search. Live campaign grounding now uses a generation-free `retrieveOnly` API in [rag.mjs](../server/rag.mjs), exposed through [campaign-retrieval.mjs](../server/campaign-retrieval.mjs). It reuses the configured Week 2 storage and embedding adapters rather than introducing a second vector store or uploading the corpus again.

The live path requires authorized vector retrieval and validates returned chunk IDs, source IDs, text, content hashes, metadata, corpus versions and namespace. Source freshness checks continue through MCP. Empty results, stale sources, missing permissions or an incompatible index stop grounding with an actionable error. They do not substitute lexical results or offline templates. Explicit offline mode remains a separate demonstration with labelled deterministic outputs; the existing Week 2 Ask workflow retains its own retrieval behavior.

## Two distinct evidence layers

| Layer | Current corpus | Retrieval and meaning |
| --- | --- | --- |
| Brand | 28 explicitly synthetic documents, 119 chunks and 119 retained indexed vectors | Vector retrieval supplies brand voice, positioning and claim constraints. These are fictional brand materials, not official trail facts. |
| Trails | 25 factual route dossiers; 23 eligible for fictional concepts; 0 trail vectors | Read-only MCP searches and fetches curated local records with source provenance. The corpus target is 1,000 distinct curated US trails, not a completed collection or popularity ranking. |
| Offers and drafts | Two proposed product sheets, collection overview and four channel outputs | Fictional commercial concepts derived from the brief and evidence. Guiding authorization, e-bike access, prices, dates and availability remain unknown or unset unless independently established. |

The MCP transport is actual JSON-RPC over stdio, pinned to protocol `2025-11-25`; it is not the Pinecone transport. Inspector records distinguish MCP source operations from internal vector retrieval and provider generation/review. See [MCP contract](mcp-evidence.md).

## Reusing the existing index safely

The retained indexed snapshot and current checkout had different corpus versions because raw document hashes differed with LF/CRLF line endings. All 119 complete canonical chunks matched, and all complete document records matched after excluding only their raw-byte `contentHash` field.

A trusted, server-configured indexed-snapshot loader can prove this compatibility before retrieval. The proof checks schema, configuration, every complete chunk in order and every complete document except that raw hash. Changed text, metadata, rights, configuration, missing records or changed chunks reject the mapping. HTTP clients and model output cannot select a snapshot path or expand this scope.

Queries use the **actual retained index corpus version and receipt**, not a forged local version. Only after proof does the adapter map canonical evidence to the local version used by MCP. Both versions and `equivalence: canonical-content-identical` remain explicit in retrieval metadata. The proof and freshness checks repeat around retrieval; no receipt is rewritten, index created or corpus re-ingested. Exact versions are recorded in the verification summary.

## Permissions and data flow

Main application startup remains limited to the approved Anthropic access. This repair rehearsal used a transient, scoped Pinecone permission for QA; it did not establish permanent broader access. Saving configuration is not authorization to query or upload. The retrieval adapter checks current authorization before reading snapshots or performing embeddings/search, and checks again before accepting results. Revocation, cancellation or a changed credential/session context prevents acceptance; already-started provider work may still be billed.

For integrated Pinecone retrieval, the bounded brand query goes to the configured existing index for embedding and search. Canonically validated retrieved evidence is then available to the writing and critic stages. Trail facts remain their separate MCP layer. The repair did not create credentials, ingest new vectors, expand persistent access, publish drafts or deploy the application.

## Current evidence and remaining gate

The recorded rehearsal used `pinecone-integrated-cosine`, queried the existing 119-vector brand index twice, and reports **2 read units and 28 embedding tokens**. Those are measured retrieval usage counters, not an invoice or a complete campaign cost estimate. Other retrieval bookkeeping requests are not additional vector queries.

The run produced seven model drafts, two real revision proposal rounds and successive critics. The testing assistant made explicitly labelled local editorial corrections across all seven artifacts after the critics found unsupported implications or unclear phrasing. Original model versions and accepted proposal histories remain intact. The final live critic returned no findings; source/dependency checks passed; explicit QA confirmation approved version 33; the browser downloaded the exact approved JSON. This is model-assisted, editorially corrected QA, not unattended generation or approval of a real campaign.

Final verification: **389 offline tests passed**, zero failed or skipped; syntax and static build passed. The source snapshot is separately checked in the submission package. Current RAG repair usage: **25 Anthropic calls, $1.520772 token-derived known model cost; $5.631048 model reservations plus $0.24 retrieval reservations = $5.871048 combined conservative reservation**. Pinecone used two searches, two read units and 28 embedding tokens; its invoice is not verified. The user-authorized conditional cap increased from $5 to **$10 total**, preserving all reservations. An audited QA-only call allowance increased 24 to 28 (25 used); local read-only MCP allowance increased 24 to 40 for source freshness checks. Ordinary campaign limits and two automatic revision rounds were unchanged. No new uncertain outcomes occurred; older uncertain charges and prior campaigns remain unchanged.

The replay shows actual MCP source operations, Pinecone grounding, model generation/critic/revision, editorial saves, approval and export. A current screenshot PDF and sanitized sample are included in the refreshed submission package. No video, deployment, GitHub push, publishing or submission was performed. Critic consistency and the amount of manual cleanup remain product limitations; no under-five-minute or representative-user success rate is claimed.

Launch locally with `npm ci`, then `npm start`, and open `http://127.0.0.1:4173/campaign.html`. Select the explicit offline flow for a no-provider demonstration. Live mode requires the existing integrations and their current runtime permissions; missing retrieval access is a blocker, not a reason to silently change retrieval methods.
