import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {createMockReviewServer} from '../scripts/campaign-mock-review-server.mjs';
test('mock review HTTP demo uses simulated vector grounding through approved export without vendor calls',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'cc-mock-vector-test-'));const {server}=await createMockReviewServer({directory,revisionDelayMs:0});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  const html=await (await fetch(base+'/campaign.html')).text();assert.match(html,/simulated vector retrieval/);assert.match(html,/No embedding or vector service is queried/);
  const response=await fetch(base+'/api/campaign'),initial=await response.json();const cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');assert.equal(initial.readiness.retrieval.configured,true);assert.equal(initial.readiness.retrieval.authorized,true);
  const headers={'Content-Type':'application/json',Cookie:cookie,Origin:base,'x-cc-csrf':initial.csrf};const post=async(route,body)=>{const response=await fetch(base+'/api/campaign/'+route,{method:'POST',headers,body:JSON.stringify(body)});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
  let run=await post('create',{mode:'live-grounded',brief:{audience:'Adults',goal:'Awareness',tone:'Warm',cta:'Explore the demo collection',walkingTrailId:'nps-ever-anhinga',cyclingTrailId:'nps-ever-shark-valley'}});
  for(let i=0;i<4;i++){run=await post(run.id+'/advance',{expectedVersion:run.version});assert.notEqual(run.status,'error',JSON.stringify(run.error));}
  assert.equal(run.artifacts.length,7);assert.equal(run.brandEvidence.method,'vector-cosine-v1');assert.equal(run.brandEvidence.retrievalMode,'vector-only');assert.equal(run.brandEvidence.matches[0].metadata.synthetic,true);assert.equal(run.status,'needs_revision');
  run=await post(run.id+'/revise',{expectedVersion:run.version});assert.equal(run.currentProposal.status,'pending');run=await post(run.id+'/decide',{decision:'accept_revision',proposalId:run.currentProposal.id,expectedVersion:run.version});assert.equal(run.status,'awaiting_approval');run=await post(run.id+'/decide',{decision:'approve',expectedVersion:run.version});const bundle=await post(run.id+'/export',{expectedVersion:run.version});assert.equal(bundle.artifacts.length,7);
  const linkedin=run.artifacts.find(a=>a.id==='linkedin'),rounds=run.revisionCount;run=await post(run.id+'/edit',{artifactId:'linkedin',text:linkedin.text+'\nA thoughtful closing reflection.',expectedVersion:run.version});assert.equal(run.status,'needs_revision');run=await post(run.id+'/review',{expectedVersion:run.version});assert.equal(run.status,'awaiting_approval');assert.equal(run.revisionCount,rounds);assert.equal(run.approval,null);
  const stats=await (await fetch(base+'/mock-fixture-status')).json();assert.equal(stats.providerNetworkCalls,0);assert.equal(stats.mockRetrievalCalls,1);assert.ok(stats.structuredMockCalls>=8);assert.match(stats.retrieval,/SIMULATED/);assert.ok(stats.plannedBatches.every(batch=>batch.cleaned));
  assert.equal((await fetch(base+'/src/campaign-readiness.mjs')).status,200);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});
