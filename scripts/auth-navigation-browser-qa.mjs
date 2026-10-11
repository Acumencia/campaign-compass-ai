import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import {writeFile,mkdir} from 'node:fs/promises';
import {createServer} from '../server.mjs';
import {createChatGPTService} from '../server/chatgpt.mjs';
import {MemoryStore,mockProtocol} from '../tests/chatgpt-fixtures.mjs';

const store=new MemoryStore(),protocol=mockProtocol();
const escape=value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
let base;
// The authorization destination is an actual second loopback server, never
// OpenAI. Redirect following cannot escape a route-interception mock here.
const provider=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.2');
  const callback=base+'/auth/callback?'+new URLSearchParams({state:url.searchParams.get('state'),code:'fixture-code',client_id:'fixture-client'});
  res.writeHead(200,{'Content-Type':'text/html','Referrer-Policy':'no-referrer'});
  res.end(`<title>Mock provider only</title><a id="return" href="${escape(callback)}">Return to app</a><a id="popup" target="_blank" rel="noopener" href="${escape(callback)}">Return in new window</a>`);
});
await new Promise(resolve=>provider.listen(0,'127.0.0.2',resolve));
const providerBase=`http://127.0.0.2:${provider.address().port}`;
protocol.configuration=async()=>({issuer:'https://auth.openai.com',authorization_endpoint:providerBase+'/authorize'});
const server=createServer({chatgpt:createChatGPTService({store,protocol,supported:true})});
let legacy=false,phase='setup';
const observations=[],checks=[];
server.on('request',(req,res)=>{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(legacy&&pathname==='/')res.setHeader('Referrer-Policy','no-referrer'); // Reproduce the original document header only.
  if(['/auth/start','/auth/callback','/'].includes(pathname))observations.push({phase,path:pathname,method:req.method,
    origin:req.headers.origin??null,site:req.headers['sec-fetch-site']??null,mode:req.headers['sec-fetch-mode']??null,
    referrerPresent:!!req.headers.referer}); // Never retain query, cookies, form data or OAuth values.
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true});
const contexts=[];
const record=label=>checks.push({check:label,status:'passed'});
async function contextFor(){
  const context=await browser.newContext();contexts.push(context);
  await context.route('https://**/*',route=>route.abort());
  return context;
}
async function openForm(context){
  const page=await context.newPage();await page.goto(base);await page.locator('#connection-button').click();
  await page.waitForFunction(()=>!document.querySelector('#continue-chatgpt').disabled);return page;
}
async function submit(page){
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/auth/start');
  await page.locator('#continue-chatgpt').click();return response;
}
async function attack(context,origin,{opaque=false,callback=false}={}){
  const state=await (await context.request.get(base+'/api/chatgpt/session')).json();
  const attackURL=origin+'/fixture';
  await context.route(attackURL,route=>route.fulfill({status:200,contentType:'text/html',headers:{'Referrer-Policy':opaque?'no-referrer':'origin'},body:callback
    ? `<a id="attack" href="${escape(base+'/auth/callback?state=forged-fixture&code=fixture-code&client_id=fixture-client')}">Forged callback</a>`
    : `<form method="post" action="${base}/auth/start"><input name="csrf" value="${escape(state.csrf)}"><button id="attack">Submit attack fixture</button></form>`}));
  const page=await context.newPage();await page.goto(attackURL);
  const response=page.waitForResponse(r=>new URL(r.url()).pathname===(callback?'/auth/callback':'/auth/start'));
  await page.locator('#attack').click();const result=await response;
  assert.equal(result.status(),callback?303:403);
  return page;
}
try{
  phase='legacy-policy';legacy=true;
  const legacyContext=await contextFor(),legacyPage=await openForm(legacyContext);
  assert.equal((await submit(legacyPage)).status(),403);
  assert.ok(observations.some(item=>item.phase===phase&&item.path==='/auth/start'&&item.origin==='null'&&item.site==='same-origin'));
  assert.equal(store.writes,0);assert.equal(protocol.calls.tokens.length,0);
  record('Original no-referrer document reproduces native POST Origin null and rejection before OAuth');legacy=false;

  phase='native-form';
  const context=await contextFor(),page=await openForm(context),pagesBefore=context.pages().length;
  const started=await submit(page);assert.equal(started.status(),303);assert.equal(started.headers()['referrer-policy'],'no-referrer');
  await page.locator('#return').waitFor();assert.equal(context.pages().length,pagesBefore);
  assert.ok(observations.some(item=>item.phase===phase&&item.path==='/auth/start'&&item.origin===base&&item.site==='same-origin'));
  record('Actual Continue button submits exact same-origin form and navigates in the same tab');
  phase='provider-return';
  const callbackResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/auth/callback');
  await page.locator('#return').click();assert.equal((await callbackResponse).headers()['referrer-policy'],'no-referrer');
  await page.locator('#plan-welcome').waitFor({state:'visible'});
  assert.ok(observations.some(item=>item.phase===phase&&item.path==='/auth/callback'&&item.origin===null&&item.site==='cross-site'&&item.mode==='navigate'));
  assert.ok(observations.filter(item=>item.phase===phase&&item.path==='/').every(item=>!item.referrerPresent));
  assert.equal(protocol.calls.tokens.length,1);assert.equal(protocol.calls.tokens[0].redirect_uri,base+'/auth/callback');
  record('Cross-site provider GET callback without Origin succeeds with session/state and exact redirect binding');
  record('OAuth start and callback redirects suppress referrers; callback parameters do not leak to app navigation');

  phase='native-csrf';
  const popupContext=await contextFor(),invalidPage=await openForm(popupContext),writesBeforeInvalid=store.writes;
  await invalidPage.locator('#connection-csrf').evaluate(input=>{input.value='invalid-fixture';});
  assert.equal((await submit(invalidPage)).status(),403);assert.equal(store.writes,writesBeforeInvalid);
  record('Native same-origin submission with an invalid CSRF token fails before creating a connection');

  phase='popup-return';
  const popupPage=await openForm(popupContext);assert.equal((await submit(popupPage)).status(),303);await popupPage.locator('#popup').waitFor();
  const popupPromise=popupContext.waitForEvent('page');await popupPage.locator('#popup').click();const popup=await popupPromise;
  await popup.locator('#plan-welcome').waitFor({state:'visible'});assert.equal(protocol.calls.tokens.length,2);
  record('Optional provider return in a new window retains the same browser-bound flow; app itself needs no popup');

  const callsBefore=protocol.calls.tokens.length,writesBefore=store.writes;
  phase='external-origin';await attack(context,providerBase);
  phase='opaque-origin';await attack(context,providerBase,{opaque:true});
  phase='different-port';await attack(context,'http://127.0.0.1:'+(server.address().port===65534?65533:65534));
  assert.equal(store.writes,writesBefore);assert.equal(protocol.calls.tokens.length,callsBefore);
  record('External, opaque and different-port form attacks fail even with a valid fixture CSRF token');
  phase='forged-callback';const forgedPage=await attack(popupContext,providerBase,{callback:true});
  await forgedPage.locator('#connection-status').waitFor({state:'visible'});
  assert.match(await forgedPage.locator('#connection-status').innerText(),/expired|does not match/);
  assert.equal(protocol.calls.tokens.length,callsBefore);
  record('Forged cross-site callback never exchanges a code and reports the invalid state');

  await mkdir('evidence',{recursive:true});
  await writeFile(process.env.AUTH_NAVIGATION_QA_OUTPUT||'evidence/auth-navigation-browser-qa.json',JSON.stringify({capturedAt:new Date().toISOString(),browser:await browser.version(),
    scope:'Real native browser navigation between two loopback servers; mock OAuth only; no real grant or inference',checks,
    evidence:'Metadata assertions were performed in memory; OAuth query/body/cookie values are excluded from artifacts'},null,2));
  console.log(`Native OAuth navigation QA: ${checks.length} checks passed (mock provider only).`);
}catch(error){console.error(`Native navigation QA failed in ${phase}: ${error.name}. No authorization values were logged.`);console.error(JSON.stringify(observations.filter(item=>item.phase===phase)));process.exitCode=1;}
finally{for(const context of contexts)await context.close();await browser.close();server.closeAllConnections();provider.closeAllConnections();await Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>provider.close(resolve))]);}
