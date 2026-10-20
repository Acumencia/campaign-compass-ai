# Tested questions and results

The original live baseline contains 30 questions, run once on 19 October 2026. Complete/partial/failure judgments below come from AI-assisted qualitative source review, not independent human grading. Automatic checks assessed response structure, quote membership, expected response state and retrieval recall; these do not prove semantic support or completeness. Question wording is copied exactly from the retained raw export.

Baseline: 23 complete, 3 partial, 2 missing-evidence failures and 2 unavailable validation errors. The seven-case follow-up is separate; the other 23 questions were not rerun.

## Original cohort

14 complete; 1 task failure (K08).

### K01 — What is the capacity and material of the Switchback bottle?

Expected: 650 milliliters; stainless steel body and polypropylene lid.

Observed: Complete; returned state answered. Correct standard bottle capacity/materials; explicitly distinguishes Mini.

### K02 — How should I clean the Dayline pack?

Expected: Spot-clean with mild soap, air dry; no machine wash.

Observed: Complete; returned state answered. All cleaning instructions and weather limitation supported.

### K03 — What does standard shipping cost and when is it free?

Expected: 6 demo USD; free for post-discount merchandise subtotal at least 75 demo USD.

Observed: Complete; returned state answered. Correct post-discount threshold, boundary and shipping cost; extra delivery facts supported.

### K04 — What is the return window for unused products?

Expected: 30 calendar days after delivery with proof of purchase.

Observed: Complete; returned state answered. Correct unused-item return window, proof and postage qualifications.

### K05 — When does the Autumn Everyday campaign end?

Expected: October 31, 2026.

Observed: Complete; returned state answered. Correct campaign and offer end date.

### K06 — What voice should Luma Trail use?

Expected: Practical, warm, specific; avoid superlatives and urgency pressure.

Observed: Complete; returned state answered. Correct voice, audience scope and fictional provenance.

### K07 — Can a Dayline pack campaign say it is waterproof?

Expected: No; light-splash resistance only, explicitly not waterproof.

Observed: Complete; returned state answered. Correct prohibition and permitted splash-resistance alternative; audience desire is not evidence.

### K08 — What is the Switchback bottle price with EVERYDAY10, and does this order get free shipping?

Expected: 25.20 demo USD merchandise plus 6 shipping; below 75 threshold. Arithmetic must be identified.

Observed: Task failed; returned state insufficient_evidence. Task failed: shipping Delivery section absent from top five and supplied context (recall 2/3). Conservative abstention; corpus supports 28 x 0.9 = 25.20 merchandise plus 6 shipping.

### K09 — What capacity and brand voice can a Dayline pack social caption use?

Expected: 18 liters; practical warm voice; factual citations and human review.

Observed: Complete; returned state answered. Correct 18-liter capacity, practical warm voice, factual caption guidance and human approval.

### K10 — May a Switchback bottle caption promise cold water for 24 hours?

Expected: No approved temperature-retention duration.

Observed: Complete; returned state answered. Correctly rejects unsupported 24-hour temperature promise.

### K11 — Is it safe?

Expected: Clarify product and intended use; do not infer safety.

Observed: Complete; returned state clarification. Appropriate clarification asks product and intended safety/use context.

### K12 — Which one is best?

Expected: Clarify needs and product; no unsupported ranking.

Observed: Complete; returned state clarification. Appropriate clarification asks compared products and carrying needs; no invented ranking.

### K13 — Who manufactures the Switchback bottle?

Expected: Abstain: supplier identity not provided.

Observed: Complete; returned state insufficient_evidence. Appropriate abstention: manufacturer identity absent.

### K14 — How many Dayline packs are in stock today?

Expected: Abstain: no inventory counts.

Observed: Complete; returned state insufficient_evidence. Appropriate abstention: no live inventory.

### K15 — What conversion lift will EVERYDAY10 produce?

Expected: Abstain: no conversion-lift experiment or forecast.

Observed: Complete; returned state insufficient_evidence. Appropriate abstention: no causal lift evidence or forecast.

## Expanded cohort

9 complete; 3 partial; 1 task failure; 2 validation errors.

### K16 — What is the Waypoint sling capacity and list price?

Expected: 3 liters and 35 demo USD.

Observed: Complete; returned state answered. Correct 3-liter capacity and 35 demo USD; additional dimensions and offer exclusion supported.

### K17 — Does Ridgeline have a padded electronics compartment?

Expected: No padded electronics compartment is documented.

Observed: Task failed; returned state insufficient_evidence. Task failed: tote Materials section not retrieved (recall 0). It explicitly states no padded electronics compartment. Abstention is safe for incomplete supplied context, but misses corpus answer.

### K18 — What capacity does Switchback Mini have?

Expected: 400 milliliters; distinguish standard Switchback.

Observed: Complete; returned state answered. Correct 400 ml Mini versus 650 ml standard distinction.

### K19 — What is the fictional September email delivered-message click rate?

Expected: 8 percent; synthetic, not ad CTR.

