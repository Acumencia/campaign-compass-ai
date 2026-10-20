# Pinecone retrieval setup

This implementation adds remote retrieval to the existing Node/browser app. It does not migrate frameworks, replace Claude/OpenAI generation, or alter the saved lexical evaluation. The tests use synthetic keys, mock HTTP and temporary files; real account access, billing, index compatibility and retrieval quality remain unverified.

## Supported modes

| UI mode | Existing Pinecone index | Embedding provider | API |
|---|---|---|---|
| Integrated text | Legacy integrated dense-text index with matching model and text field mapping | Pinecone | records upsert/search |
| External vectors | Legacy dense cosine vector index | OpenAI | vectors/upsert and query |
| External vectors | Document index with a dense_vector field | OpenAI | documents/upsert and documents/search |

Only cosine is supported. The configured dimensions must match exactly. For external vectors, the app also requires the configured model/dimensions to match its OpenAI embedding adapter; a legacy Pinecone vector index alone cannot identify which model generated old vectors. Fresh namespaces prevent reuse of unrelated vectors.

New document-integrated string/embed indexes, sparse/hybrid indexes, non-cosine metrics and private endpoints are unsupported. A schema mismatch fails before uploading. The app does not create an index or change its schema. Do not assume that selecting Integrated means every Pinecone integrated index type is supported.

