import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from '../server.mjs';
import {createCampaignService} from '../server/campaign.mjs';
import {createChatGPTService} from '../server/chatgpt.mjs';
import {MemoryStore,mockProtocol} from './chatgpt-fixtures.mjs';

const brief={audience:'Adults seeking walking and cycling inspiration',goal:'Awareness and inquiries',tone:'Warm and practical',cta:'Explore the demo collection',walkingTrailId:'nps-ever-anhinga',cyclingTrailId:'nps-ever-shark-valley'};
async function fixture(t){
  const parent=path.resolve('.tmp');await mkdir(parent,{recursive:true});
  const directory=await mkdtemp(path.join(parent,'campaign-http-'));
  let server,service,base;
  async function stop(){if(server){server.closeAllConnections();await new Promise(r=>server.close(r));server=null;}service=null;}
  async function start(){service=createCampaignService({directory});server=createServer({campaignService:service,chatgpt:createChatGPTService({store:new MemoryStore(),protocol:mockProtocol(),supported:false})});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;}
  await start();t.after(async()=>{await stop();await rm(directory,{recursive:true,force:true});});
  async function browser(existing={}){
    const jar={...existing};let csrf;
    const headers=extra=>({Cookie:Object.entries(jar).map(([k,v])=>`${k}=${v}`).join('; '),...extra});
    async function bootstrap(){const response=await fetch(base+'/api/campaign',{headers:headers()});assert.equal(response.status,200);for(const value of response.headers.getSetCookie()){const pair=value.split(';')[0],i=pair.indexOf('=');jar[pair.slice(0,i)]=pair.slice(i+1);}const state=await response.json();csrf=state.csrf;return {response,state};}
    const first=await bootstrap();
    return {jar,first,get csrf(){return csrf;},bootstrap,get:route=>fetch(base+route,{headers:headers()}),post:(route,body,extra={})=>fetch(base+route,{method:'POST',headers:headers({'Content-Type':'application/json','X-CC-CSRF':csrf,...extra}),body:JSON.stringify(body)})};
  }
  return {browser,restart:async()=>{await stop();await start();},anonymous:route=>fetch(base+route),get base(){return base;}};
}
async function jsonOK(response){assert.equal(response.status,200,await response.clone().text());return response.json();}
async function create(browser){return jsonOK(await browser.post('/api/campaign/create',{brief}));}
async function draft(browser,run){for(let i=0;i<4;i++)run=await jsonOK(await browser.post(`/api/campaign/${run.id}/advance`,{expectedVersion:run.version}));return run;}

