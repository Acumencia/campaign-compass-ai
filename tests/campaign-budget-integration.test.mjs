import {campaignVectorFixture,withCampaignVectorFixture} from './campaign-vector-fixture.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {createCampaignService} from '../server/campaign.mjs';
import {loadTrails} from '../server/trails.mjs';
import {createServer} from '../server.mjs';
import {createAPIProviders} from '../server/api-providers.mjs';
import {createChatGPTService} from '../server/chatgpt.mjs';
import {MemoryStore,mockProtocol} from './chatgpt-fixtures.mjs';
import {createAnthropicKeyService} from '../server/anthropic-api-key.mjs';
import {createCampaignGeneration} from '../server/campaign-generation.mjs';
import {createBudgetedCampaignGeneration,campaignReadiness} from '../server/campaign-runtime.mjs';
function mockedService(options){const vector=campaignVectorFixture(options.loadCatalog||loadTrails);return withCampaignVectorFixture(createCampaignService({...options,evidenceTools:vector.evidenceTools}),vector);}
const owner='budget-integration-owner';
const brief={audience:'Curious adults',goal:'Explore a fictional collection',tone:'Warm',cta:'Explore the demo collection',walkingTrailId:'nps-ever-anhinga',cyclingTrailId:'nps-ever-shark-valley'};
function provider(){const service=createAnthropicKeyService({environment:{CAMPAIGN_ANTHROPIC_ENABLED:'1',CAMPAIGN_ANTHROPIC_API_KEY:'synthetic-test-key-not-a-credential',CAMPAIGN_ANTHROPIC_GENERATION_MODEL:'claude-opus-5-5'},fetcher:async()=>{throw Error('Unbudgeted transport must not run');}});return {generation:service.generation,status:()=>({...service.status(),provider:'anthropic'})};}
function result(body){const input=JSON.parse(body.messages[0].content);if(!input.artifacts[0]?.requiredFields)return {findings:[]};const facts=input.evidence.flatMap(t=>t.facts);return {artifacts:input.artifacts.map(a=>{const f=facts.find(f=>a.permittedFactIds.includes(f.id));return {artifactId:a.id,fields:a.requiredFields.map(name=>({name,text:'Explore the fictional concept through observation and thoughtful conversation.'})),claims:[{factId:f.id,sourceId:f.sourceId,text:f.text,quote:f.text}],assumptions:['A proposed closing conversation.']};})};}
test('actual provider adapter reserves durably before mock transport and retains budget through service restart',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'cc-budget-integration-'));let service=mockedService({directory});const api=provider();let calls=0,run;
 const fetcher=async(url,options)=>{calls++;assert.equal(url,'https://api.anthropic.com/v1/messages');const db=new DatabaseSync(path.join(directory,'checkpoints.sqlite'),{readOnly:true});const saved=JSON.parse(db.prepare('select state from campaign_runs where id=?').get(run.id).state);db.close();assert.ok(saved.billing);assert.ok(JSON.stringify(saved.billing).includes('6144'));const body=JSON.parse(options.body);return new Response(JSON.stringify({model:'claude-opus-5-5',type:'message',role:'assistant',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(result(body))}],usage:{input_tokens:100,output_tokens:100}}),{headers:{'Content-Type':'application/json'}});};
 const factory=(state,save)=>createBudgetedCampaignGeneration({run:state,save,api,fetcher,authorize:()=>true});
 try{
  run=await service.create(owner,brief,{mode:'live-grounded'});assert.equal(run.billing.ceilingUsd,2);assert.equal(run.billing.callCount,0);
  run=await service.advance(owner,run.id,{expectedVersion:run.version,generator:factory});assert.equal(calls,0);
  run=await service.advance(owner,run.id,{expectedVersion:run.version,generator:factory});assert.equal(calls,1);assert.equal(run.artifacts.length,3);assert.equal(run.billing.callCount,1);assert.ok(run.billing.reservedUsd>0);assert.equal(run.billing.knownActualUsd,0.0024);
  const reserved=run.billing.reservedUsd;service.close();service=mockedService({directory});run=await service.get(owner,run.id);assert.equal(run.billing.reservedUsd,reserved);assert.equal(run.billing.callCount,1);assert.equal(calls,1);
  run=await service.advance(owner,run.id,{expectedVersion:run.version,generator:factory});assert.equal(calls,5);assert.equal(run.billing.callCount,5);assert.ok(run.billing.reservedUsd>reserved);assert.ok(run.billing.reservedUsd<=2);
 }finally{service.close();await rm(directory,{recursive:true,force:true});}
});
test('campaign readiness is scoped to approved model and does not need general API billing consent',()=>{
 const api=provider();assert.equal(campaignReadiness(api).configured,true);assert.equal(campaignReadiness(api).consent,true);assert.equal(campaignReadiness(api,false).consent,false);
 assert.equal(campaignReadiness({...api,status:()=>({...api.status(),provider:'openai'})}).configured,false);
 assert.equal(campaignReadiness({...api,status:()=>({...api.status(),generationModel:'unknown'})}).configured,false);
});

