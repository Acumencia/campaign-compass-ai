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
