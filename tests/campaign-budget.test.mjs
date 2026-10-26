import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  CAMPAIGN_BUDGET_POLICY as POLICY,
  initializeCampaignBudget, createCampaignBudget, campaignBudgetStatus,
} from '../server/campaign-budget.mjs';

const body = (changes = {}) => ({
  model: POLICY.model,
  system: 'A bounded test-only writer.',
  messages: [{role: 'user', content: 'A synthetic request; no provider calls.'}],
  output_config: {format: {type: 'json_schema', schema: {type: 'object'}}},
  max_tokens: 6144,
  stream: false,
  ...changes,
});
const request = (changes = {}) => ({
  url: POLICY.endpoint,
  options: {
    method: 'POST', redirect: 'error',
    headers: {'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': 'synthetic-test-key-never-sent'},
    body: JSON.stringify(body()),
  },
  ...changes,
});
const response = (changes = {}, responseOptions = {}) => new Response(JSON.stringify({
  type: 'message', role: 'assistant', model: POLICY.model,
  content: [{type: 'text', text: 'Private output must not enter the budget ledger.'}],
  usage: {input_tokens: 100, output_tokens: 50},
  ...changes,
}), {status: 200, headers: {'content-type': 'application/json'}, ...responseOptions});

function fixture(options = {}) {
  const run = {id: randomUUID(), mode: 'live-grounded', budgets: {modelCalls: 0}, artifacts: []};
  const snapshots = [];
  const save = () => snapshots.push(structuredClone(run));
  initializeCampaignBudget({run, save, newCampaign: true});
  return {run, save, snapshots, budget: createCampaignBudget({run, save, fetcher: async () => response(), ...options})};
}

test('reservation is durably saved before fetch; actual usage never refunds the upper bound', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cc-budget-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const filename = path.join(directory, 'checkpoint.json');
  const run = {id: randomUUID(), mode: 'live-grounded', budgets: {modelCalls: 0}, artifacts: []};
  const save = () => writeFileSync(filename, JSON.stringify(run));
  initializeCampaignBudget({run, save, newCampaign: true});
  let calls = 0;
  const budget = createCampaignBudget({run, save, fetcher: async () => {
    calls++;
    const persisted = JSON.parse(readFileSync(filename, 'utf8'));
    assert.equal(persisted.billing.reservations.length, 1);
    assert.equal(persisted.billing.reservations[0].status, 'started');
    assert.ok(persisted.billing.reservations[0].reservedMicroUsd > 0);
    const status = campaignBudgetStatus(run);
    assert.equal(status.pending, true);
    assert.equal(status.uncertain, false);
    assert.equal(status.blockedReason, null);
    return response();
  }});
  const result = await budget.request(request());
  assert.equal(result.status, 200);
  assert.equal((await result.json()).role, 'assistant', 'Original response remains readable for the provider adapter');
  const status = budget.status();
  const bytes = Buffer.byteLength(request().options.body);
  assert.equal(status.reservedUsd, ((bytes + 4096) * 4 + 6144 * 20) / 1_000_000);
  assert.equal(status.knownActualUsd, (100 * 4 + 50 * 20) / 1_000_000);
  assert.equal(status.remainingUsd, 2 - status.reservedUsd);
  assert.equal(status.pending, false);
  assert.equal(status.callCount, 1);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(run.billing).includes('Private output'), false);
  assert.equal(JSON.stringify(run.billing).includes('synthetic-test-key'), false);
  assert.deepEqual(run.billing.reservations[0].usage, {input_tokens: 100, output_tokens: 50});
  const restored = JSON.parse(readFileSync(filename, 'utf8'));
  const next = createCampaignBudget({run: restored, save: () => writeFileSync(filename, JSON.stringify(restored)), fetcher: async () => response()});
  await next.request(request());
  assert.equal(next.status().callCount, 2);
  assert.equal(next.status().reservedUsd, status.reservedUsd * 2);
});

