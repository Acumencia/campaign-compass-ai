# API-only setup

The connection screen now contains only OpenAI API and Anthropic Claude API. There is one provider selector, one key slot for that selected provider, a model dropdown and explicit session permission. There is no ChatGPT login section or delegated-login fallback in this browser flow.

## Start and use

1. Stop an older running server with Ctrl+C. In PowerShell run `Set-Location -LiteralPath 'D:\Codex\campaign-compass-ai'`, then `npm start`. Open `http://127.0.0.1:4173/` and hard-refresh with Ctrl+Shift+R.
2. Open **API settings** and choose **Anthropic · Claude** or **OpenAI · GPT**.
3. In **1. API key**, save that provider's key only if it is not already saved. Replacing it requires confirmation. Existing keys are never displayed, moved or migrated automatically.
4. In **2. Model**, choose a documented suggestion or **Custom model ID**, review the output cap, then click **Save model for this run**. This configures/enables the adapter without permission to bill. No provider request is made.
5. In **3. Request permission**, read the next action, then click **Allow billed requests this session** only when ready. That click itself makes no vendor call. **Ask for a campaign brief** is the explicit action that can make a billed request. **Pause API requests** stops future submissions; already submitted work may still incur charges.

## What the status means

**Saved key** means local storage succeeded. **Configured model** means local settings are complete. **API permission on** means the user opted in for this session. **Successful generation response** appears only after the API responds successfully; it is not a guarantee of future access or semantic accuracy. No automatic connection test occurs.

If a button is disabled, the adjacent next action and safe status code identify why: PROVIDER_REQUIRED, KEY_REQUIRED, MODEL_REQUIRED, OUTPUT_LIMIT_INVALID, PROVIDER_PAUSED or LOCAL_SERVER_REQUIRED. You can report that code without sharing a key or config contents. **Refresh status** contacts only the local server. A key or model save and provider switching clear permission; switching also clears incompatible draft model IDs. Delayed pre-change status responses cannot overwrite newer setup state.

## Model suggestions

The bundled lists were checked against official documentation on 2026-10-18. They contain generation models, not embedding models, and are **not account-verified availability**. Nothing queries your account or uses a saved key to list models. Suggestions may age or be unavailable to your project; use Custom model ID for another compatible model your account permits. If the suggestion catalog is unavailable, Custom model ID remains usable. No model is selected automatically.

- OpenAI: `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`. Sources: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna).
- Anthropic: `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-opus-5-5`. Sources: [model IDs](https://platform.claude.com/docs/en/models/overview), [Structured Outputs support](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

## Refresh and restart

A page refresh retains this server's model settings and the current session's permission. A server restart preserves saved keys, but model/enable settings return to .env/terminal defaults and a new browser session requires fresh permission. The model button deliberately says **for this run**. For persistence, configure CAMPAIGN_GENERATION_PROVIDER, CAMPAIGN_OPENAI_GENERATION_MODEL / CAMPAIGN_ANTHROPIC_GENERATION_MODEL and the respective ENABLED flags in .env yourself. Runtime saves never modify .env. Output caps are 128-8192, default 2048; truncation is rejected.

## Credentials and precedence

Keys live in local **plaintext key.json** with current-user Windows ACLs or POSIX mode 0600 for newly written files. Git ignores key.json and key.json.*; only blank key.example.json belongs in the repository. .env stays ignored except the blank template. No credential file is served, bundled, logged, returned to the browser or stored in browser localStorage/sessionStorage. Password fields clear after submission and switching/closing. Writes use atomic replacement, file checks, and a lock; failure preserves the prior file.

A nonempty key.json slot overrides only its matching vendor's environment key. Missing/empty slots fall back to CAMPAIGN_OPENAI_API_KEY / CAMPAIGN_ANTHROPIC_API_KEY. Terminal environment takes precedence over .env. No .env credentials are copied or migrated. To remove a key, stop the server and edit the matching JSON slot locally; also clear its environment key if fallback is unwanted. Invalid/unreadable/linked storage fails closed and is not overwritten; repair it locally. A stale key.json.lock can be removed manually only after confirming no app instance is running.

Each adapter pins its own vendor HTTPS endpoint, rejects redirects and uses only that vendor's key. All local mutations require loopback host/origin/session/CSRF checks. APIs have separate billing from consumer subscriptions and cannot bypass account/model permissions. Permission/limit failures pause the adapter without retries or switching providers. Claude's direct adapter supports single-workspace API keys; cloud-platform credentials and multi-workspace routing are not implemented.

## RAG is separate

Campaign briefs need generation only. For live RAG, open Knowledge → Live RAG setup and billing. Save the OpenAI key yourself in API settings, select an embedding model/dimensions, allow embedding charges, acknowledge and build the index, then refresh readiness. Select Claude or OpenAI for generation and allow generation charges separately. Comparison may make two generation calls; the separately acknowledged evaluation runs 30 questions. Nothing is billed merely by saving settings. See [the complete setup and demo guide](week2-knowledge.md).

Optional CLI indexing/evaluation flags remain available and now load .env consistently; separate CLI processes cannot use the running server's in-memory model choices. The UI avoids that configuration gap.


All implementation verification used temporary synthetic keys and mocked HTTP. No actual user credential was read, changed or sent, and no live API access is claimed.


### Diagnosing Claude requests

After restarting the updated server, select Claude, save the desired model for this run, explicitly allow requests, and request one brief yourself. If it fails, share only the fixed error sentence and diagnostic code/HTTP status shown in API settings. Do not share keys, environment files, headers, raw responses, or logs. The app never retries automatically. HTTP 400 indicates request/model-format rejection, 404 a missing model/resource, 401 authentication rejection, 403 permission denial, 429 a limit, and 529 temporary provider overload. These categories do not identify an account-specific root cause on their own.

The adapter discards upstream error bodies and retains only numeric HTTP status plus app-defined code/message. It never collects raw provider messages. Only a strictly validated request-id response header may be retained alongside the status; auth and other headers are never logged. Thinking and redacted-thinking blocks are ignored; only completed final JSON text is parsed and then checked against application evidence. An output-token-limit stop gets its own error without automatically increasing the cap.


Grounding diagnostics now identify only fixed field names, rejection categories, and a claim position. Examples: `missing_field`, `extra_field`, `claim_count`, `unknown_evidence_id`, `invalid_numeric_type`, `metric_mismatch`, `undefined_evidence`, `duplicate_evidence`, `context_mismatch`, `snapshot_mismatch`, or `invalid_enum`. No returned metric ID or value is displayed. Both providers use the same metric schema; the prompt explicitly requires 1-8 unique claims, exact JSON numbers without rounding, and exclusion of undefined metrics. Claude's supported schema subset cannot enforce the upper claim count or uniqueness, so these remain strict application checks. No retry or repair call is made automatically.
