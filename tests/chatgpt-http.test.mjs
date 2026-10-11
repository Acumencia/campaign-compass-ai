import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createServer} from '../server.mjs';
import {createChatGPTService} from '../server/chatgpt.mjs';
import {MemoryStore,mockProtocol} from './chatgpt-fixtures.mjs';
import {DEFAULT_FILTERS} from '../src/metrics.mjs';

async function setup(t) {
  const store=new MemoryStore(),protocol=mockProtocol(),chatgpt=createChatGPTService({store,protocol,supported:true});
  const server=createServer({chatgpt});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  let cookie='',csrf='';
  const send=(route,options={})=>fetch(base+route,{redirect:'manual',...options,headers:{Cookie:cookie,'X-CC-CSRF':csrf,...options.headers}});
  const status=async()=>{const response=await send('/api/chatgpt/session');cookie=response.headers.get('set-cookie').split(';')[0];const data=await response.json();csrf=data.csrf;return data;};
  const post=(route,body)=>send(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const signin=async()=>{
    await status();const oldCookie=cookie;
    const response=await send('/auth/start',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:base},body:new URLSearchParams({csrf,profileId:''})});
    assert.equal(response.status,303);
    const authorization=new URL(response.headers.get('location'));
    const callback=await send('/auth/callback?'+new URLSearchParams({state:authorization.searchParams.get('state'),code:'fixture-code',client_id:'fixture-client'}));
    assert.equal(callback.status,303);assert.equal(callback.headers.get('location'),'/');
    cookie=callback.headers.get('set-cookie').split(';')[0];assert.notEqual(cookie,oldCookie);
    return {state:await status(),oldCookie};
  };
  const start=(csrfValue,headers={})=>send('/auth/start',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams({csrf:csrfValue,profileId:''})});
  const sendRaw=(route,headers)=>new Promise((resolve,reject)=>{
    const request=http.request(base+route,{headers:{Cookie:cookie,...headers}},response=>{response.resume();response.on('end',()=>resolve({status:response.statusCode}));});
    request.on('error',reject);request.end();
  });
  return {base,send,status,post,signin,store,protocol,start,sendRaw};
}

test('HTTP bootstrap is disconnected and read-only with HttpOnly SameSite cookies',async t=>{
  const api=await setup(t);const response=await api.send('/api/chatgpt/session');
  assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);
  const status=await response.json();assert.equal(status.connected,false);assert.equal(api.store.writes,0);
  assert.equal(api.protocol.calls.tokens.length,0);
});
test('sign-in POST requires CSRF and same origin; cross-origin GETs cannot read sessions',async t=>{
  const api=await setup(t);await api.status();
  const missing=await api.send('/auth/start',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'csrf=wrong'});
  assert.equal(missing.status,403);
  assert.equal((await api.send('/api/chatgpt/session',{headers:{Origin:'https://invalid.example'}})).status,403);
  assert.equal(api.protocol.calls.tokens.length,0);assert.equal(api.store.writes,0);
});
test('mock sign-in rotates session, keeps OAuth tokens server-side and gates model selection',async t=>{
  const api=await setup(t);const {state,oldCookie}=await api.signin();
  assert.equal(state.connected,true);assert.equal(state.sharing,true);
  assert.doesNotMatch(JSON.stringify(state),/fixture-access|fixture-refresh|fixture-id/);
  const old=await fetch(api.base+'/api/chatgpt/session',{headers:{Cookie:oldCookie}});
  assert.equal((await old.json()).connected,false);
  assert.equal((await api.post('/api/chatgpt/model',{slug:'invented-model'})).status,400);
  await api.send('/api/chatgpt/models');assert.equal((await api.post('/api/chatgpt/model',{slug:'fixture-model'})).status,200);
  const snapshot=await (await api.post('/api/snapshot',{filters:DEFAULT_FILTERS})).json();
  const request={filters:DEFAULT_FILTERS,question:'brief',contextId:snapshot.contextId,snapshotId:snapshot.snapshotId};
  assert.equal((await api.send('/api/brief',{method:'POST',headers:{'Content-Type':'application/json','X-CC-CSRF':'wrong'},body:JSON.stringify(request)})).status,403);
  const result=await (await api.post('/api/brief',request)).json();assert.equal(result.mode,'model');
  assert.equal(api.protocol.calls.inference.length,1);
  const disconnected=await (await api.post('/api/chatgpt/disconnect',{})).json();assert.equal(disconnected.connected,false);
  assert.equal(api.store.state.profiles[0].tokens,undefined);
});