test('public status is pure and initialization cannot reset an existing or legacy live campaign', () => {
  const {run, snapshots} = fixture();
  const before = JSON.stringify(run);
  const count = snapshots.length;
  const first = campaignBudgetStatus(run), second = campaignBudgetStatus(run);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(run), before);
  assert.equal(snapshots.length, count);
  assert.throws(() => initializeCampaignBudget({run, save: () => {}, newCampaign: true}), {code: 'campaign_budget_initialization'});
  const legacy = {id: randomUUID(), mode: 'live-grounded', budgets: {modelCalls: 2}, artifacts: [{}]};
  assert.throws(() => createCampaignBudget({run: legacy, save: () => {}}), {code: 'campaign_budget_missing'});
  assert.throws(() => initializeCampaignBudget({run: legacy, save: () => {}, newCampaign: true}), {code: 'campaign_budget_initialization'});
  const fresh = {id: randomUUID(), mode: 'live-grounded', artifacts: []};
  assert.throws(() => initializeCampaignBudget({run: fresh, save: () => {}}), {code: 'campaign_budget_initialization'});
});

test('offline campaigns remain unaffected and cannot route paid calls', async () => {
  const run = {id: randomUUID(), mode: 'offline-template'};
  let saves = 0, calls = 0;
  initializeCampaignBudget({run, save: () => saves++, newCampaign: true});
  assert.equal(run.billing, undefined);
  const budget = createCampaignBudget({run, save: () => saves++, fetcher: async () => { calls++;return response(); }});
  assert.equal(budget.status().enabled, false);
  await assert.rejects(budget.request(request()), {code: 'campaign_budget_offline'});
  assert.equal(saves, 0);
  assert.equal(calls, 0);
});

test('all reservations count toward $2; hitting the boundary durably blocks smaller retries too', async () => {
  let calls = 0;
  const {run, budget} = fixture({fetcher: async () => { calls++;return response(); }});
  const large = request();
  large.options.body = JSON.stringify(body({system: 'x'.repeat(44000)}));
  for (;;) {
    try { await budget.request(large); }
    catch (error) { assert.equal(error.code, 'campaign_budget_ceiling');break; }
  }
  assert.ok(calls > 1);
  const status = budget.status();
  assert.ok(status.reservedUsd <= 2);
  assert.equal(status.blockedReason, 'ceiling');
  assert.equal(status.callCount, calls);
  const small = request();small.options.body = JSON.stringify(body({max_tokens: 2048}));
  await assert.rejects(budget.request(small), {code: 'campaign_budget_ceiling'});
  assert.equal(budget.status().callCount, calls);
  assert.equal(run.billing.blockedReason, 'ceiling');
});

test('concurrent wrappers serialize a run and stale run objects cannot reset spend', async () => {
  let release, calls = 0;
  const {run, save, budget} = fixture({fetcher: () => { calls++;return new Promise(resolve => { release = () => resolve(response()); }); }});
  const stale = structuredClone(run);
  const other = createCampaignBudget({run: stale, save: () => {}, fetcher: async () => { calls++;return response(); }});
  const pending = budget.request(request());
  await assert.rejects(other.request(request()), {code: 'campaign_budget_busy'});
  assert.equal(calls, 1);
  assert.equal(campaignBudgetStatus(run).pending, true);
  release();await pending;
  const spent = budget.status().reservedUsd;
  await other.request(request());
  assert.equal(other.status().callCount, 2);
  assert.equal(other.status().reservedUsd, spent * 2);
  const latest = createCampaignBudget({run, save, fetcher: async () => response()});
  await latest.request(request());
  assert.equal(latest.status().callCount, 3);
});

