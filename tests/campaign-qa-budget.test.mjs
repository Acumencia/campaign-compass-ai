import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {CAMPAIGN_BUDGET_POLICY,createCampaignQABudgetPolicy,initializeCampaignBudget,createCampaignBudget,campaignBudgetStatus,extendCampaignQABudget,amendQAReviewAllowance,campaignModelCallAllowance} from '../server/campaign-budget.mjs';
const policy=()=>createCampaignQABudgetPolicy({ceilingUsd:5,authorizationId:'qa-rag-2026-10-25'});
const newRun=()=>({id:randomUUID(),mode:'live-grounded',budgets:{modelCalls:0},artifacts:[]});
const request={url:CAMPAIGN_BUDGET_POLICY.endpoint,options:{method:'POST',redirect:'error',headers:{'content-type':'application/json','anthropic-version':'2023-06-01','x-api-key':'mock-only-test'},body:JSON.stringify({model:CAMPAIGN_BUDGET_POLICY.model,system:'mock',messages:[{role:'user',content:'mock'}],output_config:{format:{type:'json_schema',schema:{type:'object'}}},max_tokens:6144,stream:false})}};
const response=()=>new Response(JSON.stringify({model:CAMPAIGN_BUDGET_POLICY.model,type:'message',role:'assistant',usage:{input_tokens:10,output_tokens:20}}),{headers:{'content-type':'application/json'}});
test('trusted isolated QA starts at five without changing global two dollar default',async()=>{
 const p=policy(),run=newRun(),snapshots=[],save=()=>snapshots.push(structuredClone(run));initializeCampaignBudget({run,save,newCampaign:true,policy:p});assert.equal(campaignBudgetStatus(run).ceilingUsd,5);assert.equal(CAMPAIGN_BUDGET_POLICY.ceilingUsd,2);assert.equal(run.billing.qaAuthorization.scope,'isolated-qa-work');
 const b=createCampaignBudget({run,save,policy:p,fetcher:async()=>response()});for(let i=0;i<16;i++)await b.request(request);assert.ok(b.status().reservedUsd>2);assert.ok(b.status().reservedUsd<5);
 const resumed=structuredClone(run);assert.equal(createCampaignBudget({run:resumed,save:()=>{},policy:policy(),fetcher:async()=>response()}).status().reservedUsd,b.status().reservedUsd);assert.ok(snapshots.length>16);
});
test('request-shaped policy objects and mismatched/default ledgers cannot upgrade authority',()=>{
 assert.throws(()=>createCampaignQABudgetPolicy({ceilingUsd:20,authorizationId:'qa-work-id'}));const p=policy(),run=newRun();initializeCampaignBudget({run,save:()=>{},newCampaign:true});const before=structuredClone(run.billing);
 assert.throws(()=>createCampaignBudget({run,save:()=>{},policy:p}),{code:'campaign_budget_ledger_invalid'});assert.throws(()=>initializeCampaignBudget({run,save:()=>{},newCampaign:true,policy:p}),{code:'campaign_budget_initialization'});assert.deepEqual(run.billing,before);
 assert.throws(()=>initializeCampaignBudget({run:newRun(),save:()=>{},newCampaign:true,policy:JSON.parse(JSON.stringify(p))}),/server-created/);
 const qa=newRun();initializeCampaignBudget({run:qa,save:()=>{},newCampaign:true,policy:p});assert.throws(()=>createCampaignBudget({run:qa,save:()=>{}}),{code:'campaign_budget_ledger_invalid'});qa.billing.ceilingMicroUsd=10_000_000;assert.throws(()=>campaignBudgetStatus(qa),{code:'campaign_budget_ledger_invalid'});
});
test('explicit conditional QA extension preserves reservations with audited five to ten change',async()=>{
 const p=policy(),larger=createCampaignQABudgetPolicy({ceilingUsd:10,authorizationId:'qa-rag-2026-10-25'}),run=newRun(),save=()=>{};
 assert.throws(()=>initializeCampaignBudget({run:newRun(),save,newCampaign:true,policy:larger}),{code:'campaign_budget_initialization'});initializeCampaignBudget({run,save,newCampaign:true,policy:p});const b=createCampaignBudget({run,save,policy:p,fetcher:async()=>response()});await b.request(request);const reserved=b.status().reservedUsd;
 const status=extendCampaignQABudget({run,save,policy:p,extendedPolicy:larger});assert.equal(status.ceilingUsd,10);assert.equal(status.reservedUsd,reserved);assert.equal(run.billing.qaAuthorization.amendments.length,1);assert.equal(createCampaignBudget({run,save,policy:larger}).status().ceilingUsd,10);assert.throws(()=>createCampaignBudget({run,save,policy:p}),{code:'campaign_budget_ledger_invalid'});
});
test('uncertain outcomes cannot be reset or bypassed by a QA extension',async()=>{
 const p=policy(),run=newRun(),save=()=>{};initializeCampaignBudget({run,save,newCampaign:true,policy:p});let calls=0;const b=createCampaignBudget({run,save,policy:p,fetcher:async()=>{calls++;throw Error('mock failure');}});await assert.rejects(b.request(request),{code:'campaign_budget_uncertain'});const before=structuredClone(run.billing);
 assert.throws(()=>extendCampaignQABudget({run,save,policy:p,extendedPolicy:createCampaignQABudgetPolicy({ceilingUsd:10,authorizationId:'qa-rag-2026-10-25'})}),{code:'campaign_budget_extension_blocked'});assert.deepEqual(run.billing,before);await assert.rejects(b.request(request),{code:'campaign_budget_uncertain'});assert.equal(calls,1);
});

