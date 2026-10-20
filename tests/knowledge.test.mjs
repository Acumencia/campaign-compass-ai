import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildCorpus,ingest,readCorpus,loadKnowledge,retrieve,source,askKnowledge,validateCitedAnswer,exactFields} from '../server/knowledge.mjs';
const inputs=[{name:'bottle.md',text:'# Bottle\n## Size\nBottle capacity is 650 ml.\n## Care\nHand wash only.\n'},{name:'policy.txt',text:'# Claims\n## Limits\nNo waterproof claims.\n'}];
const corpus=()=>buildCorpus(inputs);
test('ingestion normalizes text, preserves source lines and is independent of input order',()=>{
 const a=corpus(),b=buildCorpus([...inputs].reverse());assert.deepEqual(a,b);assert.equal(a.chunks[0].startLine,3);assert.equal(a.chunks[0].endLine,3);assert.equal(a.chunks[0].heading,'Size');
 const c=buildCorpus([{name:'clean.md',text:'\uFEFF# Title\r\n## Section\r\nHello\t  world.  \r\n'}]);assert.equal(c.chunks[0].text,'Hello world.');assert.equal(c.chunks[0].startLine,3);
});
test('section-aware bounded overlapping chunks retain stable identifiers across unrelated changes',()=>{
 const long=Array.from({length:400},(_,i)=>`word${i}`).join(' '), a=buildCorpus([{name:'long.md',text:`# Long\n## First\n${long}\n## Second\nStable sentence.`}]);
 assert.deepEqual(a.chunks.map(c=>c.wordCount),[180,180,100,2]);assert.equal(a.chunks[1].text.split(' ')[0],'word150');
 const b=buildCorpus([{name:'long.md',text:`# Long\n## First\nchanged\n## Second\nStable sentence.`}]);assert.equal(a.chunks.at(-1).chunkId,b.chunks.at(-1).chunkId);assert.notEqual(a.corpusVersion,b.corpusVersion);
});
test('changed and deleted documents replace stored chunks; repeat ingestion is stable',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'cc-knowledge-'));t.after(()=>rm(dir,{recursive:true,force:true}));const sources=path.join(dir,'corpus');await mkdir(sources);const index=path.join(dir,'index.json');
 for(const d of inputs)await writeFile(path.join(sources,d.name),d.text);
 const first=await ingest(sources,index),second=await ingest(sources,index);assert.deepEqual(second.corpus,first.corpus);assert.deepEqual(second.changes,{added:[],changed:[],deleted:[]});
 await writeFile(path.join(sources,'bottle.md'),'# Bottle\n## Size\nCapacity is 700 ml.');await rm(path.join(sources,'policy.txt'));
 const third=await ingest(sources,index);assert.deepEqual(third.changes,{added:[],changed:['bottle'],deleted:['policy']});assert.equal(third.corpus.documents.length,1);assert.ok(third.corpus.chunks.every(c=>c.sourceId==='bottle'));assert.notEqual(third.corpus.corpusVersion,first.corpus.corpusVersion);assert.equal(JSON.parse(await readFile(index,'utf8')).corpusVersion,third.corpus.corpusVersion);
});
test('source boundary rejects traversal, duplicate IDs, empty and oversized data',()=>{
 for(const name of ['../secret.md','/secret.md','A.md','a/b.md'])assert.throws(()=>buildCorpus([{name,text:'test'}]));
 assert.throws(()=>buildCorpus([{name:'a.md',text:'a'},{name:'a.txt',text:'b'}]));assert.throws(()=>buildCorpus([{name:'a.md',text:'a'.repeat(100001)}]));assert.throws(()=>buildCorpus([{name:'a.md',text:'# Empty'}]));assert.throws(()=>buildCorpus([{name:'a.md',text:'# '+ 'x'.repeat(201)+'\nbody'}]));
 for(const id of ['../bottle','bottle.md','<script>'])assert.throws(()=>source(corpus(),id));assert.throws(()=>source(corpus(),'unknown'),{code:'source_not_found'});assert.throws(()=>exactFields({question:'x',extra:true},['question']));
});
test('ingestion rejects a directory masquerading as a source file',async t=>{const dir=await mkdtemp(path.join(os.tmpdir(),'cc-source-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(path.join(dir,'bad.md'));await assert.rejects(readCorpus(dir));});
test('lexical ranking is deterministic, bounded and does not claim answers or embeddings',()=>{
 const c=corpus();assert.deepEqual(retrieve(c,'bottle capacity'),retrieve(c,'bottle capacity'));assert.equal(retrieve(c,'bottle capacity')[0].sourceId,'bottle');assert.deepEqual(retrieve(c,'qzxqzx'),[]);assert.throws(()=>retrieve(c,'x'.repeat(501)));assert.throws(()=>retrieve(c,'capacity',11));
 const result=askKnowledge(c,{question:'capacity',corpusVersion:c.corpusVersion});assert.equal(result.answer,null);assert.equal(result.status,'generation_not_configured');assert.deepEqual(result.providers,{embeddings:'not_configured',generation:'not_configured'});assert.throws(()=>askKnowledge(c,{question:'capacity',corpusVersion:'old'}),{code:'stale_corpus'});
});
test('future cited-answer contract rejects forged, unretrieved, stale and malformed citations',()=>{
 const c=corpus(),r=askKnowledge(c,{question:'capacity',corpusVersion:c.corpusVersion});const valid={corpusVersion:c.corpusVersion,status:'answered',claims:[{text:'Capacity is 650 ml.',citations:[r.retrieval.matches[0].chunkId]}]};assert.deepEqual(validateCitedAnswer(valid,r),valid);
 for(const change of [{corpusVersion:'old'},{claims:[]},{claims:[{text:'x',citations:['missing']}]},{claims:[{text:'x',citations:[c.chunks.at(-1).chunkId]}]},{status:'insufficient_evidence'}, {extra:'x'}])assert.throws(()=>validateCitedAnswer({...valid,...change},r));
 assert.doesNotThrow(()=>validateCitedAnswer({corpusVersion:c.corpusVersion,status:'clarification',claims:[]},r));
});
test('expanded evaluation preserves original 6/4/2/3 distribution and all expected sections',async()=>{
 const fixtures=JSON.parse(await readFile(new URL('../eval/knowledge-questions.json',import.meta.url),'utf8'));const c=await readCorpus(new URL('../data/knowledge/corpus/',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
 assert.equal(fixtures.length,30);assert.deepEqual(Object.fromEntries(['direct','cross_document','ambiguous','unanswerable'].map(k=>[k,fixtures.slice(0,15).filter(f=>f.category===k).length])),{direct:6,cross_document:4,ambiguous:2,unanswerable:3});
 for(const f of fixtures)for(const e of f.expectedEvidence)assert.ok(c.chunks.some(c=>c.sourceId===e.sourceId&&c.heading===e.heading));
});

test('source changes and corrupted stored evidence require re-ingestion before service',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'cc-fresh-'));t.after(()=>rm(dir,{recursive:true,force:true}));const directory=path.join(dir,'sources'),indexPath=path.join(dir,'index.json');await mkdir(directory);
 await writeFile(path.join(directory,'demo.md'),'# Demo\nOriginal words.');
 await assert.rejects(loadKnowledge({directory,indexPath}),{code:'ingestion_required'});
 await ingest(directory,indexPath);const original=await loadKnowledge({directory,indexPath});assert.equal(original.documents.length,1);
 await writeFile(path.join(directory,'demo.md'),'# Demo\nChanged words.');await assert.rejects(loadKnowledge({directory,indexPath}),{code:'corpus_changed'});
 await ingest(directory,indexPath);const saved=JSON.parse(await readFile(indexPath,'utf8'));saved.chunks[0].text='forged';await writeFile(indexPath,JSON.stringify(saved));await assert.rejects(loadKnowledge({directory,indexPath}),{code:'corpus_changed'});
});

test('expanded corpus has substantive synthetic metadata and excludes archives from default retrieval',async()=>{
 const c=await readCorpus(new URL('../data/knowledge/corpus/',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));assert.equal(c.documents.length,28);assert.ok(c.chunks.length>=100&&c.chunks.length<=200);assert.ok(c.documents.every(d=>d.metadata.provenance==='synthetic'&&d.metadata.version&&d.metadata.effective));
 for(const q of ['16 liters Dayline pilot','60 shipping threshold','SUMMER15'])assert.ok(retrieve(c,q,10).every(m=>m.metadata.status==='active'));
});
