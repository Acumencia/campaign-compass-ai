import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createCampaignService} from '../server/campaign.mjs';
import {campaignVectorFixture} from './campaign-vector-fixture.mjs';

const owner='vector-campaign-mock-owner';
const brief={audience:'Adults',goal:'Awareness',tone:'Warm',cta:'Explore the demo collection',walkingTrailId:'walk',cyclingTrailId:'cycle'};
const catalog={version:'vector-test-trails',trails:['walk','cycle'].map((id,i)=>({id,name:id,state:'FL',permissions:{[i?'cycling':'walking']:{status:'allowed'}},sources:[{id:id+'-source',url:'https://www.nps.gov/'}],facts:[{id:id+'-fact',text:'A named public recreation route.',sourceId:id+'-source'}]}))};
async function fixture(t,{timeoutMs=5000,modelTimeoutMs=30000}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'campaign-vector-'));
 const vector=campaignVectorFixture(async()=>catalog);let lexicalCalls=0,modelCalls=0,writerContext;
 const original=vector.evidenceTools.searchEvidence;vector.evidenceTools.searchEvidence=async(...args)=>{if(args[1].layer==='brand')lexicalCalls++;return original(...args);};
 const service=createCampaignService({directory,loadCatalog:async()=>catalog,evidenceTools:vector.evidenceTools,timeoutMs,modelTimeoutMs});
 const generator={status:()=>({model:'mock-no-provider'}),enhance:async input=>{modelCalls++;writerContext=structuredClone(input.brandEvidence);return input.artifacts;},check:async()=>{modelCalls++;return [];}};
 t.after(async()=>{service.close();await rm(directory,{recursive:true,force:true});});
 return {service,vector,generator,directory,counts:()=>({lexicalCalls,modelCalls}),context:()=>writerContext};
}

test('live grounding freezes validated vector chunks and forwards exact chunks rather than full source documents',async t=>{
 const f=await fixture(t);const fetch=f.vector.evidenceTools.fetchSource;f.vector.evidenceTools.fetchSource=async(...args)=>{const value=await fetch(...args);if(value.layer==='brand')value.document.text+='\nUnretrieved full-document text must not enter writer context.';return value;};
 let run=await f.service.create(owner,brief,{mode:'live-grounded'});
 run=await f.service.advance(owner,run.id,{expectedVersion:run.version,retrieveBrand:f.vector.retrieveBrand,generator:f.generator});
 assert.equal(run.step,1);assert.equal(run.brandEvidence.retrievalMode,'vector-only');assert.equal(run.brandEvidence.backend,'local');assert.equal(run.brandEvidence.method,'vector-cosine-v1');assert.deepEqual(run.brandEvidence.chunkIds,[f.vector.chunk.chunkId]);
 assert.equal(run.brandEvidence.matches[0].text,f.vector.chunk.text);assert.equal(f.counts().lexicalCalls,0);assert.equal(f.counts().modelCalls,0);
 assert.ok(run.events.some(e=>e.node==='brand-vector-retrieval'&&e.status==='completed'&&e.retrieval.chunkIds.includes(f.vector.chunk.chunkId)));
 run=await f.service.advance(owner,run.id,{expectedVersion:run.version,generator:f.generator});assert.equal(run.step,2);assert.equal(f.counts().modelCalls,1);assert.deepEqual(f.context(),run.brandEvidence);assert.doesNotMatch(JSON.stringify(f.context()),/Unretrieved full-document/);
});

test('live retrieval cannot use missing, empty, lexical, duplicate or wrong-backend evidence',async t=>{
 const cases=[
  ['missing',null,'campaign_vector_unavailable'],
  ['empty',r=>({...r,matches:[]}),'campaign_vector_invalid'],
  ['lexical',r=>({...r,method:'lexical-tfidf-cosine-v1'}),'campaign_vector_invalid'],
  ['duplicate',r=>({...r,matches:[r.matches[0],r.matches[0]]}),'campaign_vector_invalid'],
  ['backend',r=>({...r,backend:'unverified'}),'campaign_vector_invalid'],
 ];
 for(const [name,transform,code] of cases){await t.test(name,async t=>{const f=await fixture(t);let run=await f.service.create(owner,brief,{mode:'live-grounded'});const retrieveBrand=transform?async()=>transform(await f.vector.retrieveBrand()):undefined;run=await f.service.advance(owner,run.id,{expectedVersion:run.version,retrieveBrand,generator:f.generator});assert.equal(run.status,'error');assert.equal(run.error.code,code);assert.equal(run.step,0);assert.deepEqual(run.artifacts,[]);assert.equal(f.counts().modelCalls,0);assert.equal(f.counts().lexicalCalls,0);});}
});

