import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildCorpus,loadKnowledge,retrieve} from '../server/knowledge.mjs';
import {expandEvidence,completeFitClarification,versionComparisonRequested} from '../server/knowledge-context.mjs';
import {buildGroundedPrompt,validateGroundedAnswer,GROUNDED_SYSTEM} from '../server/rag.mjs';

test('development regression replay restores missing shipping/materials without new provider calls',async()=>{
 const corpus=await loadKnowledge(),report=JSON.parse(await readFile(new URL('../evidence/live-evaluation-2026-10-19.json',import.meta.url))),byId=new Map(corpus.chunks.map(c=>[c.chunkId,c]));
 for(const id of ['K08','K17']){
  const r=report.records.find(r=>r.id===id),vector=r.vector.matches.map(m=>({...byId.get(m.chunkId),score:m.score}));
  const expanded=expandEvidence(corpus,r.question,vector),prompt=buildGroundedPrompt(corpus,r.question,expanded.matches);
  for(const missing of r.vector.missingEvidence)assert.ok(expanded.matches.some(c=>c.sourceId===missing.sourceId&&c.heading===missing.heading&&prompt.evidenceIds.includes(c.chunkId)));
  assert.ok(expanded.matches.length<=10);assert.deepEqual(vector.map(c=>c.score),r.vector.matches.map(c=>c.score));
 }
});
test('analogous product-policy query includes lexical evidence despite semantic distraction, respects filter and empty gate',()=>{
 const c=buildCorpus([{name:'mug.md',text:'# Travel mug\n## Price\nThe travel mug costs 20 USD.'},{name:'delivery.md',text:'# Delivery\n## Postage\nMug delivery postage costs 4 USD.'},{name:'case.md',text:'# Case\n## Color\nThe travel case is blue.'}]);
 const vector=[{...c.chunks.find(c=>c.sourceId==='case'),score:.6}];
 const e=expandEvidence(c,'What is the mug price and delivery postage?',vector,{topK:2});assert.ok(e.matches.some(c=>c.sourceId==='mug'));assert.ok(e.matches.some(c=>c.sourceId==='delivery'));assert.equal(e.matches.length,3);
 assert.deepEqual(expandEvidence(c,'mug price',[]).matches,[]);
 const filtered=expandEvidence(c,'mug price and delivery',[{...c.chunks[1],score:.5}],{sourceIds:[c.chunks[1].sourceId]});assert.ok(filtered.matches.every(x=>x.sourceId===c.chunks[1].sourceId));
});
test('linked history appears only for a version comparison and cannot escape explicit source filtering',()=>{
 const metadata={provenance:'synthetic',owner:'test',version:'old',effective:'2020-01-01',status:'superseded',supersededBy:'mug',scope:'mug'};
 const c=buildCorpus([{name:'mug.md',text:'# Mug\n## Capacity\nCurrent mug capacity is 500 ml.'},{name:'old-mug.md',text:'# Old mug\n<!-- metadata: '+JSON.stringify(metadata)+' -->\n## Historical capacity\nThe old mug capacity was 300 ml; this source is superseded.'},{name:'unrelated.md',text:'# Old unrelated\n<!-- metadata: '+JSON.stringify({...metadata,supersededBy:'missing'})+' -->\n## Historical capacity\nOld capacity was 200 ml.'}]);
 const current={...c.chunks.find(c=>c.sourceId==='mug'),score:.8};
 assert.ok(expandEvidence(c,'mug capacity',[current]).matches.every(c=>c.metadata.status==='active'));
 const e=expandEvidence(c,'Is current mug capacity 300 or 500 ml?',[current]);assert.equal(e.historicalMatches.length,1);assert.equal(e.historicalMatches[0].sourceId,'old-mug');assert.equal(e.historicalMatches[0].evidenceRole,'historical comparison only');
 assert.equal(expandEvidence(c,'current or old mug capacity',[current],{sourceIds:['mug']}).historicalMatches.length,0);
 const old={...c.chunks.find(c=>c.sourceId==='old-mug'),score:.7};assert.ok(expandEvidence(c,'old mug capacity',[old],{sourceIds:['old-mug']}).matches.every(c=>c.sourceId==='old-mug'));
 const prompt=buildGroundedPrompt(c,'current or old?',e.matches);assert.match(prompt.system,/Historical comparison passages cannot establish current claims/);assert.match(prompt.system,/If active sources conflict, abstain/);assert.equal(JSON.parse(prompt.input).evidence.find(c=>c.sourceId==='old-mug').metadata.supersededBy,'mug');
});
test('retained version-comparison development cases supply linked obsolete values',async()=>{
 const c=await loadKnowledge(),report=JSON.parse(await readFile(new URL('../evidence/live-evaluation-2026-10-19.json',import.meta.url))),byId=new Map(c.chunks.map(c=>[c.chunkId,c]));
 for(const [id,old,number] of [['K28','dayline-v1','16 liters'],['K29','shipping-v1','60 demo USD']]){const r=report.records.find(r=>r.id===id),e=expandEvidence(c,r.question,r.vector.matches.map(m=>({...byId.get(m.chunkId),score:m.score}))),prompt=buildGroundedPrompt(c,r.question,e.matches);assert.ok(e.historicalMatches.some(c=>c.sourceId===old&&c.text.includes(number)&&prompt.evidenceIds.includes(c.chunkId)));}
});
test('device-fit clarification gains physical measurements and needs, but unrelated ambiguity/abstention/answers remain unchanged',()=>{
 const a={status:'clarification',message:'Which device and screen size?',claims:[]};
 for(const q of ['Which bag fits my device?','Will this case hold my tablet?','Can I carry a laptop in it?']){const r=completeFitClarification(q,a);assert.equal(r.completed,true);assert.match(r.answer.message,/length, width and thickness.*units.*carrying\/protection/);assert.ok(r.answer.message.length<=500);assert.deepEqual(r.answer.claims,[]);assert.equal(completeFitClarification(q,r.answer).completed,false);}
 assert.equal(completeFitClarification('Which device fits?',{...a,message:'x'.repeat(499)}).answer.message.length<500,true);
 for(const [q,answer] of [['Is it safe?',a],['Which one is best?',a],['Which device fits?',{status:'insufficient_evidence',message:'Unknown',claims:[]}],['Which device fits?',{status:'answered',message:'',claims:[]}]])assert.deepEqual(completeFitClarification(q,answer),{answer,completed:false});
 assert.equal(versionComparisonRequested('How many are in stock today?'),false);
});
test('expanded context still rejects uncited/forged unsupported output and preserves whole-chunk budget',()=>{
 const c=buildCorpus([{name:'one.md',text:'# One\n## Claim\nThe mug holds 500 ml.'}]),e=expandEvidence(c,'mug capacity',[{...c.chunks[0],score:.7}]);
 const prompt=buildGroundedPrompt(c,'mug capacity',e.matches,GROUNDED_SYSTEM.length+400);assert.ok(prompt.characters<=GROUNDED_SYSTEM.length+400);assert.equal(prompt.evidenceIds.length,0);
 const options={corpusVersion:c.corpusVersion,matches:e.matches},answer={corpusVersion:c.corpusVersion,status:'answered',message:'',claims:[{text:'Guaranteed waterproof',citations:[{chunkId:c.chunks[0].chunkId,quote:'Guaranteed waterproof'}]}]};assert.throws(()=>validateGroundedAnswer(answer,options),{code:'invalid_answer'});answer.claims[0].citations=[];assert.throws(()=>validateGroundedAnswer(answer,options),{code:'invalid_answer'});
});