test('HTTP campaign default permission is budgeted without enabling general API consent',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'cc-budget-http-'));let calls=0;
 const apiKey=createAPIProviders({environment:{CAMPAIGN_GENERATION_PROVIDER:'anthropic',CAMPAIGN_ANTHROPIC_ENABLED:'1',CAMPAIGN_ANTHROPIC_API_KEY:'synthetic-test-key-not-a-credential',CAMPAIGN_ANTHROPIC_GENERATION_MODEL:'claude-opus-5-5'},fetcher:async()=>{throw Error('Unscoped network blocked');}});
 const server=createServer({campaignDirectory:directory,campaignService:mockedService({directory}),apiKey,campaignFetch:async(url,options)=>{calls++;return new Response(JSON.stringify({model:'claude-opus-5-5',type:'message',role:'assistant',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(result(JSON.parse(options.body)))}],usage:{input_tokens:100,output_tokens:100}}),{headers:{'Content-Type':'application/json'}});},chatgpt:createChatGPTService({store:new MemoryStore(),protocol:mockProtocol(),supported:false})});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  const response=await fetch(base+'/api/campaign');const bootstrap=await response.json();const cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  assert.equal(bootstrap.campaignDefaults.capUsd,2);assert.equal(bootstrap.readiness.consent,true);assert.equal(calls,0);
  const headers={'Content-Type':'application/json',Cookie:cookie,Origin:base,'x-cc-csrf':bootstrap.csrf};
  let run=await (await fetch(base+'/api/campaign/create',{method:'POST',headers,body:JSON.stringify({brief,mode:'live-grounded'})})).json();
  for(let i=0;i<2;i++)run=await (await fetch(base+'/api/campaign/'+run.id+'/advance',{method:'POST',headers,body:JSON.stringify({expectedVersion:run.version})})).json();
  assert.equal(calls,1);assert.equal(run.billing.callCount,1);assert.ok(run.billing.reservedUsd>0);
  const status=await (await fetch(base+'/api/provider/status',{headers:{Cookie:cookie}})).json();assert.equal(status.consent,false);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});}
});

test('independent ledger instances cannot overwrite reservations through two services sharing SQLite',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'cc-budget-cas-'));let base=mockedService({directory});let run=await base.create(owner,brief,{mode:'live-grounded'});
 run=await base.advance(owner,run.id,{expectedVersion:run.version,generator:{status:()=>({})}});base.close();
 let arrivals=0,release;const gate=new Promise(r=>{release=r;});const catalog=async()=>{arrivals++;if(arrivals===2)release();await gate;return loadTrails();};
 const services=[mockedService({directory,loadCatalog:catalog}),mockedService({directory,loadCatalog:catalog})];
 const modules=await Promise.all([import('../server/campaign-budget.mjs?isolated-ledger-one'),import('../server/campaign-budget.mjs?isolated-ledger-two')]);let calls=0;const api=provider();
 try{
  const outcomes=await Promise.allSettled(services.map((service,index)=>service.advance(owner,run.id,{expectedVersion:run.version,generator:(state,save)=>{
   const budget=modules[index].createCampaignBudget({run:state,save,fetcher:async(url,options)=>{calls++;return new Response(JSON.stringify({model:'claude-opus-5-5',type:'message',role:'assistant',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(result(JSON.parse(options.body)))}],usage:{input_tokens:100,output_tokens:100}}),{headers:{'Content-Type':'application/json'}});}});
   const generation=api.generation.withTransport({fetcher:budget.fetcher,maxOutputTokens:6144,timeoutMs:60000});
   return createCampaignGeneration({generation,authorize:()=>true,maxCalls:1});
  }})));
  assert.equal(calls,1);assert.ok(outcomes.some(o=>o.status==='rejected'));
  const persisted=await services[0].get(owner,run.id);assert.equal(persisted.billing.callCount,1);assert.ok(persisted.billing.reservedUsd>0);assert.ok(persisted.billing.reservedUsd<2);
 }finally{for(const service of services)service.close();await rm(directory,{recursive:true,force:true});}
});
