import test from 'node:test';
import assert from 'node:assert/strict';
import {ChatGPTClient,datasetIdentity} from '../src/chatgpt-client.mjs';
import {createInferenceSnapshot} from '../server/inference.mjs';
import {DEFAULT_FILTERS} from '../src/metrics.mjs';
import {generate} from '../scripts/generate.mjs';
import {demoAnswer} from '../src/assistant.mjs';
const rows=generate(), snap=createInferenceSnapshot(rows,DEFAULT_FILTERS);
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

test('browser and server compute identical data/filter identities', async()=>{
  assert.equal(await datasetIdentity(rows,DEFAULT_FILTERS),snap.snapshotId);
});
test('client validates snapshot and facts on successful model transport', async()=>{
  const client=new ChatGPTClient({getRows:()=>rows,fetcher:async route=>json(route.endsWith('snapshot')?
    {contextId:snap.id,snapshotId:snap.snapshotId}:{contextId:snap.id,snapshotId:snap.snapshotId,mode:'model',answer:demoAnswer('brief',snap)})});
  client.available=true;assert.equal((await client.answer('brief',snap)).mode,'model');
});
test('client rejects stale data, stale replies and invented values',async()=>{
  for(const issue of ['data','reply','claim']){
    const client=new ChatGPTClient({getRows:()=>rows,fetcher:async route=>{
      if(route.endsWith('snapshot'))return json({contextId:snap.id,snapshotId:issue==='data'?'old':snap.snapshotId});
      const answer=demoAnswer('brief',snap);if(issue==='claim')answer.claims[0].value=42;
      return json({contextId:snap.id,snapshotId:issue==='reply'?'old':snap.snapshotId,mode:'model',answer});
    }});client.available=true;await assert.rejects(client.answer('brief',snap));
  }
});
test('client passes cancellation through both HTTP calls and never renders an aborted answer',async()=>{
  const controller=new AbortController();let calls=0;
  const client=new ChatGPTClient({getRows:()=>rows,fetcher:async(route,options)=>{
    assert.equal(options.signal,controller.signal);calls++;
    if(route.endsWith('snapshot'))return json({contextId:snap.id,snapshotId:snap.snapshotId});
    controller.abort();return json({contextId:snap.id,snapshotId:snap.snapshotId,mode:'model',answer:demoAnswer('brief',snap)});
  }});client.available=true;await assert.rejects(client.answer('brief',snap,{signal:controller.signal}),error=>error.name==='AbortError');assert.equal(calls,2);
});
test('static preview remains an explicit deterministic demo when the local service is absent',async()=>{
  const client=new ChatGPTClient({fetcher:async()=>{throw new Error('not available');}});await client.refresh();
  assert.equal(client.available,false);assert.equal((await client.answer('brief',snap)).mode,'demo');
});

test('HTML app fallback and proxy errors produce bounded diagnostics without response text', async()=>{
  for (const status of [200,403,502]) {
    const client=new ChatGPTClient({fetcher:async()=>new Response('<!DOCTYPE html>private fixture body',{status,headers:{'Content-Type':'text/html; charset=utf-8'}})});
    await assert.rejects(client.api('/api/chatgpt/models'),error=>{
      assert.equal(error.code,'local_response_invalid');assert.equal(error.diagnostic.httpStatus,status);
      assert.match(error.message,/HTML instead of JSON/);assert.doesNotMatch(error.message,/private fixture|DOCTYPE|Unexpected token/);return true;
    });
    await client.refresh();assert.equal(client.available,false);assert.match(client.state.notice,/npm start/);
    assert.equal((await client.answer('brief',snap)).mode,'demo');
  }
});

test('API redirects are never followed, including opaque browser redirect responses',async()=>{
  for (const response of [new Response(null,{status:302,headers:{Location:'https://invalid.example/login?private=fixture'}}),{type:'opaqueredirect',status:0}]) {
    const client=new ChatGPTClient({fetcher:async(route,options)=>{assert.equal(options.redirect,'manual');return response;}});
    await assert.rejects(client.api('/api/chatgpt/session'),error=>{
      assert.match(error.message,/unexpected redirect/);assert.doesNotMatch(error.message,/invalid.example|private/);return true;
    });
  }
});

test('malformed, oversized, empty and unsupported JSON never leak body snippets',async()=>{
  for(const body of ['<!DOCTYPE html>private fixture','{"private":"fixture"','null','[]','"private fixture"','{"long":"'+'x'.repeat(128000)+'"}']){
    const client=new ChatGPTClient({fetcher:async()=>new Response(body,{headers:{'Content-Type':'application/json'}})});
    await assert.rejects(client.api('/api/chatgpt/models'),error=>error.code==='local_response_invalid'&&!/private|fixture|DOCTYPE/.test(error.message));
  }
});

test('stale session contracts fail closed while a normal API abort stays an abort',async()=>{
  const stale=new ChatGPTClient({fetcher:async()=>json({version:'old',loggedIn:true})});await stale.refresh();
  assert.equal(stale.available,false);assert.equal(stale.state.connected,false);
  const aborted=new ChatGPTClient({fetcher:async()=>{throw new DOMException('Cancelled','AbortError');}});
  await assert.rejects(aborted.api('/api/chatgpt/session'),error=>error.name==='AbortError');
  await assert.rejects(stale.api('https://invalid.example/api/chatgpt/session'),/Unsupported/);
});
