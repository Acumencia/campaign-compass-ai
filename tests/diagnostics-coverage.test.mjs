import test from 'node:test';
import assert from 'node:assert/strict';
import {loadKnowledge,retrieve} from '../server/knowledge.mjs';
import {expandEvidence} from '../server/knowledge-context.mjs';
import {resolveConversation} from '../server/conversation.mjs';
import {validateGroundedAnswer,publicValidationDiagnostics,buildGroundedPrompt} from '../server/rag.mjs';
import {fixture} from './rag-fixtures.mjs';
import {createServer} from '../server.mjs';
test('general feature queries retrieve qualifications across products without a product-specific answer rule',async()=>{
 const c=await loadKnowledge();
 for(const q of ['do you have any waterproof products?','which products are waterproof?','are any products waterproof?']){
  const lexical=retrieve(c,q,5);for(const [id,heading]of [['tote','Weather limits'],['pack','Care and price']])assert.ok(lexical.some(x=>x.sourceId===id&&x.heading===heading),q);
  const coverage=expandEvidence(c,q,[{...c.chunks.find(x=>x.sourceId==='voice-email'),score:.6}]);const prompt=buildGroundedPrompt(c,q,coverage.matches);assert.ok(prompt.evidenceIds.some(id=>id.startsWith('tote:')));assert.ok(prompt.evidenceIds.some(id=>id.startsWith('pack:')));
 }
 for(const [q,id,section]of [['do you have any cotton products?','tote','Materials'],['any products with padded electronics compartments?','tote','Materials'],['what products have adjustable straps?','pack','Capacity and fit']])assert.ok(retrieve(c,q,5).some(x=>x.sourceId===id&&x.heading===section));
 assert.deepEqual(expandEvidence(c,'waterproof',[]).matches,[]);assert.ok(retrieve(c,'waterproof',5,{sourceIds:['tote']}).every(x=>x.sourceId==='tote'));assert.ok(retrieve(c,'waterproof',5).every(x=>x.metadata.status==='active'));
 const history=[{role:'user',content:'Is Ridgeline waterproof?'},{role:'assistant',content:'Not approved.'}];const broad=resolveConversation(c,{question:'do you have any waterproof products?',conversation:history,sourceIds:[]});assert.equal(broad.query,'do you have any waterproof products?');assert.deepEqual(broad.referents,[]);assert.deepEqual(resolveConversation(c,{question:'What about Dayline?',conversation:history,sourceIds:[]}).referents,['Dayline pack']);
});
test('specific validation rules preserve strict quote, source and schema requirements',async t=>{
 const f=await fixture(t),chunk=f.corpus.chunks[0],valid={corpusVersion:f.corpus.corpusVersion,status:'answered',message:'',claims:[{text:chunk.text,citations:[{chunkId:chunk.chunkId,quote:chunk.text}]}]};
 assert.equal(validateGroundedAnswer(valid,{corpusVersion:f.corpus.corpusVersion,matches:[chunk]}).status,'answered');
 for(const [rule,mutate]of [['quote_not_in_source',a=>a.claims[0].citations[0].quote='SECRET_REJECTED_INVENTED_TEXT'],['chunk_not_supplied',a=>a.claims[0].citations[0].chunkId='invented'],['duplicate_chunk',a=>a.claims[0].citations.push({...a.claims[0].citations[0]})],['answered_message_empty',a=>a.message='unexpected'],['exact_fields',a=>a.claims[0].extra='SECRET']]){
  const a=structuredClone(valid);mutate(a);assert.throws(()=>validateGroundedAnswer(a,{corpusVersion:f.corpus.corpusVersion,matches:[chunk]}),e=>e.code==='invalid_answer'&&e.validationDetail.rule===rule);
 }
});
test('normal Ask HTTP exposes bounded trusted diagnostics but never rejected answer or arbitrary error fields',async t=>{
 const f=await fixture(t,{authorizeAccess:async()=>true});await f.service.buildIndex();const original=f.generation.generate;f.generation.generate=async req=>{const a=await original(req);a.claims[0].text='SECRET_REJECTED_TEXT';a.claims[0].citations[0].quote='SECRET_REJECTED_QUOTE';return a;};
 const server=createServer({rag:f.service,loadCorpus:async()=>f.corpus});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});const base=`http://127.0.0.1:${server.address().port}`,session=await fetch(base+'/api/session'),cookie=session.headers.get('set-cookie').split(';')[0],csrf=(await session.json()).csrf;
 const response=await fetch(base+'/api/knowledge/rag',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CC-CSRF':csrf},body:JSON.stringify(f.request())});assert.equal(response.status,502);const text=await response.text(),body=JSON.parse(text),d=body.error.diagnostics;assert.equal(d.category,'citation_contract');assert.equal(d.rule,'quote_not_in_source');assert.equal(d.claimIndex,0);assert.equal(d.citationIndex,0);assert.ok(d.matches.some(m=>m.supplied));assert.equal(d.resolvedQuery,'bottle capacity');assert.doesNotMatch(text,/SECRET_REJECTED|claims|apiKey/);assert.ok(text.length<16000);
 const bounded=publicValidationDiagnostics({code:'invalid_answer',validationDetail:{rule:'quote_not_in_source',secret:'key'},evaluationEvidence:{validationReason:'citation_contract',raw:'SECRET',diagnostics:{resolvedQuery:'x'.repeat(10000),conversationMessages:1000},retrieval:{matches:Array(500).fill({chunkId:'a',sourceId:'b',heading:'h',text:'SECRET',score:.4})}}});assert.equal(bounded.matches.length,24);assert.equal(bounded.resolvedQuery.length,700);assert.equal(bounded.conversationMessages,8);assert.doesNotMatch(JSON.stringify(bounded),/SECRET|secret/);
});