Observed: Complete; returned state answered. Correct 8 percent calculation with all inputs and denominator cited; distinguishes email rate from ad CTR and synthetic scope.

### K20 — Can we claim Dayline is waterproof because commuter scenarios request rain protection?

Expected: No; authored desires do not establish product capability.

Observed: Complete; returned state answered. Correctly separates audience desires from permitted product claims.

### K21 — Did Spring capacity messaging outperform Summer discount messaging?

Expected: Cannot infer causal superiority; attribution, audience and offer differ.

Observed: Complete; returned state answered. Correctly rejects causal superiority; attribution/audience/offer and lack of randomized comparison supported.

### K22 — Does an eligible 80 demo USD subtotal qualify for free shipping after EVERYDAY10?

Expected: 72 after discount; below 75 threshold, so no free standard shipping.

Observed: Unavailable: validation error; returned state error. Unavailable: invalid_answer after generation returned. Rejected output, vector matches and timings were discarded. Cannot identify exact violated rule or grade semantic answer. Expected 80 x 0.9 = 72, below 75.

### K23 — Can a stainless steel Switchback caption claim carbon neutrality?

Expected: No product-specific certification or lifecycle evidence.

Observed: Complete; returned state answered. Supported no-carbon-neutral answer and material-versus-environmental-evidence distinction. Does not explicitly recite lifecycle-evidence requirement, but core answer is correct; extra Mini claim is scoped separately.

### K24 — Which bag fits my device?

Expected: Ask for device dimensions and carrying requirements.

Observed: Partial; returned state clarification. Safe clarification, partially complete: asks device/screen size and use case, but should explicitly request physical dimensions. Screen size alone cannot establish fit.

### K25 — Can I combine these offers?

Expected: Ask which offers and items; do not invent allocation or stacking.

Observed: Complete; returned state clarification. Appropriate clarification asks offers and basket items without inventing stacking rules.

### K26 — What is the real customer lifetime value for Luma Trail?

Expected: Unknown; fictional reports provide no lifetime value.

Observed: Complete; returned state insufficient_evidence. Appropriate abstention: synthetic corpus cannot establish real customer lifetime value.

### K27 — Which country legally permits this environmental claim?

Expected: No jurisdiction-specific legal evidence.

Observed: Complete; returned state insufficient_evidence. Appropriate abstention: no jurisdiction-specific legal evidence.

### K28 — What is the current Dayline capacity, 16 or 18 liters?

Expected: 18 liters; archived 16-liter specification is not current.

Observed: Partial; returned state answered. Current 18-liter value is correct and supported, but expected explanation that archived 16-liter specification is superseded is omitted.

### K29 — Is the current free-shipping threshold 60 or 75 demo USD?

Expected: 75 post-discount; archived 60 threshold expired.

Observed: Partial; returned state answered. Current 75 post-discount threshold is correct and supported, but expected explanation that archived 60 threshold expired is omitted.

### K30 — Can the current Autumn campaign use SUMMER15?

Expected: No; Summer offer expired, Autumn uses EVERYDAY10.

Observed: Unavailable: validation error; returned state error. Unavailable: invalid_answer after generation returned; exact reason and vector evidence lost. Lexical retrieval also missed both expected sections, but this does not establish vector failure. Expected SUMMER15 expired and Autumn uses EVERYDAY10.

## Separate seven-case follow-up

Only K08, K17, K24, K28, K29, K22 and K30 were run again, once each, after the coverage changes. This was an approved bounded command-line run through the same app RAG service at 15:11–15:12 UTC, not seven browser submissions. Seven searches and seven generations completed; there were no retries or corpus uploads. These known development cases are not an unseen benchmark.

Five complete outcomes and two citation-validation failures. Fourteen accepted factual claims were source-reviewed; rejected output cannot be semantically graded.

### K08 — What is the Switchback bottle price with EVERYDAY10, and does this order get free shipping?

Before: Task failed. Task failed: shipping Delivery section absent from top five and supplied context (recall 2/3). Conservative abstention; corpus supports 28 x 0.9 = 25.20 merchandise plus 6 shipping.

After: Failed citation validation. Still failed, now at citation_contract validation despite all three expected source sections being supplied. Improved retrieval coverage is verified; no valid answer was accepted. Exact offending citation field is unavailable because rejected model text is deliberately not retained.

### K17 — Does Ridgeline have a padded electronics compartment?

Before: Task failed. Task failed: tote Materials section not retrieved (recall 0). It explicitly states no padded electronics compartment. Abstention is safe for incomplete supplied context, but misses corpus answer.

After: Complete. Complete. Correctly identifies Ridgeline as a tote without a padded electronics compartment or closure, with matching materials and selection quotes. The previously missing Materials passage is supplied.

### K24 — Which bag fits my device?

Before: Partial. Safe clarification, partially complete: asks device/screen size and use case, but should explicitly request physical dimensions. Screen size alone cannot establish fit.

After: Complete. Complete clarification. The model itself requests physical length, width, thickness with units, carrying method and padding/protection. Local clarification completion was not needed. It makes no product-fit claim.

