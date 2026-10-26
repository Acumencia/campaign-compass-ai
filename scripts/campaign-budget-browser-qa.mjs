import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {createServer} from '../server.mjs';
import {createChatGPTService} from '../server/chatgpt.mjs';
import {MemoryStore,mockProtocol} from '../tests/chatgpt-fixtures.mjs';

// UI billing states are route fixtures; actual ledger enforcement is covered separately.
const directory=await mkdtemp(path.join(os.tmpdir(),'cc-budget-ui-')),checks=[],errors=[],requests=[];
const server=createServer({campaignDirectory:directory,chatgpt:createChatGPTService({store:new MemoryStore(),protocol:mockProtocol(),supported:false})});
let browser,configured=false,fixtureRun=null,offlineSource=null;
const defaults={enabled:true,capUsd:2,provider:'anthropic',model:'claude-opus-5-5',policyVersion:'campaign-usd-v1'};
const authorizedBilling=()=>({policyVersion:'campaign-usd-v1',ceilingUsd:2,reservedUsd:0.12,estimatedUsd:0.12,knownActualUsd:0.04,remainingUsd:1.88,callCount:2,uncertain:false,blockedReason:null});
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1360,height:980}});
 await context.route('**/*',async route=>{
  const request=route.request(),url=request.url(),pathname=new URL(url).pathname;
  if(!url.startsWith(base+'/'))return route.abort();
  if(request.method()==='GET'&&pathname==='/api/campaign'){
   const response=await route.fetch(),json=await response.json();json.campaignDefaults=defaults;
   json.readiness={provider:configured?'anthropic':null,model:configured?'claude-opus-5-5':null,configured,consent:configured,keyPresent:configured,blocked:false,maxOutputTokens:configured?1600:null,retrieval:{configured,authorized:configured,backend:'TEST FIXTURE',method:'canned-local-evidence',blocked:false}};
   if(fixtureRun)json.runs.unshift(fixtureRun);return route.fulfill({response,json});
  }
  if(request.method()==='POST'&&pathname==='/api/campaign/create'&&request.postDataJSON().mode==='live-grounded'){
   assert.ok(configured);fixtureRun={...structuredClone(offlineSource),id:'budget-ui-fixture',version:1,mode:'live-grounded',modeLabel:'TEST FIXTURE - no provider requests',status:'awaiting_approval',billing:authorizedBilling(),revisionCount:0,events:[]};return route.fulfill({status:200,json:fixtureRun});
  }
  if(fixtureRun&&pathname==='/api/campaign/'+fixtureRun.id&&request.method()==='GET')return route.fulfill({status:200,json:fixtureRun});
  if(fixtureRun&&pathname.startsWith('/api/campaign/'+fixtureRun.id+'/')&&request.method()==='POST'){
   const action=pathname.split('/').at(-1);assert.equal(request.postDataJSON().expectedVersion,fixtureRun.version);
   if(action==='revise'){fixtureRun.version++;fixtureRun.revisionCount++;fixtureRun.billing={...fixtureRun.billing,reservedUsd:0.2,estimatedUsd:0.2,knownActualUsd:0.07,remainingUsd:1.8,callCount:3};}
   else if(action==='decide'&&request.postDataJSON().decision==='reject'){fixtureRun.version++;fixtureRun.status='rejected';}
   else throw new Error('Unexpected fixture mutation '+action);
   return route.fulfill({status:200,json:fixtureRun});
  }
  return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async dialog=>{errors.push('Unexpected repeated confirmation: '+dialog.message());await dialog.dismiss();});
 page.on('request',request=>{if(request.url().startsWith(base+'/api/campaign'))requests.push({method:request.method(),url:request.url()});});
 const postCount=()=>requests.filter(r=>r.method==='POST').length;
 await page.goto(base+'/campaign.html');await page.waitForFunction(()=>document.querySelector('#counts').textContent.includes('25 curated'));
 assert.equal(await page.locator('#generation-mode').inputValue(),'live-grounded');assert.equal(postCount(),0);assert.match(await page.locator('#creation-budget-note').innerText(),/\$2 maximum/);
 assert.match(await page.locator('#readiness-content').innerText(),/not confirmed|not ready/);await page.locator('#create').click();assert.equal(postCount(),0);assert.match(await page.locator('#notice').innerText(),/not ready/i);
 checks.push('Enabled campaign defaults select live with a visible $2 cap; missing provider readiness blocks Create and page load makes no mutation');
 await page.locator('#generation-mode').selectOption('offline-template');await page.locator('#create').click();await page.waitForFunction(()=>document.querySelector('#run-state').textContent==='AWAITING APPROVAL');
 const offlineId=await page.locator('#saved-runs').inputValue();offlineSource=await (await page.request.get(base+'/api/campaign/'+offlineId)).json();assert.equal(offlineSource.mode,'offline-template');assert.match(await page.locator('#budget-panel').innerText(),/\$0\.00/);
 checks.push('Explicit offline choice completes the local workflow with zero provider spend');
 configured=true;await page.locator('#new-run').click();await page.locator('#refresh-readiness').click();await page.waitForFunction(()=>document.querySelector('#readiness-content').textContent.includes('Campaign-scoped provider access is ready'));
 assert.equal(await page.locator('#generation-mode').inputValue(),'offline-template');await page.locator('#generation-mode').selectOption('live-grounded');
 const beforeLive=postCount();await page.locator('#create').click();await page.waitForFunction(()=>document.querySelector('#saved-runs').value==='budget-ui-fixture');assert.equal(postCount()-beforeLive,1);assert.match(await page.locator('#budget-panel').innerText(),/\$0\.04/);assert.match(await page.locator('#budget-panel').innerText(),/\$0\.12/);assert.match(await page.locator('#budget-panel').innerText(),/\$1\.88/);
 const beforeReview=postCount();await page.locator('#revise').click();await page.waitForFunction(()=>document.querySelector('#budget-panel').textContent.includes('$0.07'));assert.equal(postCount()-beforeReview,1);
 checks.push('One user-started authorized campaign displays actual, reserved and remaining usage; user-requested review shares the cap without another confirmation');
 await page.reload();await page.waitForFunction(()=>document.querySelector('#budget-panel').textContent.includes('$0.07'));assert.match(await page.locator('#budget-panel').innerText(),/\$1\.80/);
 checks.push('Reload retains the authoritative budget instead of resetting the cap');
 fixtureRun.version++;fixtureRun.billing={...authorizedBilling(),reservedUsd:0.6,estimatedUsd:0.6,remainingUsd:1.4,uncertain:true,blockedReason:'Provider outcome unknown'};
 await page.locator('#refresh-status').click();await page.waitForFunction(()=>document.querySelector('#budget-message').textContent.includes('uncertain charge or outcome'));
 assert.ok(await page.locator('#revise').isDisabled());assert.ok(await page.locator('#resume').isDisabled());const beforeUncertain=postCount();await page.locator('#revise').evaluate(button=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));assert.equal(postCount(),beforeUncertain);assert.match(await page.locator('#budget-panel').innerText(),/\$0\.60/);
 checks.push('Uncertain charge preserves the reserved estimate and blocks further model actions, including a dispatched disabled control');
 fixtureRun.version++;fixtureRun.billing={...authorizedBilling(),reservedUsd:2,estimatedUsd:2,knownActualUsd:1.9,remainingUsd:0,blockedReason:'Campaign spending cap reached'};
 await page.locator('#refresh-status').click();await page.waitForFunction(()=>document.querySelector('#budget-message').textContent.includes('cap reached'));assert.ok(await page.locator('#revise').isDisabled());assert.match(await page.locator('#budget-panel').innerText(),/\$0\.00/);
 checks.push('Exhausted budget has an explicit blocking reason and no enabled model continuation');
 fixtureRun.version++;delete fixtureRun.billing;await page.locator('#refresh-status').click();await page.waitForFunction(()=>document.querySelector('#budget-message').textContent.includes('predates'));
 assert.ok(await page.locator('#revise').isDisabled());assert.ok(await page.locator('#resume').isDisabled());assert.ok(await page.locator('#reject').isEnabled());const beforeLegacy=postCount();await page.locator('#revise').evaluate(button=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));assert.equal(postCount(),beforeLegacy);await page.locator('#refresh-status').click();assert.equal(postCount(),beforeLegacy);
 checks.push('Legacy live run without billing stays readable and refreshable, blocks paid continuation and is never assigned a new budget');
 await page.setViewportSize({width:320,height:800});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('#budget-panel').scrollIntoViewIfNeeded();await mkdir('evidence',{recursive:true});await page.locator('#budget-panel').screenshot({path:'evidence/week3-budget-mobile.png'});
 await page.locator('#reject').click();await page.waitForFunction(()=>document.querySelector('#run-state').textContent==='REJECTED');checks.push('Budget status fits 320px and legacy run can still be rejected without provider calls');
 assert.deepEqual(errors,[]);await writeFile('evidence/week3-budget-browser.json',JSON.stringify({timestamp:new Date().toISOString(),scope:'Disposable local offline workflow plus intercepted billing/live UI snapshots. No real keys, provider requests or spending. Ledger enforcement tested separately.',checks,errors},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});}