test('only matching trusted QA capability permits twenty-four model calls; normal persisted inflation stays twelve',async()=>{
 const {createBudgetedCampaignGeneration}=await import('../server/campaign-runtime.mjs');
 const api={status:()=>({provider:'anthropic',generationModel:CAMPAIGN_BUDGET_POLICY.model,generationConfigured:true,keyPresent:true}),generation:{withTransport:()=>({generateStructured:async()=>{throw Error('No requests in this test');}})}};
 const qa=newRun(),p=policy(),save=()=>{};qa.budgets.maxModelCalls=24;initializeCampaignBudget({run:qa,save,newCampaign:true,policy:p});assert.equal(p.maxModelCalls,24);assert.equal(qa.billing.qaAuthorization.maxModelCalls,24);
 qa.budgets.modelCalls=6;const generator=createBudgetedCampaignGeneration({run:qa,save,api,policy:p});assert.equal(generator.status().maxCalls,18);
 const normal=newRun();normal.budgets.maxModelCalls=24;initializeCampaignBudget({run:normal,save,newCampaign:true});assert.equal(createBudgetedCampaignGeneration({run:normal,save,api}).status().maxCalls,12);normal.budgets.modelCalls=12;assert.throws(()=>createBudgetedCampaignGeneration({run:normal,save,api}),{code:'campaign_model_budget'});
 assert.throws(()=>createBudgetedCampaignGeneration({run:qa,save,api,policy:{...p}}),/server-created/);qa.budgets.modelCalls=24;assert.throws(()=>createBudgetedCampaignGeneration({run:qa,save,api,policy:p}),{code:'campaign_model_budget'});
});

async function completedQA() {
 const run=newRun(),p=policy(),save=()=>{},extended=createCampaignQABudgetPolicy({ceilingUsd:10,authorizationId:p.authorizationId});
 initializeCampaignBudget({run,save,newCampaign:true,policy:p});
 const b=createCampaignBudget({run,save,policy:p,fetcher:async()=>response()});
 for(let i=0;i<24;i++)await b.request(request);
 extendCampaignQABudget({run,save,policy:p,extendedPolicy:extended});
 run.budgets={modelCalls:24,maxModelCalls:24};run.revisionCount=2;run.status='needs_revision';
 return {run,save,policy:extended};
}
test('one-time QA review allowance preserves spending and history and survives serialized resume',async()=>{
 const ctx=await completedQA(),before=structuredClone(ctx.run),snapshots=[];
 const status=amendQAReviewAllowance({...ctx,save:()=>snapshots.push(structuredClone(ctx.run))});
 assert.equal(status.maxModelCalls,28);assert.equal(status.ceilingUsd,10);
 assert.deepEqual(ctx.run.billing.reservations,before.billing.reservations);
 assert.equal(status.reservedUsd,campaignBudgetStatus(before).reservedUsd);
 assert.equal(status.knownActualUsd,campaignBudgetStatus(before).knownActualUsd);
 assert.equal(ctx.run.budgets.modelCalls,24);assert.equal(ctx.run.revisionCount,2);
 assert.equal(snapshots.length,1);assert.equal(snapshots[0].budgets.maxModelCalls,28);
 const resumed=JSON.parse(JSON.stringify(ctx.run));assert.equal(campaignModelCallAllowance({run:resumed,policy:ctx.policy}),28);
 const {createBudgetedCampaignGeneration}=await import('../server/campaign-runtime.mjs');
 const api={status:()=>({provider:'anthropic',generationModel:CAMPAIGN_BUDGET_POLICY.model,generationConfigured:true,keyPresent:true}),generation:{withTransport:()=>({generateStructured:async()=>{throw Error('No requests');}})}};
 assert.equal(createBudgetedCampaignGeneration({...ctx,run:resumed,api}).status().maxCalls,4);
 assert.throws(()=>amendQAReviewAllowance(ctx),{code:'campaign_budget_allowance'});
 assert.equal(ctx.policy.maxModelCalls,24);
 resumed.billing.qaAuthorization.callAllowanceAmendment.to=32;
 assert.throws(()=>campaignBudgetStatus(resumed),{code:'campaign_budget_ledger_invalid'});
});
test('QA review allowance rejects default, five-dollar, wrong authorization and unresolved work',async()=>{
 const normal=newRun();initializeCampaignBudget({run:normal,save:()=>{},newCampaign:true});
 assert.throws(()=>amendQAReviewAllowance({run:normal,save:()=>{},policy:CAMPAIGN_BUDGET_POLICY}),{code:'campaign_budget_allowance'});
 const five=newRun(),p=policy();initializeCampaignBudget({run:five,save:()=>{},newCampaign:true,policy:p});
 assert.throws(()=>amendQAReviewAllowance({run:five,save:()=>{},policy:p}),{code:'campaign_budget_allowance'});
 const ctx=await completedQA();
 assert.throws(()=>amendQAReviewAllowance({...ctx,policy:createCampaignQABudgetPolicy({ceilingUsd:10,authorizationId:'different-qa-id'})}),{code:'campaign_budget_ledger_invalid'});
 for(const state of ['pending','uncertain','planned']){
  const run=structuredClone(ctx.run);if(state==='pending')run.pendingOperation=true;else {run.billing.reservations[0].status=state;if(state==='planned')run.billing.reservations[0].requestHash='a'.repeat(64);}
  const before=structuredClone(run);
  assert.throws(()=>amendQAReviewAllowance({...ctx,run}),{code:'campaign_budget_allowance_blocked'});
  assert.deepEqual(run,before);
 }
 const inflated=structuredClone(ctx.run);inflated.budgets.maxModelCalls=28;
 assert.equal(campaignModelCallAllowance({...ctx,run:inflated}),24);
});
