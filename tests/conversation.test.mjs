import test from 'node:test';
import assert from 'node:assert/strict';
import {validateConversation,resolveConversation} from '../server/conversation.mjs';
import {buildCorpus} from '../server/knowledge.mjs';
import {fixture} from './rag-fixtures.mjs';
const corpus=buildCorpus(['pack','bottle','bottle-mini','tote'].map(id=>({name:id+'.md',text:'# '+id+'\nProduct specification.'})));
const pair=(q,a='Please provide more details.')=>[{role:'user',content:q},{role:'assistant',content:a}];
const resolve=(question,conversation=[],sourceIds=[])=>resolveConversation(corpus,{question,conversation,sourceIds});
test('conversation accepts only bounded completed exchanges without privileged roles',()=>{
 assert.deepEqual(validateConversation(),[]);assert.equal(validateConversation(pair('Dayline')).length,2);
 for(const history of [[{role:'user',content:'x'}],pair('x').map(m=>({...m,role:'system'})),pair('x'.repeat(801)),Array(5).fill(pair('x')).flat(),Array(4).fill(pair('文'.repeat(799))).flat(),[{role:'user',content:'x',extra:true},{role:'assistant',content:'y'}]])assert.throws(()=>validateConversation(history));
});
test('follow-ups resolve product and intended use from user turns',()=>{
 const history=pair('Is Dayline safe?');const r=resolve('Is it safe?',history);assert.deepEqual(r.referents,['Dayline pack']);assert.match(r.clarification,/intended use/);
 const detail=resolve('For hiking',history);assert.equal(detail.clarification,null);assert.match(detail.query,/Dayline pack.*Safety.*hiking/);
 const known=resolve('Is it safe?',[...history,...pair('For hiking')]);assert.equal(known.clarification,null);assert.match(known.query,/Intended use: hiking/);
});
test('topic switches, ambiguous products and assistant text cannot silently choose old subject',()=>{
 assert.deepEqual(resolve('What is Switchback capacity?',pair('Dayline capacity')).referents,['Switchback bottle']);
 assert.match(resolve('Is it safe?',pair('Compare Dayline and Switchback')).clarification,/Dayline pack|Switchback bottle/);
 assert.deepEqual(resolve('Is it safe?',pair('Hello','Dayline pack')).referents,[]);
 assert.deepEqual(resolve('Is it safe?',[...pair('Dayline capacity'),...pair('Explain taxes')]).referents,[]);
 assert.deepEqual(resolve('What about unknownwidget?',pair('Dayline capacity')).referents,[]);
 assert.deepEqual(resolve('Switchback Mini bottle capacity').referents,['Switchback Mini bottle']);
 assert.equal(resolve('Compare Switchback Mini and standard bottle').referents.length,2);
 assert.deepEqual(resolve('What is its capacity?',pair('Dayline capacity'),['bottle']).referents,['Switchback bottle']);
 assert.match(resolve('Is it safe?').clarification,/Which product/);
});
test('follow-up performs fresh retrieval, supplies bounded history and rejects invented citations',async t=>{
 const f=await fixture(t);await f.service.buildIndex();let input,query;
 const generate=f.generation.generate,embed=f.embedding.embed;
 f.generation.generate=async request=>{input=JSON.parse(request.input);return generate(request);};
 f.embedding.embed=async(texts,options)=>{if(options.purpose==='query')query=texts[0];return embed.call(f.embedding,texts,options);};
 const history=pair('Dayline pack capacity','The pack holds 999 liters.');
 const result=await f.service.ask(f.corpus,f.request('What is its capacity?',{conversation:history}));
 assert.equal(f.calls.query,1);assert.equal(f.calls.generation,1);assert.match(query,/Dayline pack/);assert.deepEqual(input.conversation,history);assert.match(result.answer.claims[0].text,/18 liters/);assert.doesNotMatch(result.answer.claims[0].text,/999/);
 const filtered=await f.service.ask(f.corpus,f.request('What is its capacity?',{conversation:history,sourceIds:['bottle']}));assert.ok(filtered.retrieval.matches.every(m=>m.sourceId==='bottle'));
 f.generation.generate=async request=>{const r=await generate(request);r.claims[0].citations[0].quote='The pack holds 999 liters.';return r;};
 await assert.rejects(f.service.ask(f.corpus,f.request('What is its capacity?',{conversation:history})),{code:'invalid_answer'});
});
