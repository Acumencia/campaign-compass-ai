import test from 'node:test';
import assert from 'node:assert/strict';
import {standaloneClarification} from '../server/knowledge-context.mjs';
import {createRagService,GROUNDED_SYSTEM} from '../server/rag.mjs';
import {buildCorpus,KnowledgeError} from '../server/knowledge.mjs';
import {fixture,fixtureProviders} from './rag-fixtures.mjs';
test('standalone ambiguity asks for details without retrieving, generating or asserting safety',async t=>{
 const f=await fixture(t);
 for(const question of ['is it safe?',' Is THIS safe?! ','would that be safe?','Which one is best?','Will it fit?','Can I use it?','How much does it cost?','What is its capacity?']){
  const r=await f.service.ask(f.corpus,f.request(question));assert.equal(r.status,'clarification',question);assert.equal(r.basis,'local_clarification');assert.equal(r.retrieval,null);assert.equal(r.diagnostics.generationMs,null);assert.equal(r.diagnostics.gateReason,'missing_referent');assert.deepEqual(r.answer.claims,[]);assert.ok(r.answer.message.endsWith('?'));assert.match(r.notice,/No retrieval or generation call/);
 }
 assert.deepEqual(f.calls,{document:0,query:0,generation:0});
});
test('specific names, use cases, extra context and explicit source filters are never hijacked by keyword rules',async t=>{
 const questions=['Is the Switchback bottle safe for untreated water?','Is Dayline safe for mountaineering?','Is it safe to carry a laptop in the Dayline pack?','Is it safe? I mean the bottle for hot liquids.','Which bag fits my device?','Which one is best for carrying a camera?','Is it safe for children?','Explain the safe-use policy'];
 const f=await fixture(t);await f.service.buildIndex();
 for(const q of questions){assert.equal(standaloneClarification(q),null);const r=await f.service.ask(f.corpus,f.request(q));assert.notEqual(r.basis,'local_clarification');}
 assert.equal(standaloneClarification('is it safe?',{sourceIds:['bottle']}),null);
 const r=await f.service.ask(f.corpus,f.request('is it safe?',{sourceIds:['bottle']}));assert.equal(r.basis,'local_clarification');assert.match(r.answer.message,/Switchback bottle.*intended use/);assert.ok(f.calls.query>=questions.length);
});
test('empty vector evidence stays a distinct fail-closed retrieval outcome',async t=>{
 const f=await fixture(t);await f.service.buildIndex();const r=await f.service.ask(f.corpus,f.request('Is the bottle safe for hot liquids?',{sourceIds:['pack']}));
 assert.equal(r.basis,'retrieval_gate');assert.equal(r.diagnostics.gateReason,'no_retrieved_evidence');assert.equal(r.answer,null);assert.equal(f.calls.generation,0);assert.match(r.notice,/No relevant source passages/);assert.doesNotMatch(r.notice,/context limits/);
});
test('retrieved passages that do not fit are distinct from missing evidence',async()=>{
 const corpus=buildCorpus([{name:'bottle.md',text:'# Bottle\n'+('bottle specifications '.repeat(170))}]),providers=fixtureProviders();
 const storage={mode:'integrated',spec:providers.embedding.spec,status:()=>({configured:true,backend:'local'}),search:async()=>({matches:[{...corpus.chunks[0],score:.8}],embeddingMs:0,searchMs:1,namespace:'fixture',method:'TEST ONLY'})};
 for(const contextCharacters of [2000,GROUNDED_SYSTEM.length+180]){
  const service=createRagService({config:{enabled:true,contextCharacters},storage,generation:providers.generation,getCorpus:async()=>corpus,allowTestProviders:true});
  const r=await service.ask(corpus,{question:'What are the bottle specifications?',corpusVersion:corpus.corpusVersion,sourceIds:[],topK:5});assert.equal(r.basis,'context_gate');assert.equal(r.diagnostics.gateReason,'context_limit');assert.ok(r.retrieval.matches.length);assert.equal(r.diagnostics.contextChunkIds.length,0);assert.equal(r.diagnostics.generationMs,null);assert.match(r.notice,/size limit/);
 }assert.equal(providers.calls.generation,0);
});
test('readiness, stale request and provider failures retain their own behavior',async t=>{
 const f=await fixture(t);const unconfigured=createRagService();assert.equal((await unconfigured.ask(f.corpus,f.request('is it safe?'))).status,'not_configured');
 await assert.rejects(f.service.ask(f.corpus,f.request('is it safe?',{corpusVersion:'stale'})),{code:'stale_corpus'});
 await assert.rejects(f.service.ask(f.corpus,f.request('Is the bottle safe for hot liquids?')),{code:'vector_index_missing'});
 await f.service.buildIndex();f.generation.generate=async()=>{throw new KnowledgeError(502,'generation_failed','Fixture provider failed.');};await assert.rejects(f.service.ask(f.corpus,f.request('Is the bottle safe for hot liquids?')),{code:'generation_failed'});
});
