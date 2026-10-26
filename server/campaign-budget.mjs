import {randomUUID, createHash} from 'node:crypto';

// This policy is deliberately narrower than the general provider adapter.
// Changing model, rate tier or accounting rules requires a new reviewed policy.
export const CAMPAIGN_BUDGET_POLICY = Object.freeze({
  policyVersion: 'campaign-usd-v1',
  model: 'claude-opus-5-5',
  endpoint: 'https://api.anthropic.com/v1/messages',
  ceilingUsd: 2,
  inputUsdPerMillion: 4,
  outputUsdPerMillion: 20,
  maxBodyBytes: 45000,
  inputOverheadTokens: 4096,
  allowedMaxOutputTokens: Object.freeze([2048, 6144]),
});

const trustedQAPolicies=new WeakSet();
/** Server-only policy capability. Never construct from HTTP request data. */
export function createCampaignQABudgetPolicy({ceilingUsd=5,authorizationId}={}){
 if(![5,10].includes(ceilingUsd)||typeof authorizationId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(authorizationId))throw new Error('QA policy requires an explicit five or ten dollar cap and bounded authorization ID.');
 const policy=Object.freeze({...CAMPAIGN_BUDGET_POLICY,policyVersion:'campaign-qa-usd-v1',ceilingUsd,authorizationId,purpose:'RAG repair and verification',scope:'isolated-qa-work',maxModelCalls:24});trustedQAPolicies.add(policy);return policy;
}
function trustedPolicy(policy=CAMPAIGN_BUDGET_POLICY){if(policy!==CAMPAIGN_BUDGET_POLICY&&!trustedQAPolicies.has(policy))throw new Error('Only a server-created budget policy capability is allowed.');return policy;}
function displayPolicy(ledger){
 if(ledger?.policyVersion!=='campaign-qa-usd-v1')return CAMPAIGN_BUDGET_POLICY;
 return {...CAMPAIGN_BUDGET_POLICY,policyVersion:'campaign-qa-usd-v1',ceilingUsd:ledger.ceilingMicroUsd/1e6,authorizationId:ledger.qaAuthorization?.id};
}

export class CampaignBudgetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CampaignBudgetError';
    this.code = `campaign_budget_${code}`;
    this.status = 409;
  }
}