### K28 — What is the current Dayline capacity, 16 or 18 liters?

Before: Partial. Current 18-liter value is correct and supported, but expected explanation that archived 16-liter specification is superseded is omitted.

After: Complete. Complete. Cites active 18-liter specification separately from historical 16-liter pilot and explicitly explains supersession and effective date. Historical facts are clearly labeled, not presented as current.

### K29 — Is the current free-shipping threshold 60 or 75 demo USD?

Before: Partial. Current 75 post-discount threshold is correct and supported, but expected explanation that archived 60 threshold expired is omitted.

After: Complete. Complete. Cites active 75 post-discount threshold and exact boundary separately from the old 60 threshold that expired September 30. No obsolete value is presented as current.

### K22 — Does an eligible 80 demo USD subtotal qualify for free shipping after EVERYDAY10?

Before: Unavailable: validation error. Unavailable: invalid_answer after generation returned. Rejected output, vector matches and timings were discarded. Cannot identify exact violated rule or grade semantic answer. Expected 80 x 0.9 = 72, below 75.

After: Complete. Complete. Explicitly labeled calculation 80 minus 10 percent (8) equals 72; below 75, so 6 shipping applies. All inputs, eligibility scope and shipping conditions are supported by supplied quotes.

### K30 — Can the current Autumn campaign use SUMMER15?

Before: Unavailable: validation error. Unavailable: invalid_answer after generation returned; exact reason and vector evidence lost. Lexical retrieval also missed both expected sections, but this does not establish vector failure. Expected SUMMER15 expired and Autumn uses EVERYDAY10.

After: Failed citation validation. Still failed at citation_contract validation. Active campaign terms were supplied, but source-register Supersession remained missing (expected evidence coverage 1/2). Version-comparison expansion did not activate for this wording, which names current Autumn and SUMMER15 without explicit old-versus-current comparison terms. This identifies remaining coverage limitation, not the exact cause of the citation rejection. Rejected output is unavailable.


## Current Ask update: conversation, diagnostics and retrieval (19 October 2026)

The current UI has a dedicated Ask workspace, a visible conversation transcript, New chat, source inspection and expandable diagnostics. It sends at most four completed exchanges as untrusted context. Fresh retrieval and existing citation checks remain required; failed turns are excluded. Current source filters override earlier context. No production multi-user persistence is claimed.

A reported broad question, "do you have any waterproof products?", failed the answer contract. Its original generated response and retrieval diagnostics were not retained through the ordinary Ask HTTP error path, so the historical root cause remains unknown. It must not be described as a confirmed quotation error or as evidence that Ridgeline was approved waterproof.

The normal Ask error path now carries an allowlisted, bounded diagnostic: run ID, validation category and rule, zero-based claim/citation index, resolved query, prior-message count, source filter, and up to 24 retrieved source/chunk identifiers, similarity scores and supplied flags. The UI offers source inspection. Raw rejected output, prior conversation text, credentials and arbitrary provider errors are excluded. Validation remains fail-closed; no automatic retry or paid repair call was added.

General lexical coverage now removes conversational shopping terms such as "you", "any" and "products" rather than letting them dominate feature matching. For the reported question and adjacent phrasings, the local top five now include Ridgeline / Weather limits and Dayline / Care and price. Adjacent cotton, padded electronics and adjustable-strap regressions also pass. This is a general tokenization change, not a hard-coded waterproof answer. It adds no external calls, changes no corpus claims, and retains active-source filtering, explicit scope, the empty-vector gate and the context budget. Corpus hashes, namespace and stored embeddings remain unchanged. Lexical ranking changed, so old lexical scores are historical rather than current measurements.

The approved source wording remains: Ridgeline has no approved waterproof or water-resistance claim; Dayline resists light splashes but is not waterproof. Cotton canvas, an open tote design, or carrying a bottle do not imply a waterproof rating. Quote membership alone still does not prove semantic entailment or completeness.

Verification: 224 unit tests and build; six new offline browser regressions; existing Ask, conversation, ambiguity, coverage, RAG and Pinecone browser suites. All new generated answers are deterministic source-copy fixtures, not live model outputs. The historical 30-question baseline and seven-case follow-up remain unchanged, including unresolved citation failures. No new live quality or latency improvement is claimed.

Current recording: week2-current-ask-demo.webm. It shows the actual current UI in an isolated offline fixture: conversation, source-qualified answers, citation inspection and an intentionally rejected quote with diagnostic details. A persistent disclosure identifies mock search/generation and zero new external calls. It includes saved baseline/follow-up outcomes as historical evidence. The original development and submission replay videos are preserved. This recording demonstrates functionality, not a fresh Pinecone/Claude run. Public sharing and final submission remain pending.

Evidence: evidence/diagnostics-coverage-checks.txt, evidence/diagnostics-coverage-browser-qa.json, tests/diagnostics-coverage.test.mjs and submission/week2-current-ask-demo-evidence.json.