test('network uncertainty is durable, never refunded and prevents automatic or explicit retry', async () => {
  let calls = 0;
  const {run, budget} = fixture({fetcher: async () => { calls++;throw new Error('Synthetic network failure'); }});
  await assert.rejects(budget.request(request()), {code: 'campaign_budget_uncertain'});
  const reserved = budget.status().reservedUsd;
  assert.ok(reserved > 0);
  assert.equal(budget.status().uncertain, true);
  assert.equal(budget.status().blockedReason, 'uncertain_request');
  const restored = structuredClone(run);
  const resumed = createCampaignBudget({run: restored, save: () => {}, fetcher: async () => { calls++;return response(); }});
  await assert.rejects(resumed.request(request()), {code: 'campaign_budget_uncertain'});
  assert.equal(calls, 1);
  assert.equal(resumed.status().reservedUsd, reserved);
});

test('an orphaned started reservation is uncertain after restart, not a fresh allowance', async () => {
  const {run} = fixture();
  const bytes = Buffer.byteLength(request().options.body);
  run.billing.reservations.push({id: randomUUID(), status: 'started', model: POLICY.model,
    bodyBytes: bytes, inputUpperTokens: bytes + 4096, maxOutputTokens: 6144,
    reservedMicroUsd: (bytes + 4096) * 4 + 6144 * 20, actualMicroUsd: null, usage: null});
  run.billing.revision++;
  const before = JSON.stringify(run);
  assert.equal(campaignBudgetStatus(run).uncertain, true);
  assert.equal(campaignBudgetStatus(run).pending, false);
  assert.equal(JSON.stringify(run), before, 'Status does not mutate the restart checkpoint');
  let calls = 0;
  const budget = createCampaignBudget({run, save: () => {}, fetcher: async () => { calls++;return response(); }});
  await assert.rejects(budget.request(request()), {code: 'campaign_budget_uncertain'});
  assert.equal(run.billing.reservations[0].status, 'uncertain');
  assert.equal(calls, 0);
});

test('aborted or timed out requests keep their reservation; late completion cannot clear the block', async () => {
  let complete;
  const {run, budget} = fixture({timeoutMs: 10, fetcher: () => new Promise(resolve => { complete = () => resolve(response()); })});
  await assert.rejects(budget.request(request()), {code: 'campaign_budget_uncertain'});
  complete();await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(run.billing.reservations[0].status, 'uncertain');
  assert.equal(budget.status().knownActualUsd, 0);
  await assert.rejects(budget.request(request()), {code: 'campaign_budget_uncertain'});
  const before = fixture();const controller = new AbortController();controller.abort();
  const input = request();input.options.signal = controller.signal;
  await assert.rejects(before.budget.request(input), {code: 'campaign_budget_cancelled'});
  assert.equal(before.budget.status().reservedUsd, 0);
});

test('fixed request policy rejects pricing modifiers, alternate routes and unsupported models before reservation', async () => {
  const cases = [];
  for (const changes of [
    {model: 'claude-other'}, {max_tokens: 8192}, {max_tokens: 128}, {stream: true},
    {service_tier: 'priority'}, {thinking: {type: 'enabled', budget_tokens: 2000}},
    {inference_geo: 'us'}, {messages: [{role: 'user', content: [{type: 'text', text: 'cached', cache_control: {type: 'ephemeral'}}]}]},
  ]) { const input = request();input.options.body = JSON.stringify(body(changes));cases.push(input); }
  for (const url of ['https://api.anthropic.com/v1/messages?tier=fast', 'https://other.invalid/v1/messages', 'http://api.anthropic.com/v1/messages']) cases.push(request({url}));
  for (const name of ['anthropic-beta', 'x-service-tier', 'anthropic-dangerous-direct-browser-access']) {
    const input = request();input.options.headers[name] = 'nonstandard';cases.push(input);
  }
  const redirected = request();redirected.options.redirect = 'follow';cases.push(redirected);
  const dispatcher = request();dispatcher.options.dispatcher = {};cases.push(dispatcher);
  for (const input of cases) {
    let calls = 0;const {budget} = fixture({fetcher: async () => { calls++;return response(); }});
    await assert.rejects(budget.request(input), {code: 'campaign_budget_request_policy'});
    assert.equal(calls, 0);assert.equal(budget.status().callCount, 0);
  }
});