const POLICY = CAMPAIGN_BUDGET_POLICY;
const CEILING_MICRO_USD = 2_000_000;
const records = new Map();
const active = new Set();
const batches = new Set();
const digest = text => createHash('sha256').update(text).digest('hex');
const live = run => ['live-grounded', 'live-editorial'].includes(run?.mode);
const fail = (code, message) => { throw new CampaignBudgetError(code, message); };
const clone = value => structuredClone(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const tokenCounter = value => integer(value) && value <= 1_000_000_000;
const cost = (input, output) => input * 4 + output * 20;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function scope(run) {
  if (!run || typeof run.id !== 'string' || !run.id || run.id.length > 200) {
    fail('scope', 'A persisted campaign identity is required for budget accounting.');
  }
  return run.id;
}

function validateLedger(ledger, runId, policy=POLICY) {
  const ceilingMicroUsd=policy.ceilingUsd*1e6;
  if (!ledger || ledger.policyVersion !== policy.policyVersion || ledger.runId !== runId ||
      ledger.model !== POLICY.model || ledger.ceilingMicroUsd !== ceilingMicroUsd ||
      ledger.inputMicroUsdPerToken !== 4 || ledger.outputMicroUsdPerToken !== 20 ||
      !integer(ledger.revision) || !Array.isArray(ledger.reservations) || ledger.reservations.length > 100) {
    fail('ledger_invalid', 'The persisted campaign budget does not match the fixed spending policy.');
  }
  if(policy.policyVersion==='campaign-qa-usd-v1'){
    const audit=ledger.qaAuthorization;
    if(![5,10].includes(policy.ceilingUsd)||!audit||audit.id!==policy.authorizationId||!/^[a-zA-Z0-9_-]{8,100}$/.test(audit.id)||audit.purpose!=='RAG repair and verification'||audit.scope!=='isolated-qa-work'||(audit.maxModelCalls!==undefined&&audit.maxModelCalls!==24)||audit.originalCeilingMicroUsd!==5_000_000||!Array.isArray(audit.amendments)||audit.amendments.length!==(policy.ceilingUsd===10?1:0))fail('ledger_invalid','QA authorization audit does not match the scoped policy.');
    if(policy.ceilingUsd===10){const amendment=audit.amendments[0];if(amendment.fromMicroUsd!==5_000_000||amendment.toMicroUsd!==10_000_000||amendment.reason!=='authorized-conditional-extension'||typeof amendment.at!=='string')fail('ledger_invalid','QA budget extension audit is invalid.');}
    const allowance=audit.callAllowanceAmendment;
    if(allowance&&(policy.ceilingUsd!==10||allowance.from!==24||allowance.to!==28||allowance.authorizationId!==audit.id||allowance.reason!=='authorized-qa-review-continuation'||allowance.modelCallsAtAmendment!==24||typeof allowance.at!=='string'||!Number.isFinite(Date.parse(allowance.at))))fail('ledger_invalid','QA call allowance audit is invalid.');
  }else if(ledger.qaAuthorization)fail('ledger_invalid','A default campaign cannot carry a QA budget override.');
  const ids = new Set();
  for (const entry of ledger.reservations) {
    if (!entry || typeof entry.id !== 'string' || ids.has(entry.id) ||
        !['planned', 'started', 'completed', 'uncertain', 'persistence_failed'].includes(entry.status) ||
        entry.model !== POLICY.model || !integer(entry.bodyBytes) || entry.bodyBytes > POLICY.maxBodyBytes ||
        entry.inputUpperTokens !== entry.bodyBytes + POLICY.inputOverheadTokens ||
        !POLICY.allowedMaxOutputTokens.includes(entry.maxOutputTokens) ||
        entry.reservedMicroUsd !== cost(entry.inputUpperTokens, entry.maxOutputTokens)) {
      fail('ledger_invalid', 'A persisted reservation is inconsistent with the campaign policy.');
    }
    if (entry.status === 'planned' && !/^[a-f0-9]{64}$/.test(entry.requestHash || '')) fail('ledger_invalid','Planned reservations require an immutable request digest.');
    ids.add(entry.id);
    if (entry.usage !== null && entry.usage !== undefined) {
      if (!entry.usage || typeof entry.usage !== 'object' || Array.isArray(entry.usage) ||
          Object.values(entry.usage).some(value => !integer(value))) {
        fail('ledger_invalid', 'Persisted usage must contain numeric token counters only.');
      }
    }
    if (entry.actualMicroUsd !== null && entry.actualMicroUsd !== undefined &&
        (!integer(entry.actualMicroUsd) || !entry.usage ||
         entry.actualMicroUsd !== cost(entry.usage.input_tokens, entry.usage.output_tokens))) {
      fail('ledger_invalid', 'Persisted actual usage totals are inconsistent.');
    }
    if (entry.status === 'completed' && (!entry.usage || !integer(entry.actualMicroUsd))) {
      fail('ledger_invalid', 'A completed reservation must include validated numeric usage.');
    }
  }
  if (ledger.reservations.reduce((sum, entry) => sum + entry.reservedMicroUsd, 0) > ceilingMicroUsd) {
    fail('ledger_invalid', 'Persisted reservations exceed the campaign ceiling.');
  }
  return ledger;
}

function latest(run,policy=POLICY) {
  const id = scope(run);
  validateLedger(run.billing, id,policy);
  const remembered = records.get(id);
  // A stale wrapper cannot reset the ledger after another request completed.
  return remembered && remembered.revision > run.billing.revision
    ? clone(validateLedger(remembered,id,policy)) : clone(run.billing);
}

function descriptor(run, ledger) {
  const id = scope(run);
  const reservations = ledger?.reservations || [];
  const reservedMicroUsd = reservations.reduce((sum, entry) => sum + entry.reservedMicroUsd, 0);
  const actualMicroUsd = reservations.reduce((sum, entry) => sum + (entry.actualMicroUsd || 0), 0);
  const incomplete = reservations.some(entry => entry.status === 'started');
  const pending = incomplete && active.has(id);
  const uncertain = reservations.some(entry => ['uncertain', 'persistence_failed'].includes(entry.status)) ||
    (incomplete && !pending);
  return {
    enabled: live(run),
    policyVersion: ledger?.policyVersion ?? POLICY.policyVersion,
    ...(ledger?.qaAuthorization?{qaAuthorization:clone(ledger.qaAuthorization)}:{}),
    maxModelCalls: ledger?.qaAuthorization?.callAllowanceAmendment ? 28 : ledger?.qaAuthorization ? 24 : 12,
    model: ledger?.model ?? POLICY.model,
    ceilingUsd: (ledger?.ceilingMicroUsd ?? CEILING_MICRO_USD)/1e6,
    reservedUsd: reservedMicroUsd / 1_000_000,
    estimatedUsd: reservedMicroUsd / 1_000_000,
    knownActualUsd: actualMicroUsd / 1_000_000,
    remainingUsd: Math.max(0, (ledger?.ceilingMicroUsd ?? CEILING_MICRO_USD) - reservedMicroUsd) / 1_000_000,
    callCount: reservations.filter(entry => entry.status !== 'planned').length,
    plannedCalls: reservations.filter(entry => entry.status === 'planned').length,
    completedCalls: reservations.filter(entry => entry.status === 'completed').length,
    uncertain,
    pending,
    blockedReason: !ledger && live(run) ? 'missing_budget' :
      uncertain ? 'uncertain_request' : reservations.some(entry => entry.status === 'planned') && !batches.has(id) ? 'incomplete_batch' : ledger?.blockedReason || null,
    accounting: 'Conservative reservations never refunded; known actual usage is reported separately.',
  };
}

/** Pure public projection: no writes, requests, recovery or credential access. */
export function campaignBudgetStatus(run) {
  if (!run?.billing) return descriptor(run, null);
  return descriptor(run, validateLedger(run.billing, scope(run),displayPolicy(run.billing)));
}

function persist(run, ledger, save) {
  ledger.revision++;
  run.billing = clone(ledger);
  records.set(run.id, clone(ledger));
  let result;
  try { result = save(run); }
  catch {
    ledger.blockedReason = 'persistence_failed';
    const last = ledger.reservations.at(-1);
    if (last?.status === 'started') last.status = 'persistence_failed';
    run.billing = clone(ledger);
    records.set(run.id, clone(ledger));
    fail('persistence', 'Budget checkpoint could not be saved. No further campaign request is allowed.');
  }
  if (result && typeof result.then === 'function') {
    // Attaching a rejection handler prevents a caller's rejected Promise from
    // becoming unhandled. An async save still does not satisfy the contract.
    result.catch?.(() => {});
    ledger.blockedReason = 'persistence_failed';
    const last = ledger.reservations.at(-1);
    if (last?.status === 'started') last.status = 'persistence_failed';
    run.billing = clone(ledger);
    records.set(run.id, clone(ledger));
    fail('persistence', 'Budget saving must finish synchronously before a provider request.');
  }
}

/** Invoke only inside creation of a NEW campaign, never on live resume. */
export function initializeCampaignBudget({run, save, newCampaign = false,policy=POLICY} = {}) {
  policy=trustedPolicy(policy);
  if(policy.policyVersion==='campaign-qa-usd-v1'&&policy.ceilingUsd!==5)fail('initialization','A fresh QA work budget must start at five dollars; extension is an explicit later action.');
  scope(run);
  if (!live(run)) return campaignBudgetStatus(run);
  if (!newCampaign || run.billing || records.has(run.id) ||
      (run.budgets?.modelCalls || 0) !== 0 || (run.artifacts?.length || 0) !== 0) {
    fail('initialization', 'Only a new live campaign can receive a budget. Existing budgets cannot be reset.');
  }
  if (typeof save !== 'function') fail('persistence', 'A synchronous campaign checkpoint callback is required.');
  const ledger = {
    policyVersion: policy.policyVersion,
    ...(policy.policyVersion==='campaign-qa-usd-v1'?{qaAuthorization:{id:policy.authorizationId,purpose:'RAG repair and verification',scope:'isolated-qa-work',maxModelCalls:24,originalCeilingMicroUsd:5_000_000,amendments:[]}}:{}),
    runId: run.id,
    model: POLICY.model,
    ceilingMicroUsd: policy.ceilingUsd*1e6,
    inputMicroUsdPerToken: 4,
    outputMicroUsdPerToken: 20,
    revision: 0,
    blockedReason: null,
    reservations: [],
  };
  persist(run, ledger, save);
  return campaignBudgetStatus(run);
}

/** Explicit trusted QA-only extension. Does not reset reservations or unblock uncertainty. */
export function extendCampaignQABudget({run,save,policy,extendedPolicy}={}){
 trustedPolicy(policy);trustedPolicy(extendedPolicy);
 if(policy?.policyVersion!=='campaign-qa-usd-v1'||policy.ceilingUsd!==5||extendedPolicy?.policyVersion!=='campaign-qa-usd-v1'||extendedPolicy.ceilingUsd!==10||policy.authorizationId!==extendedPolicy.authorizationId||typeof save!=='function')fail('extension','Only the same authorized QA work may extend from five to ten dollars.');
 const ledger=latest(run,policy);
 if(active.has(run.id)||batches.has(run.id)||(ledger.blockedReason&&ledger.blockedReason!=='ceiling')||ledger.reservations.some(e=>e.status!=='completed'))fail('extension_blocked','Resolve all pending or uncertain outcomes before extending QA work.');
 ledger.ceilingMicroUsd=10_000_000;if(ledger.blockedReason==='ceiling')ledger.blockedReason=null;ledger.qaAuthorization.amendments.push({fromMicroUsd:5_000_000,toMicroUsd:10_000_000,at:new Date().toISOString(),reason:'authorized-conditional-extension'});
 persist(run,ledger,save);return campaignBudgetStatus(run);
}

/** Trusted one-time continuation of completed QA work; no spend or history reset. */
export function amendQAReviewAllowance({run,save,policy}={}) {
 trustedPolicy(policy);
 if(policy?.policyVersion!=='campaign-qa-usd-v1'||policy.ceilingUsd!==10||typeof save!=='function'||!live(run))fail('allowance','Only matching ten-dollar QA work may receive this review allowance.');
 const ledger=latest(run,policy);
 if(ledger.qaAuthorization.callAllowanceAmendment||run.budgets?.maxModelCalls!==24||run.budgets?.modelCalls!==24)fail('allowance','The one-time allowance requires an exhausted original twenty-four-call QA limit.');
 if(run.pendingOperation||run.status==='running'||active.has(run.id)||batches.has(run.id)||ledger.blockedReason||ledger.reservations.some(entry=>entry.status!=='completed'))fail('allowance_blocked','All requests must have completed known outcomes before amending the QA call allowance.');
 ledger.qaAuthorization.callAllowanceAmendment={from:24,to:28,authorizationId:policy.authorizationId,reason:'authorized-qa-review-continuation',modelCallsAtAmendment:24,at:new Date().toISOString()};
 run.budgets.maxModelCalls=28;
 persist(run,ledger,save);
 return campaignBudgetStatus(run);
}

/** Spending authority still requires the trusted matching server policy. */
export function campaignModelCallAllowance({run,policy=POLICY}={}) {
 trustedPolicy(policy);
 const ledger=validateLedger(run.billing,scope(run),policy);
 return ledger.qaAuthorization?.callAllowanceAmendment ? 28 : ledger.qaAuthorization ? 24 : 12;
}

function inspectRequest(url, options) {
  if (url !== POLICY.endpoint || !options || typeof options !== 'object' ||
      Object.keys(options).some(key => !['method', 'headers', 'body', 'signal', 'redirect'].includes(key)) ||
      options.method !== 'POST' || options.redirect !== 'error' || typeof options.body !== 'string') {
    fail('request_policy', 'Use only the fixed standard Anthropic Messages request contract.');
  }
  let headers;
  try { headers = new Headers(options.headers); }
  catch { fail('request_policy', 'Request headers do not match the fixed campaign policy.'); }
  const allowedHeaders = new Set(['content-type', 'x-api-key', 'anthropic-version', 'accept']);
  if ([...headers.keys()].some(key => !allowedHeaders.has(key)) ||
      headers.get('content-type') !== 'application/json' ||
      headers.get('anthropic-version') !== '2023-06-01' || !headers.get('x-api-key') ||
      (headers.has('accept') && headers.get('accept') !== 'application/json')) {
    fail('request_policy', 'Unknown pricing, beta, routing or nonstandard headers are prohibited.');
  }
  const bodyBytes = Buffer.byteLength(options.body, 'utf8');
  if (bodyBytes > POLICY.maxBodyBytes) fail('body_size', 'The serialized request exceeds the 45,000-byte budget boundary.');
  let body;
  try { body = JSON.parse(options.body); }
  catch { fail('request_policy', 'The campaign request body must be valid JSON.'); }
  if (!exact(body, ['model', 'system', 'messages', 'output_config', 'max_tokens', 'stream']) ||
      JSON.stringify(body) !== options.body || body.model !== POLICY.model || body.stream !== false ||
      !POLICY.allowedMaxOutputTokens.includes(body.max_tokens) || typeof body.system !== 'string' ||
      !Array.isArray(body.messages) || body.messages.length !== 1 ||
      !exact(body.messages[0], ['role', 'content']) || body.messages[0].role !== 'user' ||
      typeof body.messages[0].content !== 'string' || !exact(body.output_config, ['format']) ||
      !exact(body.output_config.format, ['type', 'schema']) || body.output_config.format.type !== 'json_schema' ||
      !body.output_config.format.schema || typeof body.output_config.format.schema !== 'object' ||
      Array.isArray(body.output_config.format.schema)) {
    fail('request_policy', 'Model, output cap or body fields differ from the reviewed standard-price policy.');
  }
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
    fail('request_policy', 'Use a standard AbortSignal for cancellation.');
  }
  return {bodyBytes, inputUpperTokens: bodyBytes + POLICY.inputOverheadTokens, maxOutputTokens: body.max_tokens};
}