test('forged chunk text, hash, line metadata or stale corpus versions stop before writing',async t=>{
 const cases=[['text',r=>{r.matches[0].text='Forged guidance';},'campaign_vector_forged'],['hash',r=>{r.matches[0].contentHash='forged';},'campaign_vector_forged'],['lines',r=>{r.matches[0].startLine=999;},'campaign_vector_forged'],['stale',r=>{r.corpusVersion='older-corpus';},'campaign_vector_stale']];
 for(const [name,change,code] of cases){await t.test(name,async t=>{const f=await fixture(t);let run=await f.service.create(owner,brief,{mode:'live-grounded'});run=await f.service.advance(owner,run.id,{expectedVersion:run.version,generator:f.generator,retrieveBrand:async()=>{const r=await f.vector.retrieveBrand();change(r);return r;}});assert.equal(run.error.code,code);assert.equal(run.step,0);assert.equal(f.counts().modelCalls,0);assert.equal(f.counts().lexicalCalls,0);assert.deepEqual(run.brandEvidence,[]);});}
});

test('offline campaigns retain an explicitly lexical path and never invoke the vector callback',async t=>{
 const f=await fixture(t);let vectorCalls=0;let run=await f.service.create(owner,brief);run=await f.service.advance(owner,run.id,{expectedVersion:run.version,retrieveBrand:async()=>{vectorCalls++;throw Error('No vector request allowed');}});assert.equal(run.step,1);assert.equal(run.brandEvidence.retrievalMode,'lexical-offline');assert.equal(f.counts().lexicalCalls,1);assert.equal(vectorCalls,0);assert.equal(f.counts().modelCalls,0);
});

test('vector timeout and explicit retry preserve saved state without a lexical fallback',async t=>{
 const f=await fixture(t,{timeoutMs:10});let finish,lookupSignal;let run=await f.service.create(owner,brief,{mode:'live-grounded'});run=await f.service.advance(owner,run.id,{expectedVersion:run.version,generator:f.generator,retrieveBrand:({signal})=>{lookupSignal=signal;return new Promise(resolve=>{finish=resolve;});}});assert.equal(run.error.code,'campaign_vector_timeout');assert.equal(lookupSignal.aborted,true);finish(await f.vector.retrieveBrand());await new Promise(r=>setTimeout(r,15));assert.equal((await f.service.get(owner,run.id)).step,0);assert.equal(f.counts().modelCalls,0);assert.equal(f.counts().lexicalCalls,0);run=await f.service.advance(owner,run.id,{expectedVersion:run.version,retrieveBrand:f.vector.retrieveBrand,generator:f.generator});assert.equal(run.step,1);assert.equal(run.brandEvidence.retrievalMode,'vector-only');
});

test('legacy live records are preserved and cannot be silently migrated on continuation',async t=>{
 const f=await fixture(t);let run=await f.service.create(owner,brief,{mode:'live-grounded'});run=await f.service.advance(owner,run.id,{expectedVersion:run.version,retrieveBrand:f.vector.retrieveBrand});
 const db=new DatabaseSync(path.join(f.directory,'checkpoints.sqlite'));const state=JSON.parse(db.prepare('SELECT state FROM campaign_runs WHERE id=?').get(run.id).state);delete state.brandRetrievalPolicy;state.brandEvidence={...state.brandEvidence,retrievalMode:'lexical-offline',method:'lexical-test'};db.prepare('UPDATE campaign_runs SET state=? WHERE id=?').run(JSON.stringify(state),run.id);db.close();let calls=0;
 run=await f.service.advance(owner,run.id,{expectedVersion:run.version,generator:f.generator,retrieveBrand:async()=>{calls++;return f.vector.retrieveBrand();}});assert.equal(run.error.code,'campaign_vector_legacy');assert.equal(run.brandEvidence.retrievalMode,'lexical-offline');assert.equal(run.brandRetrievalPolicy,undefined);assert.equal(run.step,1);assert.equal(calls,0);assert.equal(f.counts().modelCalls,0);
});

test('Pinecone integrated vector evidence is accepted only with canonical source matching',async t=>{
 const f=await fixture(t);let run=await f.service.create(owner,brief,{mode:'live-grounded'});run=await f.service.advance(owner,run.id,{expectedVersion:run.version,retrieveBrand:async()=>({...await f.vector.retrieveBrand(),backend:'pinecone',method:'pinecone-integrated-cosine'})});assert.equal(run.step,1);assert.equal(run.brandRetrieval.backend,'pinecone');assert.equal(run.brandRetrieval.method,'pinecone-integrated-cosine');assert.equal(f.counts().modelCalls,0);
});