test('UTF-8 bytes and canonical JSON are bounded before reservation; reviewed 2048-token cap is accepted', async () => {
  const {budget} = fixture();
  const oversized = request();oversized.options.body = JSON.stringify(body({system: 'é'.repeat(23000)}));
  await assert.rejects(budget.request(oversized), {code: 'campaign_budget_body_size'});
  for (const serialized of ['{', JSON.stringify(body(), null, 2), request().options.body.replace('"stream":false', '"model":"claude-other","stream":false')]) {
    const input = request();input.options.body = serialized;
    await assert.rejects(budget.request(input), {code: 'campaign_budget_request_policy'});
  }
  assert.equal(budget.status().callCount, 0);
  const short = request();short.options.body = JSON.stringify(body({max_tokens: 2048}));
  await budget.fetcher(short.url, short.options);
  assert.equal(budget.status().callCount, 1);
});

test('missing, malformed or nonstandard priced usage keeps spend reserved and blocks continuation', async () => {
  const cases = [
    () => response({usage: undefined}),
    () => response({usage: {input_tokens: '100', output_tokens: 50}}),
    () => response({usage: {input_tokens: -1, output_tokens: 50}}),
    () => response({usage: {input_tokens: 100, output_tokens: 50, service_tier: 'priority'}}),
    () => response({usage: {input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10}}),
    () => response({usage: {input_tokens: 100, output_tokens: 50, server_tool_use: {web_search_requests: 1}}}),
    () => response({model: 'different-model'}),
    () => response({}, {status: 429}),
    () => new Response('invalid-json', {headers: {'content-type': 'application/json'}}),
    () => response({}, {headers: {'content-type': 'text/plain'}}),
  ];
  for (const makeResponse of cases) {
    const {budget} = fixture({fetcher: async () => makeResponse()});
    await assert.rejects(budget.request(request()), {code: 'campaign_budget_uncertain'});
    assert.equal(budget.status().uncertain, true);
    assert.ok(budget.status().reservedUsd > 0);
    assert.equal(budget.status().knownActualUsd, 0);
  }
});

test('actual usage beyond the conservative bound is retained numerically and blocks spending', async () => {
  const {run, budget} = fixture({fetcher: async () => response({usage: {input_tokens: 50000, output_tokens: 6145}})});
  await assert.rejects(budget.request(request()), {code: 'campaign_budget_usage_bound'});
  assert.equal(budget.status().knownActualUsd, (50000 * 4 + 6145 * 20) / 1_000_000);
  assert.equal(budget.status().uncertain, true);
  assert.deepEqual(run.billing.reservations[0].usage, {input_tokens: 50000, output_tokens: 6145});
  await assert.rejects(budget.request(request()), {code: 'campaign_budget_uncertain'});
});

test('synchronous persistence is mandatory and a failed pre-request checkpoint never invokes fetch', async () => {
  const {run} = fixture();let calls = 0;
  const failed = createCampaignBudget({run, save: () => { throw new Error('Synthetic disk error'); }, fetcher: async () => { calls++;return response(); }});
  await assert.rejects(failed.request(request()), {code: 'campaign_budget_persistence'});
  assert.equal(calls, 0);
  assert.equal(failed.status().uncertain, true);
  const next = fixture();const asyncSave = createCampaignBudget({run: next.run, save: async () => {}, fetcher: async () => { calls++;return response(); }});
  await assert.rejects(asyncSave.request(request()), {code: 'campaign_budget_persistence'});
  assert.equal(calls, 0);
});

