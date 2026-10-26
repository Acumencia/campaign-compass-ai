import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {loadCampaignStartup} from '../server/campaign-startup.mjs';
import {campaignReadiness} from '../server/campaign-runtime.mjs';
import {createAPIProviders} from '../server/api-providers.mjs';
import {createServer} from '../server.mjs';
import {createChatGPTService} from '../server/chatgpt.mjs';
import {MemoryStore,mockProtocol} from './chatgpt-fixtures.mjs';
const secret='synthetic-anthropic-key-not-a-credential';
async function fixture(){
 const dir=await mkdtemp(path.join(os.tmpdir(),'cc-startup-'));const keyFile=path.join(dir,'original-key.json'),environmentFile=path.join(dir,'original.env');
 await writeFile(keyFile,JSON.stringify({version:1,anthropic:secret,openai:'synthetic-other-key-not-a-credential',pinecone:'synthetic-storage-key-not-a-credential'}));
 await writeFile(environmentFile,'CAMPAIGN_OPENAI_ENABLED=1\nCAMPAIGN_GENERATION_PROVIDER=openai\n');
 await writeFile(keyFile+'.settings.json',JSON.stringify({version:1,selectedProvider:'openai',generation:{anthropic:{enabled:true,model:'claude-opus-5-5',maxOutputTokens:2048}},embedding:{model:'text-embedding-3-small',dimensions:1536},storage:{backend:'local'}}));
 await writeFile(path.join(dir,'key.json.campaign-source.json'),JSON.stringify({version:1,keyFile,environmentFile}));return {dir,keyFile};
}
test('startup reads existing configuration without copying keys, exposing mutations or enabling other providers',async()=>{
 const {dir,keyFile}=await fixture();try{
  const before=await readFile(keyFile,'utf8');const api=await loadCampaignStartup(dir);
  assert.equal(campaignReadiness(api).configured,true);assert.equal(api.status().embeddingsConfigured,false);
  assert.deepEqual(Object.keys(api).sort(),['generation','status']);assert.deepEqual(Object.keys(api.generation),['withTransport']);
  assert.ok(!JSON.stringify(api).includes(secret));assert.ok(!JSON.stringify(api.status()).includes(secret));
  await assert.rejects(readFile(path.join(dir,'key.json')),{code:'ENOENT'});assert.equal(await readFile(keyFile,'utf8'),before);
  let calls=0;const generation=api.generation.withTransport({fetcher:async(url,options)=>{calls++;assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(options.headers['x-api-key'],secret);return new Response(JSON.stringify({type:'message',role:'assistant',stop_reason:'end_turn',content:[{type:'text',text:'{"ok":true}'}]}),{headers:{'content-type':'application/json'}});}});
  assert.deepEqual(await generation.generateStructured({system:'Synthetic',input:'Fixture',schema:{type:'object'},name:'fixture'}),{ok:true});assert.equal(calls,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('missing pointer is optional; malformed pointer and source fail closed with sanitized status',async()=>{
 const {dir,keyFile}=await fixture();try{
  await writeFile(keyFile,'invalid private fixture');const bad=await loadCampaignStartup(dir);assert.equal(campaignReadiness(bad).configured,false);assert.ok(!JSON.stringify(bad.status()).includes(dir));
  await writeFile(path.join(dir,'key.json.campaign-source.json'),'invalid pointer');assert.equal(campaignReadiness(await loadCampaignStartup(dir)).configured,false);
  await rm(path.join(dir,'key.json.campaign-source.json'));assert.equal(await loadCampaignStartup(dir),null);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('HTTP startup credentials are campaign-only; page loads make no model calls and general provider stays disabled',async()=>{
 const {dir}=await fixture();let server,calls=0;try{
  const campaignAPI=await loadCampaignStartup(dir);
  server=createServer({campaignAPI,apiKey:createAPIProviders({environment:{}}),campaignDirectory:path.join(dir,'runs'),campaignFetch:async()=>{calls++;throw Error('No model calls on load');},chatgpt:createChatGPTService({store:new MemoryStore(),protocol:mockProtocol(),supported:false})});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const result=await fetch(base+'/api/campaign');const body=await result.json();assert.equal(body.readiness.configured,true);assert.equal(body.readiness.settingsAvailable,false);assert.equal(body.campaignDefaults.capUsd,2);
  const status=await (await fetch(base+'/api/provider/status')).json();assert.equal(status.generationConfigured,false);assert.equal(status.embeddingsConfigured,false);assert.equal(status.storage.backend,'local');
  for(const page of ['/campaign.html','/local-review.html'])assert.equal((await fetch(base+page)).status,200);
  assert.equal(calls,0);assert.ok(!JSON.stringify(body).includes(secret));
 }finally{if(server)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
