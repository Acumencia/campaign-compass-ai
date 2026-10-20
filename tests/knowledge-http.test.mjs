import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createServer} from '../server.mjs';
import {buildCorpus} from '../server/knowledge.mjs';
const corpus=buildCorpus([{name:'demo.md',text:'# Demo\n## Bottle\nBottle capacity is 650 ml.'}]);
async function setup(t,options={}){const server=createServer({loadCorpus:async()=>corpus,...options});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});const base=`http://127.0.0.1:${server.address().port}`;return {base,post:(action,body,headers={})=>fetch(`${base}/api/knowledge/${action}`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)})};}
test('Knowledge API returns inspectable sources and honest unavailable generation without invoking provider',async t=>{
 let called=false;const api=await setup(t,{invoke:()=>{called=true;throw Error('must not invoke');}});const m=await(await api.post('manifest',{})).json();assert.equal(m.chunkCount,1);assert.equal(m.documents[0].text,undefined);
 const result=await(await api.post('ask',{question:'capacity',corpusVersion:m.corpusVersion})).json();assert.equal(result.answer,null);assert.equal(result.mode,'lexical');assert.equal(called,false);
 const s=await(await api.post('source',{sourceId:'demo',corpusVersion:m.corpusVersion})).json();assert.match(s.document.text,/650 ml/);assert.equal(s.chunks[0].startLine,3);
});
test('Knowledge routes preserve host/origin, method, size and strict field boundaries',async t=>{
 const api=await setup(t),body={question:'capacity',corpusVersion:corpus.corpusVersion};
 assert.equal((await fetch(`${api.base}/api/knowledge/manifest`)).status,405);
 for(const headers of [{Origin:'https://evil.test'},{Origin:'null'},{Host:'evil.test'},{'Sec-Fetch-Site':'cross-site'}]) {
 const status=await new Promise((resolve,reject)=>{const req=http.request(api.base+'/api/knowledge/ask',{method:'POST',headers:{'Content-Type':'application/json',...headers}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(JSON.stringify(body));});assert.equal(status,403,JSON.stringify(headers));
 }
 assert.equal((await api.post('ask',{...body,endpoint:'https://evil.test'})).status,400);assert.equal((await api.post('ask',{...body,question:'x'.repeat(501)})).status,400);assert.equal((await api.post('ask',{...body,question:'x'.repeat(9000)})).status,413);
 assert.equal((await api.post('ask',body,{'Content-Type':'text/plain'})).status,415);assert.equal((await api.post('missing',{})).status,404);
 assert.equal((await api.post('source',{sourceId:'../README',corpusVersion:corpus.corpusVersion})).status,400);
 for(const route of ['/data/knowledge/index.json','/data/knowledge/corpus/demo.md','/server/knowledge.mjs'])assert.equal((await fetch(api.base+route)).status,404);
});
test('stale versions and in-flight corpus changes reject obsolete evidence',async t=>{
 const api=await setup(t);assert.equal((await api.post('ask',{question:'capacity',corpusVersion:'old'})).status,409);
 let reads=0;const changed=await setup(t,{loadCorpus:async()=>++reads===1?corpus:{...corpus,corpusVersion:'changed'}});assert.equal((await changed.post('ask',{question:'capacity',corpusVersion:corpus.corpusVersion})).status,409);
});
test('internal errors do not leak filesystem or content diagnostics',async t=>{const api=await setup(t,{loadCorpus:async()=>{throw Error('secret path');}});const r=await api.post('manifest',{});assert.equal(r.status,500);assert.doesNotMatch(await r.text(),/secret path/);});
test('client disconnect does not release delayed corpus results',async t=>{
 let release,started;const began=new Promise(r=>started=r);const api=await setup(t,{loadCorpus:()=>{started();return new Promise(r=>release=r);}});const controller=new AbortController();const pending=fetch(`${api.base}/api/knowledge/manifest`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:controller.signal});await began;controller.abort();await assert.rejects(pending,{name:'AbortError'});release(corpus);
});
