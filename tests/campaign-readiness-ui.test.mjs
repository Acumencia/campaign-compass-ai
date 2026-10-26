import test from 'node:test';
import assert from 'node:assert/strict';
import {retrievalReadinessBlock,observedRetrieval} from '../src/campaign-readiness.mjs';
test('live retrieval gating fails closed separately from provider readiness',()=>{
 const modelReady={configured:true,consent:true,keyPresent:true};assert.match(retrievalReadinessBlock(modelReady),/unavailable/);
 assert.match(retrievalReadinessBlock({...modelReady,retrieval:{configured:false,authorized:true}}),/not configured/);
 assert.match(retrievalReadinessBlock({...modelReady,retrieval:{configured:true,authorized:false}}),/not authorized/);
 assert.match(retrievalReadinessBlock({...modelReady,retrieval:{configured:true,authorized:true,blocked:'index unavailable'}}),/index unavailable/);
 assert.equal(retrievalReadinessBlock({...modelReady,retrieval:{configured:true,authorized:true,backend:'fixture-vector',method:'semantic-vector'}}),'');
});
test('saved lexical method remains lexical and no method is inferred from live mode or current settings',()=>{
 const saved={mode:'live-grounded',brandEvidence:{method:'lexical',backend:'local-files'}};const original=structuredClone(saved);assert.deepEqual(observedRetrieval(saved),{method:'lexical',backend:'local-files',scope:'Recorded brand retrieval in this saved run'});assert.deepEqual(saved,original);
 assert.equal(observedRetrieval({mode:'live-grounded'}).method,'Not recorded');assert.equal(observedRetrieval(null).method,'Not recorded');assert.equal(observedRetrieval({brandEvidence:{method:'vector-search',backend:'fixture-vector'}}).method,'vector-search');
});
test('server budget descriptors distinguish ordinary and isolated QA policy without accepting arbitrary limits',async()=>{
 const {campaignBudgetPolicy:policy}=await import('../src/campaign-readiness.mjs');
 assert.deepEqual(policy({policyVersion:'campaign-usd-v1',capUsd:2}),{valid:true,cap:2,qa:false,label:'Campaign budget'});
 for(const cap of [5,10]){assert.equal(policy({policyVersion:'campaign-qa-usd-v1',capUsd:cap}).cap,cap);assert.equal(policy({policyVersion:'campaign-qa-usd-v1',ceilingUsd:cap}).qa,true);}
 for(const item of [null,{policyVersion:'campaign-usd-v1',capUsd:5},{policyVersion:'campaign-qa-usd-v1',capUsd:2},{policyVersion:'campaign-qa-usd-v1',capUsd:20},{policyVersion:'campaign-qa-usd-v1',capUsd:'5'},{policyVersion:'other',capUsd:10}])assert.equal(policy(item).valid,false);
});
test('client deadlines cover bounded sequential work without extending reads or ordinary actions',async()=>{
 const {campaignRequestTimeout:timeout}=await import('../src/campaign-readiness.mjs');
 assert.equal(timeout('/run'),10000);assert.equal(timeout('/run/advance',{expectedVersion:1}),270000);assert.equal(timeout('/run/revise',{expectedVersion:1}),500000);assert.equal(timeout('/run/decide',{decision:'accept_revision'}),130000);assert.equal(timeout('/run/decide',{decision:'stop'}),45000);assert.equal(timeout('/run/edit',{}),45000);
});
test('fresh saved-edit review remains available after two revision rounds without permitting paused or current reviews',async()=>{
 const {savedEditsNeedReview:available,campaignRequestTimeout:timeout}=await import('../src/campaign-readiness.mjs');const run={mode:'live-grounded',status:'needs_revision',revisionCount:2,findings:[{severity:'error',message:'Model review is out of date. Run review again after editing.'}]};assert.equal(available(run),true);for(const change of [{mode:'offline-template'},{status:'stopped'},{pendingOperation:true},{currentProposal:{status:'pending'}},{findings:[]}])assert.equal(available({...run,...change}),false);assert.equal(timeout('/run/review',{expectedVersion:1}),130000);
});
