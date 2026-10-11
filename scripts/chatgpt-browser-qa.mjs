import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {createServer} from '../server.mjs';
import {createChatGPTService} from '../server/chatgpt.mjs';
import {ChatGPTError} from '../server/chatgpt-protocol.mjs';
import {MemoryStore,mockProtocol} from '../tests/chatgpt-fixtures.mjs';

const store=new MemoryStore(),protocol=mockProtocol();
const server=createServer({chatgpt:createChatGPTService({store,protocol,supported:true})});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();const errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('https://**/*',route=>route.abort()); // No real authorization or provider traffic is possible.
const record=check=>checks.push({check,status:'passed'});
try{
  await page.goto(base);await page.locator('#dashboard').waitFor({state:'visible'});
  await page.locator('#connection-button').click();await page.getByRole('button',{name:'Continue with ChatGPT',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('#continue-chatgpt').disabled);
  assert.equal(store.writes,0);assert.match(await page.locator('#connection-status').innerText(),/Not connected/);
  assert.equal(await page.locator('#connection-form').getAttribute('method'),'post');record('Disconnected UI is read-only; consent is a native user-operated form');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('#connection-dialog').evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth),true);
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'connection-button');record('Connection controls fit mobile and Escape restores focus');
  await page.setViewportSize({width:1440,height:1000});
  // Test-only OAuth simulation. Never navigate to or call the real authorization service.
  const initial=await (await context.request.get(base+'/api/chatgpt/session')).json();
  const started=await context.request.post(base+'/auth/start',{form:{csrf:initial.csrf,profileId:''},headers:{Origin:base},maxRedirects:0});
  assert.equal(started.status(),303);
  const auth=new URL(started.headers().location);
  const returned=await context.request.get(base+'/auth/callback?'+new URLSearchParams({state:auth.searchParams.get('state'),code:'fixture-code',client_id:'fixture-client'}),{maxRedirects:0});
  assert.equal(returned.status(),303);
  await page.reload();await page.locator('#plan-welcome').waitFor({state:'visible'});
  await page.locator('#welcome-got-it').click();await page.locator('#plan-welcome').waitFor({state:'hidden'});
  await page.locator('#refresh-models').click();await page.locator('#connection-model option[value="fixture-model"]').waitFor({state:'attached'});
  await page.locator('#connection-model').selectOption('fixture-model');await page.waitForFunction(()=>document.querySelector('[data-connection-banner]').textContent.includes('Using ChatGPT plan'));
  record('Mock consent returns to first-use confirmation and account-specific model picker');
  await page.locator('#close-connection').click();await page.locator('#brief-button').click();await page.locator('#answer .answer-card').waitFor();
  assert.match(await page.locator('#answer').innerText(),/CHATGPT MODEL/);assert.match(await page.locator('#answer').innerText(),/total.spend/);
  assert.doesNotMatch(await page.locator('body').innerText(),/fixture-access|fixture-refresh|fixture-id/);record('Mock completed inference renders exact evidence without exposing tokens');
  protocol.infer=async()=>{throw new ChatGPTError('subscription_sharing_usage_limit_exceeded',429);};
  await page.locator('[data-question="Give me a campaign brief"]').click();await page.waitForFunction(()=>document.querySelector('#answer').textContent.includes('DETERMINISTIC FALLBACK'));
  assert.match(await page.locator('#answer').innerText(),/usage limit reached/);
  await page.keyboard.press('Escape');await page.locator('#connection-button').click();await page.locator('#retry-usage').waitFor({state:'visible'});
  assert.equal(await page.locator('#refresh-models').isDisabled(),true);assert.match(await page.locator('#connection-limit').innerText(),/Usage limit reached/);record('Usage failure shows labelled fallback, pauses requests and offers Manage usage');
  await page.locator('#retry-usage').click();await page.locator('#retry-usage').waitFor({state:'hidden'});await page.locator('#close-connection').click();
  let begin,aborted;const begun=new Promise(resolve=>{begin=resolve;}),cancelled=new Promise(resolve=>{aborted=resolve;});
  protocol.infer=async(_,model,request,signal)=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{aborted();reject(new ChatGPTError('cancelled',499));},{once:true});begin();});
  await page.locator('#brief-button').click();await begun;await page.keyboard.press('Escape');await cancelled;
  assert.equal(await page.locator('#answer').innerText(),'');record('Closing copilot aborts mocked upstream work and discards the answer');
  await page.locator('#connection-button').click();await page.locator('#disconnect-chatgpt').click();await page.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('revoked'));
  assert.equal(store.state.profiles[0].tokens,undefined);record('Disconnect revokes mock session, clears tokens and restores demo state');
  assert.deepEqual(errors,[]);record('No uncaught browser errors in connection lifecycle');
  await mkdir('evidence',{recursive:true});await writeFile(process.env.CHATGPT_QA_OUTPUT||'evidence/chatgpt-browser-qa.json',JSON.stringify({capturedAt:new Date().toISOString(),browser:await browser.version(),scope:'Mock OAuth and mock inference in isolated Chrome; no real account consent or provider requests',checks,errors},null,2));
  console.log(`ChatGPT browser QA: ${checks.length} checks passed (mock authorization/inference only).`);
}finally{await context.close();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
