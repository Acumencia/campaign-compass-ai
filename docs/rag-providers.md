# RAG runtime and provider contract

See [current setup and evaluation guide](week2-knowledge.md) for UI steps and evidence. Generation supports the existing OpenAI Responses and Anthropic Messages adapters. External embeddings support OpenAI text-embedding-3-small/large. Pinecone legacy integrated-text indexes provide their own embeddings; see [supported Pinecone modes](pinecone-setup.md). No account or provider is silently selected. Real live indexing and semantic quality remain unverified by development tests.

`ragOptions()` receives the session-selected generation provider and independent embedding adapter. Generation permission plus the selected retrieval path's permissions gate RAG and comparison (OpenAI embedding permission for local/external vectors; Pinecone permission for remote retrieval). Indexing needs embedding permission only. `createRagService` supports index building, non-billable readiness checks, RAG and comparison. Default vector storage is ignored local data/knowledge/private/. The HTTP manifest reports provider configuration and index state separately. Configuration does not prove access or a successful live request.

The embedding adapter accepts texts and a document/query purpose, returns model/revision/dimensions plus ordered numeric vectors, and validates counts, sizes and finite norms. The generator receives trusted system instructions and serialized untrusted question/evidence, and returns bounded structured JSON. Claude uses output_config.format; OpenAI uses Responses JSON schema. No tools or arbitrary endpoints are exposed. Both comparison arms use the same adapter instance and output-token cap; no-retrieval receives no source passage.

RAG output is `{corpusVersion,status,message,claims:[{text,citations:[{chunkId,quote}]}]}`. Every answered claim must cite supplied context with a matching quote. Clarification and insufficient-evidence states carry no claims. Strict structure/quote checks do not prove semantic entailment, and all evaluation correctness fields require manual review. No-retrieval output has the same shape but empty citations and is explicitly unverified; it cannot masquerade as grounded output.

HTTP operations use bounded JSON, loopback Host/origin checks, CSRF and no-store headers. Live routes are `/api/knowledge/rag`, `/compare`, `/index`, and `/evaluate`. No paid operation is triggered by status/refresh. Knowledge uses `/api/session`; no ChatGPT login is required. Concurrent Knowledge work is blocked per local session, and cancellation prevents later comparison/evaluation steps. Archived and expired sources are excluded from default lexical/vector retrieval; explicit historical source selection retains their labels.

The preferred setup is the Knowledge UI, which uses runtime model choices directly. Optional CLI commands now load .env consistently:

```
npm run knowledge:ingest
npm run knowledge:eval
npm run knowledge:eval:rag
# Only after the user configures their own keys/models and approves charges:
npm run knowledge:index -- --allow-api-calls
npm run knowledge:eval:rag -- --allow-provider-calls
```

CLI processes cannot inherit in-memory choices from an already-running server. The user must set nonsecret CAMPAIGN_GENERATION_PROVIDER, vendor enabled flag/generation model, CAMPAIGN_EMBEDDING_PROVIDER=openai, CAMPAIGN_OPENAI_ENABLED=1, CAMPAIGN_OPENAI_EMBEDDING_MODEL, and CAMPAIGN_OPENAI_EMBEDDING_DIMENSIONS in their own environment for CLI work. Keys follow existing key.json-over-matching-environment precedence. No secret values belong in commands, screenshots or reports. Offline evaluation does not load key.json or invoke providers. Live evaluation downloads or writes explicit results; no external upload occurs.

Tests use temporary directories and mock HTTP or explicitly marked test adapters. Their scores are not model performance. Evidence filenames distinguish functional tests from saved offline evaluation. No live vector artifact is shipped.

Explicitly saved Pinecone and model settings persist in ignored key.json.settings.json; credentials stay in the separate key store. A restart restores settings with permissions off and requires a new connection check. The selected Pinecone adapter uses API version 2026-07, separate schema checking, fresh namespaces and local receipts. Retrieved IDs, content hashes, corpus versions, source IDs and status are verified against local chunks. Remote text is ignored. Integrated embedding time is included in Pinecone search time. See the Pinecone setup guide for current limitations.