test('campaign HTTP enforces origin, CSRF, exact fields and private file isolation',async t=>{
  const f=await fixture(t),b=await f.browser();
  assert.ok(b.jar.cc_session);assert.match(b.jar.cc_campaign_workspace,/^[a-f0-9]{64}$/);
  const cookies=b.first.response.headers.getSetCookie().join(';');assert.match(cookies,/HttpOnly/);assert.match(cookies,/SameSite=Strict/);assert.match(cookies,/Path=\/api\/campaign/);
  assert.equal((await b.post('/api/campaign/create',{brief},{Origin:'https://evil.example'})).status,403);
  assert.equal((await b.post('/api/campaign/create',{brief},{'X-CC-CSRF':'wrong'})).status,403);
  assert.equal((await b.post('/api/campaign/create',{brief,owner:'attacker-controlled-owner'})).status,400);
  assert.equal((await b.post('/api/campaign/create',{brief},{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await f.anonymous('/api/campaign/trails')).status,403);
  for(const route of ['/data/campaign-private/checkpoints.sqlite','/data/knowledge/private/campaign/checkpoints.sqlite','/server/campaign.mjs','/.tmp/checkpoints.sqlite'])assert.equal((await f.anonymous(route)).status,404);
  assert.equal(b.first.state.runs.length,0);
});

test('campaign HTTP completes grounded review and version-bound export with no provider',async t=>{
  const f=await fixture(t),b=await f.browser();let run=await create(b);
  assert.equal((await b.post(`/api/campaign/${run.id}/export`,{expectedVersion:run.version})).status,409);
  const initialVersion=run.version;run=await draft(b,run);
  assert.equal(run.status,'awaiting_approval');assert.equal(run.artifacts.length,7);assert.equal(run.evidence.length,2);assert.equal(run.mode,'offline-template');
  assert.equal((await b.post(`/api/campaign/${run.id}/decide`,{decision:'approve',expectedVersion:initialVersion})).status,409);
  run=await jsonOK(await b.post(`/api/campaign/${run.id}/decide`,{decision:'approve',expectedVersion:run.version}));
  const approvedVersion=run.version,exported=await jsonOK(await b.post(`/api/campaign/${run.id}/export`,{expectedVersion:run.version}));
  assert.equal(exported.approval.version,approvedVersion);assert.equal(exported.artifacts.length,7);assert.match(exported.execution,/no model calls/);assert.equal(exported.owner,undefined);
  run=await jsonOK(await b.post(`/api/campaign/${run.id}/edit`,{artifactId:'linkedin',text:run.artifacts.find(a=>a.id==='linkedin').text+'\nA manual review note.',expectedVersion:run.version}));
  assert.equal(run.approval,null);
  assert.equal((await b.post(`/api/campaign/${run.id}/export`,{expectedVersion:approvedVersion})).status,409);
  assert.equal((await b.post(`/api/campaign/${run.id}/export`,{expectedVersion:run.version})).status,409);
});

test('browser capabilities isolate checkpoints and survive service restart with fresh CSRF',async t=>{
  const f=await fixture(t),a=await f.browser(),b=await f.browser();let run=await create(a);
  assert.notEqual(a.jar.cc_campaign_workspace,b.jar.cc_campaign_workspace);
  assert.equal((await b.get(`/api/campaign/${run.id}`)).status,404);
  assert.equal((await b.post(`/api/campaign/${run.id}/advance`,{expectedVersion:run.version})).status,404);
  assert.equal((await b.bootstrap()).state.runs.length,0);
  run=await jsonOK(await a.post(`/api/campaign/${run.id}/advance`,{expectedVersion:run.version}));const oldCsrf=a.csrf,oldWorkspace=a.jar.cc_campaign_workspace;
  await f.restart();
  assert.equal((await a.get(`/api/campaign/${run.id}`)).status,403);
  const resumed=await a.bootstrap();assert.equal(a.jar.cc_campaign_workspace,oldWorkspace);assert.notEqual(a.csrf,oldCsrf);assert.equal(resumed.state.runs[0].id,run.id);assert.equal(resumed.state.runs[0].version,run.version);
  assert.equal((await a.post(`/api/campaign/${run.id}/advance`,{expectedVersion:run.version},{'X-CC-CSRF':oldCsrf})).status,403);
  run=await jsonOK(await a.post(`/api/campaign/${run.id}/advance`,{expectedVersion:run.version}));assert.equal(run.artifacts.length,3);
  const fresh=await f.browser();assert.equal(fresh.first.state.runs.length,0);assert.equal((await fresh.get(`/api/campaign/${run.id}`)).status,404);
});

test('rejected HTTP attempt cannot resume, revise or export',async t=>{
  const f=await fixture(t),b=await f.browser();let run=await draft(b,await create(b));
  run=await jsonOK(await b.post(`/api/campaign/${run.id}/decide`,{decision:'reject',expectedVersion:run.version}));assert.equal(run.status,'rejected');
  for(const action of ['advance','revise','export'])assert.equal((await b.post(`/api/campaign/${run.id}/${action}`,{expectedVersion:run.version})).status,409);
  assert.equal((await b.post(`/api/campaign/${run.id}/decide`,{decision:'resume',expectedVersion:run.version})).status,409);
  const read=await jsonOK(await b.get(`/api/campaign/${run.id}`));assert.equal(read.status,'rejected');assert.equal(read.version,run.version);
});