The adapter follows the official API 2026-07 contracts: [describe index](https://docs.pinecone.io/reference/api/2026-07/control-plane/describe_index), [legacy integrated upsert](https://docs.pinecone.io/reference/api/2026-07/data-plane/upsert_records), [legacy integrated search](https://docs.pinecone.io/reference/api/2026-07/data-plane/search_records), [vector upsert](https://docs.pinecone.io/reference/api/2026-07/data-plane/upsert), [vector query](https://docs.pinecone.io/reference/api/2026-07/data-plane/query), [document upsert](https://docs.pinecone.io/reference/api/2026-07/data-plane/upsert_documents), and [document search](https://docs.pinecone.io/reference/api/2026-07/data-plane/search_documents).

## User-operated steps

1. Start the local server and open API settings. Choose Claude or OpenAI generation, save your generation key/model yourself. Saving does not call the provider. Settings changes reset permissions. Generation model/key changes preserve a compatible Pinecone check; changing its index configuration or key requires checking again.
2. Click **Pinecone credentials** in API settings, or **Pinecone credentials and setup** in Knowledge. Either shortcut opens and focuses the masked key field; it does not switch the saved backend or contact a provider. The controls also remain under Knowledge → Live RAG setup and billing. For External vectors, configure the OpenAI embedding model/dimensions and key. Integrated text does not need an OpenAI embedding key.
3. Select Pinecone and the matching embedding mode. Enter your existing index name, bare public host (no scheme/path), namespace prefix, exact embedding model, dimensions and text field mapping or dense-vector field. Legacy external vector indexes ignore the field entry. Save backend settings.
4. Expand Add or replace Pinecone key. Paste it yourself into the masked field and save. Replacement requires the checkbox. The input clears immediately. The app never imports key_pinecone.json or discovers other credentials.
5. Review the saved destination and click Check Pinecone connection. This explicitly makes authenticated read requests to describe the index, and after an upload, read namespace counts. It does not upload documents. Account permissions/service usage rules still apply. Correct any reported incompatibility rather than choosing another account automatically.
6. Allow Pinecone uploads/search for this session; External vectors also require OpenAI embedding permission. Review the upload acknowledgement and click Upload corpus to Pinecone. Integrated mode sends source text to Pinecone. External mode sends source text to OpenAI, then vectors and provenance metadata to Pinecone. Provider embedding, write and storage charges can apply.
7. After upload, click Check Pinecone connection again. This verifies the indexed count for the uploaded namespace. Until the count matches, readiness remains uploaded_unverified. Pinecone visibility may lag; checking again is an explicit user action, never an automatic retry.
8. Allow generation requests in API settings, then return to Knowledge. Choose RAG or Compare and ask. Query text goes to Pinecone in integrated mode; external mode sends it to OpenAI and the query vector to Pinecone. Retrieved local excerpts go to the selected generation provider. Comparison adds a fresh no-retrieval generation with the same model/token cap. Evaluation requires a separate acknowledgement and runs 30 RAG questions; download its report and manually review answer support.

Keys persist in protected plaintext local key.json. Explicitly saved nonsecret storage/model choices persist in ignored key.json.settings.json. Restart restores them with permissions off and requires Check again to reuse a completed receipt. Pausing permissions does not delete stored remote data. CLI indexing remains the local-vector path; these Pinecone runtime choices belong to the running UI server.

## Isolation, provenance and limits

Every explicit upload gets a random, corpus-version-derived namespace under the supplied prefix. The app checks namespace absence before writing; it never writes to the default or a user-supplied existing namespace. Repeated uploads create additional namespaces and can incur additional charges. No delete, index creation, schema changes or automatic cleanup endpoint is implemented. Unrelated records remain untouched.

Local receipts in ignored data/knowledge/private record the latest namespace, acknowledged chunk count and visibility state for each configuration. Cancelled/failed uploads may leave partial data in Pinecone; the UI shows partial status and namespace. A later upload uses a new namespace, so note the prior namespace before retrying if you intend to clean it up yourself. A cancellation cannot undo work already accepted by a provider.

Retrieval is restricted by corpus version and active source status (or an explicit historical source selection). Returned IDs, hashes, source IDs and statuses must match the local corpus. Returned text is never used as source evidence. Unknown IDs, duplicate hits, incompatible scores or metadata are rejected. Corpus/model/configuration changes require a matching namespace; no local fallback is silently substituted. Quote matching still does not establish semantic entailment.

Scores and timings remain in Q&A/comparison/evaluation output, with the namespace. Integrated query embedding is included in Pinecone search time; external embedding is timed separately. Snapshot readiness is not proof of future availability. No live performance or quality scores have been produced by this implementation work.

## Verification

`node --test tests/pinecone.test.mjs` covers the three supported API families, schema/model/host mismatch, unsafe endpoints, partial uploads, cancellation, concurrency, visibility delay, fresh namespaces, invalid metadata, bounded/redacted failures, key persistence, HTTP permissions, comparison and evaluation. `npm run test:browser:pinecone` covers both embedding modes through the actual UI with mock transport. Evidence is in evidence/pinecone-browser-qa.json and evidence/pinecone-regression-tests.txt; baseline UI regressions use the separate evidence/pinecone-regression/ directory.

key_pinecone.json and variants are Git-ignored, excluded from the heuristic privacy scanner and denied by the static server/build allowlists. Their contents were not read or migrated during development.

The setup always shows **Check Pinecone connection** under **2. Check the saved Pinecone connection**. A disabled button has a reason immediately above it. **Active backend** identifies the running configuration; **Form (not saved)** identifies edits that are not active. Save the backend settings to apply them. Unsaved changes disable checking/uploading to prevent using the wrong destination. These UI updates require a page refresh, not a server restart.

Connection checks now have a persistent result box immediately below the button: checking, succeeded, failed or cancelled. The result survives Refresh corpus and status rerenders within that page session. A successful empty-index check explicitly says the connection is compatible but no corpus is uploaded; a full browser reload does not retain prior client-side error history. The button is type=button and its handler prevents form submission.

HTTP 401 means Pinecone rejected authentication; it is not a successful compatibility check. Verify the complete Pinecone API key privately and that it belongs to the intended project. The app uses only the saved pinecone key slot as the Api-Key header for both control-plane and index-host calls. Mock regression tests cover saved-key reload/replacement and prove generation-provider keys are not substituted. No real key was inspected or live verification performed by these tests. See https://docs.pinecone.io/reference/api/errors and https://docs.pinecone.io/reference/api/authentication.

The frontend also explains a 401 returned by an already-running older server, so refresh is sufficient for the near-button feedback. More specific backend error codes take effect on the next planned server restart; the already-running older server does not yet persist settings. Its first upgrade requires re-entering configuration once.


The connection result and readiness panel show the selected upload namespace, observed indexed records versus expected corpus chunks, count-check timestamp, and separate total-index count. A total across namespaces cannot verify this upload. Missing namespaces or missing/invalid counts are unknown, not zero. A count mismatch keeps the upload unverified; indexing may be catching up, so check again later rather than automatically uploading again. Refresh only reads the saved observation and does not call Pinecone. The first upgrade from the old server requires a restart and re-entering its runtime settings once; subsequent explicitly saved settings persist. Existing receipts are reused when the exact configuration is restored.
