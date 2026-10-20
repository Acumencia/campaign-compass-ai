# Ask navigation and behavior

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

Verification (19 October 2026): 221 unit tests and build passed; 10 conversational browser checks plus 75 existing Ask/ambiguity/coverage/RAG/Pinecone checks passed with mocked providers. The actual task browser verified remembered Dayline context and New chat using local clarification only. No paid provider calls. Evidence: evidence/conversation-checks.txt, evidence/conversation-browser-qa.json, evidence/conversation-activation.json, evidence/conversation-actual-browser.png. Existing live quality evaluations were not rerun.


## Rejected-answer diagnostics and feature coverage

Rejected answers now show bounded validation rule/index details and trusted retrieved/supplied source metadata. Rejected answer text never appears or enters history. Broad feature queries use improved generic-word filtering; product source claims and strict citation validation are unchanged. See submission/week2-documentation.md for the current offline tests, recording and limitations.