test('callback with missing or wrong browser session does not exchange a code',async t=>{
  const api=await setup(t);await api.status();
  const response=await api.send('/auth/callback?state=not-valid&code=fixture-code&client_id=fixture-client');
  assert.equal(response.status,303);assert.equal(api.protocol.calls.tokens.length,0);
  assert.equal((await fetch(api.base+'/auth/callback?state=x&code=x')).status,400);
});

test('only the app document preserves same-origin form attribution; OAuth and API responses suppress referrers',async t=>{
  const api=await setup(t),state=await api.status();
  for(const route of ['/','/index.html'])assert.equal((await api.send(route)).headers.get('referrer-policy'),'same-origin');
  assert.equal((await api.send('/api/chatgpt/session')).headers.get('referrer-policy'),'no-referrer');
  const started=await api.start(state.csrf,{Origin:api.base});
  assert.equal(started.status,303);assert.equal(started.headers.get('referrer-policy'),'no-referrer');
  const auth=new URL(started.headers.get('location'));
  const callback=await api.send('/auth/callback?'+new URLSearchParams({state:auth.searchParams.get('state'),code:'fixture-code',client_id:'fixture-client'}),{headers:{'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'}});
  assert.equal(callback.status,303);assert.equal(callback.headers.get('referrer-policy'),'no-referrer');
  assert.equal(api.protocol.calls.tokens.length,1);
});

test('absent Origin is accepted for a session-bound navigation with valid CSRF, never by Referer alone',async t=>{
  const api=await setup(t),state=await api.status();
  assert.equal((await api.start('wrong',{'Sec-Fetch-Site':'same-origin',Referer:api.base+'/'})).status,403);
  const started=await api.start(state.csrf,{'Sec-Fetch-Site':'same-origin','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'});
  assert.equal(started.status,303);
  assert.equal(new URL(started.headers.get('location')).searchParams.get('redirect_uri'),api.base+'/auth/callback');
});

test('opaque, external, different-port and contradictory origins remain rejected even with the valid form token',async t=>{
  const api=await setup(t),state=await api.status();
  for(const headers of [
    {Origin:'null','Sec-Fetch-Site':'same-origin'},
    {Origin:'https://attacker.invalid','Sec-Fetch-Site':'cross-site'},
    {Origin:api.base.replace('http:','https:')},
    {Origin:'http://127.0.0.1:1','Sec-Fetch-Site':'same-site'},
    {Origin:api.base.replace('127.0.0.1','localhost'),'Sec-Fetch-Site':'cross-site'},
    {Origin:api.base,'Sec-Fetch-Site':'cross-site'},
    {'Sec-Fetch-Site':'cross-site',Referer:api.base+'/'},
    {'Sec-Fetch-Site':'same-site'},
  ])assert.equal((await api.start(state.csrf,headers)).status,403);
  assert.equal(api.store.writes,0);assert.equal(api.protocol.calls.tokens.length,0);
});

test('callback host and port cannot be widened by forwarding headers or aliases; valid pending state survives rejection',async t=>{
  const api=await setup(t),state=await api.status();
  const started=await api.start(state.csrf,{Origin:api.base});
  const auth=new URL(started.headers.get('location'));
  const callback='/auth/callback?'+new URLSearchParams({state:auth.searchParams.get('state'),code:'fixture-code',client_id:'fixture-client'});
  for(const [Host,status] of [[new URL(api.base).host.replace('127.0.0.1','localhost'),400],['127.0.0.1:1',403],['attacker.invalid',403]]){
    const response=await api.sendRaw(callback,{Host,'X-Forwarded-Host':new URL(api.base).host,'X-Forwarded-Proto':'http'});
    assert.equal(response.status,status);assert.equal(api.protocol.calls.tokens.length,0);
  }
  assert.equal((await api.send(callback,{method:'POST'})).status,400);
  assert.equal((await api.send(callback,{headers:{Origin:'https://auth.openai.com','Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate'}})).status,303);
  assert.equal(api.protocol.calls.tokens.length,1);
  assert.equal(api.protocol.calls.tokens[0].redirect_uri,api.base+'/auth/callback');
});