async function responseUsage(response, signal) {
  if (!response || response.status !== 200 || response.redirected ||
      (response.url && response.url !== POLICY.endpoint) ||
      !response.headers?.get('content-type')?.toLowerCase().startsWith('application/json')) {
    fail('uncertain', 'Provider completion and billed usage could not be established. Reservation retained.');
  }
  let duplicate;
  try { duplicate = response.clone(); }
  catch { fail('uncertain', 'The provider response could not be inspected for usage. Reservation retained.'); }
  const reader = duplicate.body?.getReader();
  if (!reader) fail('uncertain', 'The provider response has no readable usage data.');
  const chunks = [];
  let bytes = 0;
  const cancelRead = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancelRead, {once:true});
  try {
    for (;;) {
      if (signal.aborted) fail('uncertain', 'Usage inspection was interrupted. Reservation retained.');
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1_000_000) {
        void reader.cancel().catch(() => {});
        fail('uncertain', 'The provider response exceeds the usage inspection bound.');
      }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', cancelRead);reader.releaseLock(); }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail('uncertain', 'Provider usage was not valid JSON. Reservation retained.'); }
  const usage = data?.usage;
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const allowedUsage = new Set(['input_tokens','output_tokens','cache_creation_input_tokens','cache_read_input_tokens','service_tier','speed','cache_creation','server_tool_use','inference_geo','output_tokens_details']);
  const zeroCounters = (value, keys) => value == null || record(value) && Object.keys(value).every(key => keys.includes(key)) && Object.values(value).every(counter => counter === 0);
  const standard = value => value == null || value === 'standard';
  const globalGeo = value => value == null || value === 'global';
  const reasons = [];
  if(data?.model !== POLICY.model)reasons.push('model_mismatch');
  if(data?.type !== 'message' || data?.role !== 'assistant')reasons.push('message_envelope');
  if(!record(usage))reasons.push('usage_missing_or_invalid');
  if(record(usage)){
    if(Object.keys(usage).some(key=>!allowedUsage.has(key)))reasons.push('unknown_usage_fields');
    if(!tokenCounter(usage.input_tokens)||!tokenCounter(usage.output_tokens))reasons.push('invalid_token_totals');
    if(!standard(data.service_tier)||!standard(usage.service_tier))reasons.push('nonstandard_service_tier');
    if(!standard(data.speed)||!standard(usage.speed))reasons.push('nonstandard_speed');
    if(!globalGeo(usage.inference_geo)||!globalGeo(data.inference_geo))reasons.push('nonstandard_geography');
    if(usage.cache_creation_input_tokens != null && usage.cache_creation_input_tokens !== 0 || usage.cache_read_input_tokens != null && usage.cache_read_input_tokens !== 0)reasons.push('cache_tokens_not_zero');
    if(!zeroCounters(usage.cache_creation,['ephemeral_5m_input_tokens','ephemeral_1h_input_tokens']))reasons.push('cache_breakdown_not_zero');
    if(!zeroCounters(usage.server_tool_use,['web_search_requests','web_fetch_requests']))reasons.push('server_tools_not_zero');
    const detail=usage.output_tokens_details;
    if(detail != null && (!exact(detail,['thinking_tokens'])||!tokenCounter(detail.thinking_tokens)||!tokenCounter(usage.output_tokens)||detail.thinking_tokens>usage.output_tokens))reasons.push('invalid_output_breakdown');
  }
  if(reasons.length){
    const issue=new CampaignBudgetError('uncertain','Usage or pricing modifiers differ from the reviewed standard-price policy.');
    // Only fixed reason codes, fixed enums and bounded numeric observations survive.
    // Never persist unknown field names/values, response text, headers or credentials.
    const classify=(value,known)=>value===undefined?'absent':value===null?'null':known.includes(value)?value:'unrecognized';
    issue.accountingDiagnostics={schemaVersion:1,reasons,modelMatches:data?.model===POLICY.model,
      inputTokens:tokenCounter(usage?.input_tokens)?usage.input_tokens:null,
      outputTokens:tokenCounter(usage?.output_tokens)?usage.output_tokens:null,
      cacheWriteTokens:tokenCounter(usage?.cache_creation_input_tokens)?usage.cache_creation_input_tokens:null,
      cacheReadTokens:tokenCounter(usage?.cache_read_input_tokens)?usage.cache_read_input_tokens:null,
      serviceTier:classify(usage?.service_tier,['standard','priority','batch']),
      speed:classify(usage?.speed,['standard','fast']),
      inferenceGeo:classify(usage?.inference_geo,['global','us']),
      unknownUsageFieldCount:record(usage)?Math.min(100,Object.keys(usage).filter(key=>!allowedUsage.has(key)).length):0};
    throw issue;
  }
  // No response text, request contents, headers, key or identifying account data
  // is ever copied into the persisted ledger.
  return {input_tokens: usage.input_tokens, output_tokens: usage.output_tokens};
}