test('canonical index mapping and sanitized transport persist through events and approved export',async t=>{
 const f=await fixture(t);const base=await f.vector.retrieveBrand();const corpusMapping={indexCorpusVersion:'retained-index-v1',localCorpusVersion:base.corpusVersion,equivalence:'canonical-content-identical'};const transport={protocol:'internal-vector-retrieval',backend:'local',method:'vector-cosine-v1',namespace:'approved-existing-namespace',requestId:'mock-vector-request',durationMs:12,...corpusMapping,untrustedExtra:'must not persist'};
 let run=await f.service.create(owner,brief,{mode:'live-grounded'});run=await f.service.advance(owner,run.id,{expectedVersion:run.version,retrieveBrand:async()=>({...base,indexCorpusVersion:corpusMapping.indexCorpusVersion,corpusMapping,transport})});
 assert.deepEqual(run.brandEvidence.corpusMapping,corpusMapping);assert.equal(run.brandEvidence.indexCorpusVersion,'retained-index-v1');assert.equal(run.brandEvidence.transport.untrustedExtra,undefined);assert.equal(run.brandRetrieval.transport.namespace,'approved-existing-namespace');assert.ok(run.events.some(e=>e.retrieval?.corpusMapping?.equivalence==='canonical-content-identical'));
 for(let i=0;i<3;i++)run=await f.service.advance(owner,run.id,{expectedVersion:run.version,generator:f.generator});run=await f.service.decide(owner,run.id,{decision:'approve',expectedVersion:run.version});const bundle=await f.service.exportBundle(owner,run.id,{expectedVersion:run.version});assert.deepEqual(bundle.brandEvidence.corpusMapping,corpusMapping);assert.equal(bundle.brandRetrieval.indexCorpusVersion,'retained-index-v1');assert.equal(bundle.brandEvidence.transport.requestId,'mock-vector-request');
});

test('inconsistent index mappings are rejected before any model call',async t=>{
 const f=await fixture(t);let run=await f.service.create(owner,brief,{mode:'live-grounded'});run=await f.service.advance(owner,run.id,{expectedVersion:run.version,retrieveBrand:async()=>({...await f.vector.retrieveBrand(),indexCorpusVersion:'old-index',corpusMapping:{indexCorpusVersion:'other-index',localCorpusVersion:'wrong-canonical',equivalence:'canonical-content-identical'}}),generator:f.generator});assert.equal(run.error.code,'campaign_vector_mapping');assert.equal(f.counts().modelCalls,0);assert.deepEqual(run.brandEvidence,[]);
});

async function reviewedWithDefect(f){let run=await f.service.create(owner,brief,{mode:'live-grounded'});const generator={...f.generator,check:async()=>[{artifactId:'walking-product',issue:'Clarify the introduction',suggestion:'Use a clearer fictional introduction'}]};for(let i=0;i<4;i++)run=await f.service.advance(owner,run.id,{expectedVersion:run.version,retrieveBrand:f.vector.retrieveBrand,generator});return {run,generator};}

test('sequential revision batch may exceed one request deadline but has a bounded eight-call envelope',async t=>{
 const f=await fixture(t,{modelTimeoutMs:60});let {run,generator}=await reviewedWithDefect(f);let observedSignal;generator={...generator,proposeRevision:async({artifacts,signal})=>{observedSignal=signal;const out=[];for(const a of artifacts){await new Promise(resolve=>setTimeout(resolve,25));assert.equal(signal.aborted,false);out.push({...a,text:a.text+'\nA clearer proposed introduction.'});}return out;}};
 run=await f.service.revise(owner,run.id,{expectedVersion:run.version,generator});assert.equal(run.status,'awaiting_revision_decision');assert.equal(run.currentProposal.artifacts.length,5);assert.equal(run.operationDeadline.durationMs,480);assert.equal(run.operationDeadline.perRequestMs,60);assert.equal(observedSignal.aborted,true,'Settled operations release their deadline signal');
 let criticSignal;generator={...generator,check:({signal})=>{criticSignal=signal;return new Promise(()=>{});}};run=await f.service.decide(owner,run.id,{decision:'accept_revision',proposalId:run.currentProposal.id,expectedVersion:run.version,generator});assert.equal(run.status,'needs_revision');assert.equal(run.operationDeadline.durationMs,60);assert.equal(criticSignal.aborted,true);assert.equal(run.approval,null);
});

test('revision batch timeout is finite and explicit Stop aborts the entire sequential batch',async t=>{
 const f=await fixture(t,{modelTimeoutMs:10});let {run,generator}=await reviewedWithDefect(f);let signal;generator={...generator,proposeRevision:args=>{signal=args.signal;return new Promise(()=>{});}};run=await f.service.revise(owner,run.id,{expectedVersion:run.version,generator});assert.equal(run.status,'needs_revision');assert.equal(run.operationDeadline.durationMs,80);assert.equal(signal.aborted,true);assert.equal(run.currentProposal,null);
 const g=await fixture(t,{modelTimeoutMs:60});let prepared=await reviewedWithDefect(g);let entered;const started=new Promise(resolve=>{entered=resolve;});let stopSignal;const stopping={...prepared.generator,proposeRevision:args=>{stopSignal=args.signal;entered();return new Promise(()=>{});}};const pending=g.service.revise(owner,prepared.run.id,{expectedVersion:prepared.run.version,generator:stopping});await started;const stopped=await g.service.decide(owner,prepared.run.id,{decision:'stop',expectedVersion:prepared.run.version});await pending;assert.equal(stopped.status,'stopped');assert.equal(stopSignal.aborted,true);assert.equal(stopped.currentProposal,null);assert.deepEqual(stopped.artifacts,prepared.run.artifacts);
});
