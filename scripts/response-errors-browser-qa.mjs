import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from '../server.mjs';
import {createChatGPTService} from '../server/chatgpt.mjs';
import {MemoryStore,mockProtocol} from '../tests/chatgpt-fixtures.mjs';

// A separate loopback provider reproduces an HTML-versus-JSON failure in the
// provider's own login document. No real authorization or provider calls occur.
let continued=0,redirectVisits=0;
const provider=http.createServer((req,res)=>{
  const path=new URL(req.url,'http://127.0.0.2').pathname;
  if(path==='/authorize'){res.writeHead(302,{Location:'/log-in'});res.end();return;}
  if(path==='/api/accounts/authorize/continue'){
    continued++;res.writeHead(403,{'Content-Type':'text/html'});res.end('<!DOCTYPE html><p>Mock gateway only</p>');return;
  }
  if(path==='/redirect-login')redirectVisits++;
  res.writeHead(200,{'Content-Type':'text/html','Referrer-Policy':'no-referrer'});
  res.end(`<h1>Mock provider login</h1><p id="error"></p><script>fetch('/api/accounts/authorize/continue').then(r=>r.json()).catch(e=>document.querySelector('#error').textContent=e.message)</script>`);
});
await new Promise(resolve=>provider.listen(0,'127.0.0.2',resolve));
const providerBase=`http://127.0.0.2:${provider.address().port}`;
const store=new MemoryStore(),protocol=mockProtocol();
protocol.configuration=async()=>({authorization_endpoint:providerBase+'/authorize'});
const server=createServer({chatgpt:createChatGPTService({store,protocol,supported:true})});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true});
const context=await browser.newContext();await context.route('https://**/*',route=>route.abort());
const page=await context.newPage(),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
const record=check=>checks.push({check,status:'passed'});
const fixture={csrf:'fixture-csrf',connected:true,sharing:true,supported:true,profiles:[],models:[],label:'Mock account'};
try{
  await page.goto(base);await page.locator('#connection-button').click();
  await page.waitForFunction(()=>!document.querySelector('#continue-chatgpt').disabled);
  await page.locator('#continue-chatgpt').click();await page.waitForURL(providerBase+'/log-in');
  await page.waitForFunction(()=>document.querySelector('#error').textContent.includes('Unexpected token'));
  assert.equal(continued,1);assert.equal(protocol.calls.tokens.length,0);
  const status=await (await context.request.get(base+'/api/chatgpt/session')).json();
  assert.equal(status.connected,false);assert.equal(status.profiles.length,0);
  record('Mock provider login HTML failure occurs before callback; local JSON status remains disconnected');

  await context.route(base+'/api/chatgpt/session',route=>route.fulfill({status:200,contentType:'text/html',body:'<!DOCTYPE html><p>private fixture</p>'}));
  await page.goto(base);await page.locator('#connection-button').click();
  await page.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('HTML instead of JSON'));
  assert.equal(await page.locator('#continue-chatgpt').isDisabled(),true);
  assert.doesNotMatch(await page.locator('#connection-status').innerText(),/private fixture|Unexpected token|DOCTYPE/);
  await page.locator('#close-connection').click();await page.locator('#brief-button').click();
  await page.waitForFunction(()=>document.querySelector('#answer').textContent.includes('DETERMINISTIC DEMO'));
  record('Static HTML API fallback is explained clearly and deterministic assistance remains usable');

  await context.unroute(base+'/api/chatgpt/session');
  await context.route(base+'/api/chatgpt/session',route=>route.fulfill({json:fixture}));
  await context.route(base+'/api/chatgpt/models',route=>route.fulfill({status:302,headers:{Location:providerBase+'/redirect-login'}}));
  await page.goto(base);await page.locator('#connection-button').click();await page.locator('#refresh-models').click();
  await page.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('unexpected redirect'));
  assert.equal(redirectVisits,0);assert.equal(new URL(page.url()).origin,base);
  record('API redirect is rejected without visiting the login destination or leaving the dashboard');

  await context.unroute(base+'/api/chatgpt/models');
  await context.route(base+'/api/chatgpt/models',route=>route.fulfill({status:403,contentType:'text/html',body:'<!DOCTYPE html>private fixture'}));
  await page.locator('#refresh-models').click();
  await page.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('HTTP 403'));
  assert.match(await page.locator('#connection-status').innerText(),/\/api\/chatgpt\/models/);
  assert.doesNotMatch(await page.locator('#connection-status').innerText(),/private fixture|DOCTYPE/);
  record('HTML API denial reports bounded path/status without raw upstream content');

  await context.unroute(base+'/api/chatgpt/session');
  await context.route(base+'/api/chatgpt/session',route=>route.fulfill({json:{legacyVersion:true}}));
  await page.goto(base);await page.locator('#connection-button').click();
  await page.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('unavailable'));
  assert.equal(await page.locator('#continue-chatgpt').isDisabled(),true);
  assert.deepEqual(errors,[]);record('Stale service contract fails closed with no uncaught browser errors');
  await mkdir('evidence',{recursive:true});
  await writeFile(process.env.RESPONSE_ERRORS_QA_OUTPUT||'evidence/response-errors-browser-qa.json',JSON.stringify({capturedAt:new Date().toISOString(),browser:await browser.version(),scope:'Isolated Chrome and synthetic loopback provider only; no real consent, login replay or inference',checks,errors},null,2));
  console.log(`Response error browser QA: ${checks.length} checks passed (mock provider only).`);
}finally{
  await context.close();await browser.close();
  for(const service of [server,provider]){service.closeAllConnections();await new Promise(resolve=>service.close(resolve));}
}
