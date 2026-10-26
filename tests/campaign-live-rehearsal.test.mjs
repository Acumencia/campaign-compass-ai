import test from 'node:test';
import assert from 'node:assert/strict';
import {createRehearsalBudget,parseRehearsalArgs,REHEARSAL_POLICY} from '../scripts/campaign-live-rehearsal.mjs';
const body={model:'claude-opus-5-5',system:'mock-only',messages:[{role:'user',content:'mock'}],output_config:{format:{type:'json_schema',schema:{type:'object'}}},max_tokens:2048,stream:false};
const options={method:'POST',redirect:'error',body:JSON.stringify(body)};
const endpoint='https://api.anthropic.com/v1/messages';
test('dry run blocks fetch and live requires explicit approved cap',async()=>{
 let calls=0;const dry=createRehearsalBudget({fetcher:async()=>{calls++;}});await assert.rejects(dry.fetcher(endpoint,options),{code:'dry_run_network_blocked'});assert.equal(calls,0);
 for(const budgetUsd of [undefined,0,-1,2.1,NaN])assert.throws(()=>createRehearsalBudget({execute:true,budgetUsd}),{code:'explicit_budget_required'});
 assert.deepEqual(parseRehearsalArgs([]),{});assert.throws(()=>parseRehearsalArgs(['--execute','--max-spend-usd']),{code:'missing_argument'});
});
test('pre-call budget blocks unpriced model endpoint oversized input and excessive cost before fetch',async()=>{
 let calls=0;const b=createRehearsalBudget({execute:true,budgetUsd:0.01,fetcher:async()=>{calls++;}});await assert.rejects(b.fetcher(endpoint,options),{code:'spend_budget'});assert.equal(calls,0);
 const guard=createRehearsalBudget({execute:true,budgetUsd:2,fetcher:async()=>{calls++;}});await assert.rejects(guard.fetcher('https://not-approved.invalid',options),{code:'endpoint_blocked'});assert.throws(()=>guard.reserve({...body,model:'unknown'}),{code:'unpriced_request'});assert.throws(()=>guard.reserve({...body,max_tokens:4096}),{code:'unpriced_request'});assert.throws(()=>guard.reserve({...body,system:'x'.repeat(45000)}),{code:'request_size_budget'});assert.equal(calls,0);
});
test('eight-call limit, full output reservation and safe numeric usage are recorded',async()=>{
 let calls=0;const g=createRehearsalBudget({execute:true,budgetUsd:2,fetcher:async()=>{calls++;return new Response(JSON.stringify({usage:{input_tokens:4,output_tokens:8},content:[{text:'not logged'}]}),{headers:{'Content-Type':'application/json'}});}});
 for(let i=0;i<8;i++)await g.fetcher(endpoint,options);await assert.rejects(g.fetcher(endpoint,options),{code:'call_budget'});assert.equal(calls,8);const report=g.report();assert.equal(report.records[0].outputTokenCap,2048);assert.deepEqual(report.records[0].usage,{input_tokens:4,output_tokens:8});assert.ok(report.reservedUpperUsd<2);assert.equal(JSON.stringify(report).includes('not logged'),false);assert.equal(REHEARSAL_POLICY.maxCalls,8);
});
test('uncertain transport outcome forbids all later calls and keeps full reservation',async()=>{
 let calls=0;const g=createRehearsalBudget({execute:true,budgetUsd:2,fetcher:async()=>{calls++;throw Error('sensitive upstream text');}});await assert.rejects(g.fetcher(endpoint,options),{code:'outcome_uncertain'});await assert.rejects(g.fetcher(endpoint,options),{code:'outcome_uncertain'});assert.equal(calls,1);assert.equal(g.report().uncertain,true);assert.ok(g.report().reservedUpperUsd>0);assert.equal(JSON.stringify(g.report()).includes('sensitive'),false);
});

test('regional, caching and beta pricing modifiers cannot bypass the pre-call ceiling',async()=>{
 let calls=0;const guard=createRehearsalBudget({execute:true,budgetUsd:2,fetcher:async()=>{calls++;}});
 for(const extra of [{inference_geo:'us'},{speed:'fast'},{service_tier:'priority'}])assert.throws(()=>guard.reserve({...body,...extra}),{code:'unpriced_request'});
 assert.throws(()=>guard.reserve({...body,messages:[{role:'user',content:[{type:'text',text:'mock',cache_control:{type:'ephemeral'}}]}]}),{code:'unpriced_request'});
 await assert.rejects(guard.fetcher(endpoint,{...options,headers:{'anthropic-beta':'fast-mode'}}),{code:'unpriced_request'});assert.equal(calls,0);
});

test('continuation carries original reservation and call count into larger transient output cap',async()=>{
 const prior={call:1,reservedUpperUsd:0.142196,outcome:'response-received',outputTokenCap:2048};let calls=0;
 const guard=createRehearsalBudget({execute:true,budgetUsd:2,maxOutputTokens:6144,priorRecords:[prior],fetcher:async()=>{calls++;return new Response(JSON.stringify({usage:{input_tokens:20,output_tokens:30}}));}});
 for(let i=0;i<7;i++)await guard.fetcher(endpoint,{...options,body:JSON.stringify({...body,max_tokens:6144})});
 await assert.rejects(guard.fetcher(endpoint,{...options,body:JSON.stringify({...body,max_tokens:6144})}),{code:'call_budget'});
 assert.equal(calls,7);assert.equal(guard.report().records.length,8);assert.equal(guard.report().records[0].reservedUpperUsd,0.142196);assert.equal(guard.report().records[1].outputTokenCap,6144);assert.ok(guard.report().reservedUpperUsd>0.142196);
});
