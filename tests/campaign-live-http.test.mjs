import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from '../server.mjs';
import {createChatGPTService} from '../server/chatgpt.mjs';
import {MemoryStore,mockProtocol} from './chatgpt-fixtures.mjs';

test('HTTP live mode with an unapproved provider blocks all calls and cannot export (mock provider only)',async t=>{
 const parent=path.resolve('.tmp');await mkdir(parent,{recursive:true});const directory=await mkdtemp(path.join(parent,'campaign-no-consent-'));
 let providerCalls=0;
 const provider={status:()=>({generationConfigured:true,provider:'mock-only',generationModel:'mock-test',enabled:true}),generation:{spec:{provider:'mock-only',model:'mock-test'},generateStructured:async()=>{providerCalls++;throw Error('Must not be reached without consent');}}};
 const server=createServer({campaignDirectory:directory,apiKey:provider,chatgpt:createChatGPTService({store:new MemoryStore(),protocol:mockProtocol(),supported:false})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 const bootstrap=await fetch(base+'/api/campaign');assert.equal(bootstrap.status,200);const cookies=bootstrap.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),state=await bootstrap.json();
 const post=(route,body,extra={})=>fetch(base+route,{method:'POST',headers:{Cookie:cookies,'Content-Type':'application/json','X-CC-CSRF':state.csrf,...extra},body:JSON.stringify(body)});
 const brief={audience:'Adults',goal:'Awareness',tone:'Warm',cta:'Explore the demo collection',walkingTrailId:'nps-ever-anhinga',cyclingTrailId:'nps-ever-shark-valley'};
 assert.equal((await post('/api/campaign/create',{brief,mode:'live-editorial'},{Origin:'https://outside.invalid'})).status,403);
 assert.equal((await post('/api/campaign/create',{brief,mode:'live-editorial'},{'X-CC-CSRF':'wrong'})).status,403);
 let response=await post('/api/campaign/create',{brief,mode:'live-editorial'});assert.equal(response.status,200);let run=await response.json();assert.equal(run.mode,'live-editorial');
 response=await post(`/api/campaign/${run.id}/advance`,{expectedVersion:run.version});assert.equal(response.status,409);assert.equal((await response.json()).error.code,'campaign_budget_provider_unavailable');
 assert.equal(providerCalls,0);assert.equal(run.mode,'live-editorial');assert.equal(run.step,0);assert.equal(run.approval,null);assert.equal(run.billing.callCount,0);
 assert.equal((await post(`/api/campaign/${run.id}/export`,{expectedVersion:run.version})).status,409);
 assert.equal((await post(`/api/campaign/${run.id}/decide`,{decision:'approve',expectedVersion:run.version})).status,409);
 assert.equal(providerCalls,0);
});
