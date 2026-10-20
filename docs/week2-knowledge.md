> Status update — October 19, 2026: the approved live evaluation and AI-assisted semantic review are complete. Earlier live-pending statements below are historical. See [verified outcomes](../submission/week2-documentation.md) and evidence/live-evaluation-reviewed-2026-10-19.json. Two validation errors remain ungradable; publication is paused.

# Week 2: auditable synthetic brand RAG

## Scope and evidence

Campaign Compass helps a marketer inspect fictional Luma Trail product, policy, audience and campaign evidence. The corpus contains 28 original synthetic documents and 119 section-aware chunks: active specifications, brand/channel guidance, authored audience scenarios, fictional campaign reports, internal claims policies, offers, and three historical hard negatives. It contains no real customer records, real campaign results, private Acumencia files, or jurisdiction-specific legal requirements. The historical campaign reports are separate from campaigns.csv and must not be joined to dashboard metrics.

Every document records provenance, owner, version, effective date, scope, status and supersession. Product-specific restrictions remain in source text. Ordinary current retrieval excludes superseded/expired documents. Explicit version comparisons can add up to two relevant historical passages linked by supersededBy to an active retrieved source; explicit source filters remain authoritative. The model must retain that historical scope. Effective dates are descriptive metadata, not an automatic clock-driven policy engine. Source-status maintenance is explicit. Rejected-copy examples are negative evidence, not permission to repeat the claims.

## What each mode proves

- Campaign brief: deterministic rules or model selection of exact metric facts. Fixed UI prose makes the model contribution deliberately small. No document retrieval.
- Knowledge lexical: local TF-IDF cosine ranking; excerpts only, no generated answer.
- Knowledge RAG: real provider query embeddings, normalized cosine search against a built index, bounded selected context, generation, citation/quote and version validation. A missing index or provider fails explicitly.
- Knowledge comparison: one question, same selected generation adapter and output-token cap, fresh independent calls. The no-fresh-retrieval arm receives the question, corpus version and bounded conversation history, may honestly abstain, and cannot invent citations. Prior answers may therefore be present in its conversation context. The RAG arm receives retrieved evidence. The lexical arm shows excerpts rather than pretending to answer. Differences in evidence access are intentional; this is not a controlled latency benchmark or a guarantee that RAG wins.

Retrieved passages and actually supplied passages are labeled separately. Answers expose quotes, chunk IDs, source lines, source metadata, corpus version, provider/model and stage timings. Quote matching proves text presence, not entailment. Review every factual claim against its quoted source, product scope and effective version.

## Live setup — user operated

1. Run `npm start`; open API settings. Save your provider keys yourself. Claude generation requires an Anthropic API key/model. For the local/external-vector path, embeddings require an OpenAI API key; save that slot too, then select Claude again. OpenAI generation can use the same OpenAI slot as embeddings. No account or key is created by the app.
2. Select and save a generation model and output cap. In Knowledge → Live RAG setup, choose text-embedding-3-small or text-embedding-3-large and dimensions (small up to 1536; large up to 3072). Save. This makes no provider call and resets consent. Explicitly saved settings survive restart; permissions do not.
3. Allow embedding charges. Check the acknowledgement and click Build live index. This sends the synthetic corpus to OpenAI. Refresh corpus to confirm Index: ready. Index readiness checks the corpus and embedding model/dimensions, not account access.
4. Open API settings and allow billed generation requests for this session. Return to Knowledge. RAG requires both generation and embedding permission. Ask with RAG uses one query embedding and, if evidence passes the threshold, one generation. Comparison adds one no-retrieval generation.
5. For evaluation, check its separate acknowledgement and run the 30-question evaluation (up to 30 embeddings and 30 generations). Download the JSON report. Manually complete correctness, citation support, clarification and abstention review; machine-valid citations are not a quality score.

No connection tests, retries, index builds or paid evaluations run automatically. Cancel interrupts remaining work; already-started requests may still be billed. Repeated concurrent Knowledge actions in one session are rejected. Key/model changes reset consent; restart restores explicitly saved settings with permissions off. A provider permission or billing error must be resolved by the user; no alternative account is selected.

