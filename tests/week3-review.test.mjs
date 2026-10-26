import {campaignVectorFixture,withCampaignVectorFixture} from './campaign-vector-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from '../server.mjs';
import {createChatGPTService} from '../server/chatgpt.mjs';
import {MemoryStore,mockProtocol} from './chatgpt-fixtures.mjs';
import {initializeCampaignBudget} from '../server/campaign-budget.mjs';
import {createCampaignService} from '../server/campaign.mjs';

test('independent review: provider revision change between specialist calls revokes the old session grant',async t=>{
  let providerCalls=0;
  const generation={spec:{provider:'mock-only',model:'no-network'},generateStructured:async()=>{providerCalls++;return {findings:[]};}};
  generation.withTransport=()=>generation;
  const providers={generation,status:()=>({generationConfigured:true,keyPresent:true,enabled:true,provider:'anthropic',generationModel:'claude-opus-5-5'})};
  const credentials={revision:0,providers,status:()=>({available:true})};
  const request={brief:{},evidence:[],artifacts:[{id:'email',title:'Email',text:'Fictional review fixture.'}]};
  const campaignService={list:async()=>[],close(){},advance:async(_owner,_id,{generator:factory})=>{
    const run={id:'review-provider-revision',mode:'live-grounded',artifacts:[],budgets:{modelCalls:0}};initializeCampaignBudget({run,save:()=>{},newCampaign:true});const generator=factory(run,()=>{});
    await generator.check(request);
    credentials.revision++; // A separate browser saves provider configuration during this stage.
    await assert.rejects(generator.check(request),{code:'campaign_consent_required'});
    return {status:'blocked',providerCalls};
  }};
  const server=createServer({credentials,campaignService,chatgpt:createChatGPTService({store:new MemoryStore(),protocol:mockProtocol(),supported:false})});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(base+'/api/campaign');const state=await response.json();
  const cookie=response.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
  const post=(url,body)=>fetch(base+url,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CC-CSRF':state.csrf},body:JSON.stringify(body)});
  assert.equal((await post('/api/provider/consent',{enabled:true})).status,200);
  const result=await post('/api/campaign/test-run/advance',{expectedVersion:1});
  assert.equal(result.status,200,JSON.stringify(await result.json()));
  assert.equal(providerCalls,1,'Changed provider configuration must block the next call, even without a new browser request.');
});

test('independent review: changing a sourced trail number cannot pass offline review and approval',async t=>{
  const parent=path.resolve('.tmp');await mkdir(parent,{recursive:true});const directory=await mkdtemp(path.join(parent,'review-facts-'));
  const catalog={version:'test-only',trails:['walk','cycle'].map((id,i)=>({id,name:id,state:'FL',permissions:{[i?'cycling':'walking']:{status:'allowed'}},sources:[{id:id+'-source',url:'https://www.nps.gov/'}],facts:[{id:id+'-fact',text:`The route length is ${i?'15':'0.8'} miles.`,sourceId:id+'-source'}]}))};
  const vector=campaignVectorFixture(async()=>catalog);const service=withCampaignVectorFixture(createCampaignService({directory,loadCatalog:async()=>catalog,evidenceTools:vector.evidenceTools}),vector);
  t.after(async()=>{service.close();await rm(directory,{recursive:true,force:true});});
  const owner='independent-review-owner',brief={audience:'Adults',goal:'Awareness',tone:'Warm',cta:'Explore the demo collection',walkingTrailId:'walk',cyclingTrailId:'cycle'};
  let run=await service.create(owner,brief);for(let i=0;i<4;i++)run=await service.advance(owner,run.id,{expectedVersion:run.version});
  const article=run.artifacts.find(a=>a.id==='walking-product');
  run=await service.edit(owner,run.id,{expectedVersion:run.version,artifactId:article.id,text:article.text.replace('0.8 miles','800 miles')});
  run=await service.revise(owner,run.id,{expectedVersion:run.version});
  await assert.rejects(service.decide(owner,run.id,{expectedVersion:run.version,decision:'approve'}),{code:'validation_failed'});
  assert.notEqual(run.status,'awaiting_approval');
  run=await service.decide(owner,run.id,{expectedVersion:run.version,decision:'stop'});
  await assert.rejects(service.revise(owner,run.id,{expectedVersion:run.version}),{code:'run_paused'});
});

test('independent review: failed live literature does not expose ungenerated templates as live artifacts',async t=>{
  const parent=path.resolve('.tmp');await mkdir(parent,{recursive:true});const directory=await mkdtemp(path.join(parent,'review-no-fallback-'));
  const catalog={version:'test-only',trails:['walk','cycle'].map((id,i)=>({id,name:id,state:'FL',permissions:{[i?'cycling':'walking']:{status:'allowed'}},sources:[{id:id+'-source',url:'https://www.nps.gov/'}],facts:[{id:id+'-fact',text:'A named public route.',sourceId:id+'-source'}]}))};
  const vector=campaignVectorFixture(async()=>catalog);const service=withCampaignVectorFixture(createCampaignService({directory,loadCatalog:async()=>catalog,evidenceTools:vector.evidenceTools}),vector);
  t.after(async()=>{service.close();await rm(directory,{recursive:true,force:true});});
  const owner='independent-review-owner',brief={audience:'Adults',goal:'Awareness',tone:'Warm',cta:'Explore the demo collection',walkingTrailId:'walk',cyclingTrailId:'cycle'};
  let run=await service.create(owner,brief,{mode:'live-grounded'});
  run=await service.advance(owner,run.id,{expectedVersion:run.version});
  run=await service.advance(owner,run.id,{expectedVersion:run.version});
  assert.equal(run.status,'error');assert.equal(run.error.code,'model_unavailable');
  assert.equal(run.artifacts.length,0,'Failed model writing must retain the pre-literature checkpoint, not template placeholders.');
});

test('independent review: campaign JSON accepts bounded Unicode drafts within its character contract',async t=>{
  const campaignService={list:async()=>[],close(){},edit:async(_owner,_id,{text})=>({savedCharacters:text.length})};
  const server=createServer({campaignService,chatgpt:createChatGPTService({store:new MemoryStore(),protocol:mockProtocol(),supported:false})});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const initial=await fetch(base+'/api/campaign'),state=await initial.json(),cookie=initial.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
  const response=await fetch(base+'/api/campaign/test-run/edit',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CC-CSRF':state.csrf},body:JSON.stringify({expectedVersion:1,artifactId:'blog',text:'é'.repeat(5000)})});
  assert.equal(response.status,200,await response.clone().text());
  assert.equal((await response.json()).savedCharacters,5000);
});