test('malformed persisted policy or reservation amounts cannot restore a fresh allowance', () => {
  const {run} = fixture();
  for (const alter of [ledger => { ledger.model = 'another-model'; }, ledger => { ledger.ceilingMicroUsd = 3_000_000; }, ledger => { ledger.inputMicroUsdPerToken = 1; }]) {
    const changed = structuredClone(run);alter(changed.billing);
    assert.throws(() => createCampaignBudget({run: changed, save: () => {}}), {code: 'campaign_budget_ledger_invalid'});
  }
});

test('unknown usage categories fail closed; only all-zero numeric auxiliary counters are accepted', async () => {
 const invalid = [
  {new_billable_tokens: 1}, {unknown_metadata: 'not priced'},
  {cache_creation: {ephemeral_5m_input_tokens: 1}},
  {cache_creation: {ephemeral_5m_input_tokens: '0'}},
  {server_tool_use: {web_search_requests: 0, currency: 'USD'}},
  {server_tool_use: {unexpected_counter:0}}, {cache_creation: []}, {speed: 'fast'},
 ];
 for (const extras of invalid) {
  const {budget} = fixture({fetcher: async () => response({usage: {input_tokens:100, output_tokens:50, ...extras}})});
  await assert.rejects(budget.request(request()), {code:'campaign_budget_uncertain'});
  assert.equal(budget.status().uncertain, true);
  assert.equal(budget.status().knownActualUsd, 0);
 }
 const {run,budget} = fixture({fetcher: async () => response({usage:{input_tokens:100,output_tokens:50,cache_creation_input_tokens:0,cache_read_input_tokens:0,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0},server_tool_use:{web_search_requests:0,web_fetch_requests:0},service_tier:'standard',speed:'standard'}})});
 await budget.request(request());
 assert.equal(budget.status().uncertain,false);
 assert.deepEqual(run.billing.reservations[0].usage,{input_tokens:100,output_tokens:50});
});

test('current documented nullable metadata and inclusive output breakdown use unchanged standard pricing',async()=>{
 for(const extras of [
  {cache_creation:null,cache_creation_input_tokens:null,cache_read_input_tokens:null,server_tool_use:null,service_tier:null,speed:null,inference_geo:null,output_tokens_details:null},
  {inference_geo:'global',output_tokens_details:{thinking_tokens:30},service_tier:'standard',speed:'standard'}
 ]){
  const {run,budget}=fixture({fetcher:async()=>response({usage:{input_tokens:100,output_tokens:50,...extras}})});
  await budget.request(request());assert.equal(budget.status().knownActualUsd,0.0014);assert.equal(budget.status().uncertain,false);
  assert.deepEqual(run.billing.reservations[0].usage,{input_tokens:100,output_tokens:50});
 }
});