## Ingestion and retrieval choices

`npm run knowledge:ingest` rebuilds a local index from flat regular Markdown/text files. Files are bounded and symlinks rejected. Normalize whitespace while preserving source line spans. Heading-aware chunks use a 180-word maximum and 30-word overlap for long sections; short coherent sections are not padded. SHA-256 hashes bind source content, chunk identity and corpus version. Any content/configuration change requires re-ingestion and a matching vector index. No background watcher is installed.

Vectors are stored locally in ignored data/knowledge/private/vector-index.json, with a bounded embedding cache and atomic replacement. Metadata and checksums must match the current corpus and embedding specification. Explicit dimensions reduce storage if chosen; quality must be evaluated rather than assumed. Default top-k is five per method: vector matches plus up to five local lexical matches, deduplicated, with separate score labels. Version comparisons may add two linked historical passages. The 18,000-character prompt budget remains enforced. The vector cosine threshold 0.2 is uncalibrated. Scores are similarity, not confidence. Archives remain excluded for ordinary questions; version comparisons and explicit historical source filters retain historical labels. Active-source conflicts require abstention; the validator cannot prove that the model handled a semantic conflict correctly.

## Evaluation and recorded limitations

The original K01–K15 questions remain unchanged. K16–K30 add product confusion, source/version conflicts, campaign measurement differences and missing legal/real-world evidence. Both reports separate original15 and expanded15 cohorts. The expanded corpus currently yields lexical expected-evidence recall@5 of 0.9167 on the original ten answerable questions and 0.8030 on eleven answerable expanded questions; 16 of 21 answerable questions retrieve all expected sections. All 119 chunk hashes/source spans pass. These are lexical-only measurements, not vector/model performance.

Failures include K09 (brand/campaign context), K10 (temperature claim restriction), K20 (research desires versus product capability), K21 (incompatible campaign attribution), and K30 (expired code versus active terms). More documents made lexical retrieval harder. Preserve these failures when comparing embeddings, top-k and wording; do not tune on the test set and then call it held-out performance.

Project targets, not measured achievements: at least 90% expected-evidence recall on answerable questions; at least 90% manually supported answered claims; correct clarification/abstention on all designated safety cases; user-visible p95 under 10 seconds if achievable on the selected provider. Record actual results and failures even when targets are missed. Pipeline timings exclude browser-to-local-server overhead; measure that separately for the demo.

`npm run knowledge:eval` and `node scripts/evaluate-rag.mjs` run offline. The saved vector/answer results remain unmeasured until the user runs a live evaluation. The application code has been tested with synthetic keys, hand-authored vectors and mocked provider responses; these are functional tests, not semantic or live-model results.

## Under-five-minute demo

0:00–0:40: show 28 synthetic documents, metadata and current index/model readiness.
0:40–2:10: compare “Can a Dayline pack campaign say it is waterproof?” Show no-retrieval uncertainty honestly, RAG evidence and cited source lines; inspect both product and claims sources if retrieved.
2:10–3:00: ask current capacity versus archived 16-liter Dayline; show status labels and current-source filtering.
3:00–3:40: demonstrate “Is it safe?” and “Who manufactures the Switchback bottle?” Record failures rather than editing them out.
3:40–4:50: show the 30-question report, separate cohorts, retrieval misses, manual citation review and measured timing. Explain what the LLM selects/synthesizes and what deterministic validation guarantees.

Remaining submission work: user-operated live index/evaluation, manual semantic review, Google Doc with build/dataset permissions/prompts/iterations/learnings, recording, and reviewed GitHub/submission links. Source-grounded campaign drafting is not a separate implemented publishing flow. No push, deployment or external upload occurred.

## Practical development checks after the live run

The retained failures prompted bounded local lexical coverage, linked historical comparison context, and device-dimensions clarification. Citation validation was not relaxed. See submission/week2-documentation.md for the concise question-testing results, changes and completed seven-question live spot check. Five outcomes were complete; K08/K30 failed citation validation. No retry or corpus upload occurred. These development cases do not establish unseen model accuracy.