export function createCampaignBudget({run, save, fetcher = globalThis.fetch, timeoutMs = 60000,policy=POLICY} = {}) {
  policy=trustedPolicy(policy);
  const ceilingMicroUsd=policy.ceilingUsd*1e6;
  const id = scope(run);
  if (typeof save !== 'function' || typeof fetcher !== 'function' ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
    fail('configuration', 'Budget accounting needs a synchronous save, fetch function and bounded timeout.');
  }
  if (live(run) && !run.billing) {
    fail('missing', 'This legacy live campaign has no durable budget. Start a new campaign before model execution.');
  }
  if (run.billing) validateLedger(run.billing, id,policy);

  let planned = [];
  const reserveBatch = requests => {
    if (!live(run) || active.has(id) || batches.has(id)) fail('busy', 'A campaign batch cannot overlap another request.');
    if (!Array.isArray(requests) || !requests.length || requests.length > 7) fail('batch_policy', 'Revision batches must contain one through seven bounded requests.');
    const bounds = requests.map(({url,options}) => ({...inspectRequest(url,options),requestHash:digest(options.body)}));
    const ledger = latest(run,policy);
    if (ledger.blockedReason || ledger.reservations.some(item => item.status !== 'completed')) fail('batch_blocked', 'Existing unresolved reservations block a new revision batch.');
    const total = bounds.reduce((sum,b) => sum+cost(b.inputUpperTokens,b.maxOutputTokens),0);
    // Retain room for a worst-case final critic; it reserves its own request later.
    const criticHeadroom = cost(POLICY.maxBodyBytes+POLICY.inputOverheadTokens,6144);
    if (ledger.reservations.reduce((sum,e)=>sum+e.reservedMicroUsd,0)+total+criticHeadroom>ceilingMicroUsd) fail('batch_ceiling','The entire revision batch plus final-review headroom cannot fit the remaining cap. No request was sent; do not retry without a new spending decision.');
    planned = bounds.map(b => ({id:randomUUID(),model:POLICY.model,status:'planned',plannedAt:new Date().toISOString(),...b,reservedMicroUsd:cost(b.inputUpperTokens,b.maxOutputTokens),actualMicroUsd:null,usage:null}));
    ledger.reservations.push(...planned);
    persist(run,ledger,save);
    planned = planned.map(e=>e.id);
    batches.add(id);
    return () => { batches.delete(id); planned=[]; };
  };
  const request = async ({url, options} = {}) => {
    if (!live(run)) fail('offline', 'Offline campaigns cannot make paid model requests.');
    const bounds = inspectRequest(url, options);
    if (options.signal?.aborted) fail('cancelled', 'The request was cancelled before reservation.');
    if (active.has(id)) fail('busy', 'Another request is already reserved for this campaign.');
    active.add(id);
    let ledger, entry, timer;
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const waitFor = async promise => {
      let cancel;
      try {
        if (signal.aborted) fail('uncertain', 'The provider request was interrupted. Reservation retained.');
        return await Promise.race([promise, new Promise((_, reject) => {
          cancel = () => reject(new CampaignBudgetError('uncertain', 'The provider request was interrupted. Reservation retained.'));
          signal.addEventListener('abort', cancel, {once: true});
        })]);
      } finally { if (cancel) signal.removeEventListener('abort', cancel); }
    };
    try {
      ledger = latest(run,policy);
      if (ledger.blockedReason === 'ceiling') fail('ceiling', 'This campaign reached its conservative spending boundary. Start a new campaign only with a new spending decision.');
      if (ledger.blockedReason || ledger.reservations.some(item => item.status !== 'completed' && !(item.status === 'planned' && planned.includes(item.id)))) {
        for (const item of ledger.reservations) if (item.status === 'started') item.status = 'uncertain';
        ledger.blockedReason ||= 'uncertain_request';
        persist(run, ledger, save);
        fail('uncertain', 'A prior request has an uncertain outcome. Further spending is blocked pending investigation.');
      }
      const prepaid = planned.length ? ledger.reservations.find(item=>item.id===planned[0]) : null;
      if (prepaid && (prepaid.status !== 'planned' || prepaid.requestHash !== digest(options.body))) fail('batch_mismatch','The request differs from its frozen prepaid batch. No provider request was sent.');
      const reservation = prepaid ? 0 : cost(bounds.inputUpperTokens, bounds.maxOutputTokens);
      const alreadyReserved = ledger.reservations.reduce((sum, item) => sum + item.reservedMicroUsd, 0);
      if (alreadyReserved + reservation > ceilingMicroUsd) {
        ledger.blockedReason = 'ceiling';
        persist(run, ledger, save);
        fail('ceiling', `This request would exceed the scoped $${policy.ceilingUsd} reservation ceiling.`);
      }
      entry = prepaid || {
        id: randomUUID(), model: POLICY.model, status: 'started', startedAt: new Date().toISOString(),
        ...bounds, reservedMicroUsd: reservation, actualMicroUsd: null, usage: null,
      };
      if (prepaid) { entry.status='started'; entry.startedAt=new Date().toISOString(); planned.shift(); } else ledger.reservations.push(entry);
      persist(run, ledger, save); // Must finish BEFORE fetcher is invoked.
      timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await waitFor(fetcher(url, {...options, signal}));
      const usage = await waitFor(responseUsage(response, signal));
      if (signal.aborted) fail('uncertain', 'Completion was interrupted before usage was checkpointed.');
      entry.usage = usage;
      entry.actualMicroUsd = cost(usage.input_tokens, usage.output_tokens);
      if (usage.input_tokens > bounds.inputUpperTokens || usage.output_tokens > bounds.maxOutputTokens ||
          entry.actualMicroUsd > entry.reservedMicroUsd) {
        fail('usage_bound', 'Reported usage exceeded its conservative reservation. Further requests are blocked.');
      }
      entry.status = 'completed';
      entry.completedAt = new Date().toISOString();
      persist(run, ledger, save);
      return response;
    } catch (error) {
      if (entry && entry.status !== 'persistence_failed') {
        entry.status = 'uncertain';
        if(error instanceof CampaignBudgetError && error.accountingDiagnostics)entry.accountingDiagnostics=structuredClone(error.accountingDiagnostics);
        ledger.blockedReason = 'uncertain_request';
        try { persist(run, ledger, save); }
        catch (persistError) { throw persistError; }
      }
      if (error instanceof CampaignBudgetError) throw error;
      fail('uncertain', 'Provider outcome or usage could not be verified. Reservation retained; further spending blocked.');
    } finally {
      clearTimeout(timer);
      if (entry?.status !== 'completed') controller.abort();
      active.delete(id);
    }
  };
  return {
    request,
    reserveBatch,
    fetcher: (url, options) => request({url, options}),
    status: () => descriptor(run, run.billing ? latest(run,policy) : null),
  };
}