test('invalid metadata and unknown prices retain sanitized observations without inventing actual charges',async()=>{
 const cases=[
  [{usage:null},'usage_missing_or_invalid'],
  [{usage:{input_tokens:null,output_tokens:50}},'invalid_token_totals'],
  [{usage:{input_tokens:'100',output_tokens:50}},'invalid_token_totals'],
  [{usage:{input_tokens:-1,output_tokens:50}},'invalid_token_totals'],
  [{model:'claude-opus-5-5-version-other'},'model_mismatch'],
  [{usage:{input_tokens:100,output_tokens:50,inference_geo:'us'}},'nonstandard_geography'],
  [{usage:{input_tokens:100,output_tokens:50,speed:'fast'}},'nonstandard_speed'],
  [{usage:{input_tokens:100,output_tokens:50,service_tier:'priority'}},'nonstandard_service_tier'],
  [{usage:{input_tokens:100,output_tokens:50,cache_creation_input_tokens:1}},'cache_tokens_not_zero'],
  [{usage:{input_tokens:100,output_tokens:50,cache_read_input_tokens:1}},'cache_tokens_not_zero'],
  [{usage:{input_tokens:100,output_tokens:50,output_tokens_details:{thinking_tokens:51}}},'invalid_output_breakdown'],
  [{usage:{input_tokens:100,output_tokens:50,output_tokens_details:{thinking_tokens:10,extra:0}}},'invalid_output_breakdown'],
  [{usage:{input_tokens:100,output_tokens:50,'secret-field-name':'SECRET_VALUE',speed:'SECRET_VALUE'}},'unknown_usage_fields'],
 ];
 for(const [change,reason]of cases){
  let calls=0;const {run,budget}=fixture({fetcher:async()=>{calls++;return response(change);}});
  await assert.rejects(budget.request(request()),{code:'campaign_budget_uncertain'});
  const entry=run.billing.reservations[0];assert.ok(entry.accountingDiagnostics.reasons.includes(reason));assert.equal(entry.actualMicroUsd,null);assert.equal(entry.usage,null);
  assert.equal(budget.status().knownActualUsd,0);assert.ok(budget.status().reservedUsd>0);
  assert.doesNotMatch(JSON.stringify(entry),/SECRET_VALUE|secret-field-name|Private output/);
  await assert.rejects(budget.request(request()),{code:'campaign_budget_uncertain'});assert.equal(calls,1);
  const restored=createCampaignBudget({run:structuredClone(run),save:()=>{},fetcher:async()=>{throw Error('Must not retry');}});
  assert.equal(restored.status().uncertain,true);
 }
});

test('whole revision batch is persisted before transport and consumed without double reservation', async()=>{
 let calls=0;let f;f=fixture({fetcher:async()=>{calls++;assert.equal(f.run.billing.reservations.length,2);assert.ok(f.run.billing.reservations.every(e=>e.reservedMicroUsd>0));return response();}});
 const release=f.budget.reserveBatch([request(),request()]);const total=f.budget.status().reservedUsd;
 assert.equal(calls,0);assert.equal(f.budget.status().plannedCalls,2);
 await f.budget.request(request());await f.budget.request(request());release();
 assert.equal(calls,2);assert.equal(f.budget.status().reservedUsd,total);assert.equal(f.budget.status().blockedReason,null);
});
test('batch refuses cumulative ceiling before any partial reservation or transport',async()=>{
 const f=fixture();const huge=request({options:{...request().options,body:JSON.stringify(body({system:'x'.repeat(44000)}))}});
 assert.throws(()=>f.budget.reserveBatch(Array(7).fill(huge)),{code:'campaign_budget_batch_ceiling'});assert.equal(f.run.billing.reservations.length,0);
});
test('partial or mismatched frozen batch retains unspent bounds and blocks fresh requests',async()=>{
 const f=fixture();const release=f.budget.reserveBatch([request(),request()]);const total=f.budget.status().reservedUsd;
 await f.budget.request(request());release();assert.equal(f.budget.status().blockedReason,'incomplete_batch');assert.equal(f.budget.status().reservedUsd,total);
 await assert.rejects(f.budget.request(request()),{code:'campaign_budget_uncertain'});
 const g=fixture();const done=g.budget.reserveBatch([request()]);await assert.rejects(g.budget.request(request({options:{...request().options,body:JSON.stringify(body({system:'Changed'}))}})),{code:'campaign_budget_batch_mismatch'});done();assert.equal(g.budget.status().callCount,0);
});

test('runtime derives exhausted call allowance from dispatched ledger after stale outer counter',async()=>{
 const {createBudgetedCampaignGeneration}=await import('../server/campaign-runtime.mjs');const f=fixture();
 for(let i=0;i<12;i++)await f.budget.request(request());
 const api={status:()=>({provider:'anthropic',generationModel:POLICY.model,generationConfigured:true,keyPresent:true}),generation:{withTransport:()=>({})}};
 assert.equal(f.run.budgets.modelCalls,0);
 assert.throws(()=>createBudgetedCampaignGeneration({run:f.run,save:f.save,api}),{code:'campaign_model_budget'});
});
