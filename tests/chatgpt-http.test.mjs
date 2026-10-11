import test from 'node:test';
import assert from 'node:assert/strict';
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
  return {base,send,status,post,signin,store,protocol};
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
