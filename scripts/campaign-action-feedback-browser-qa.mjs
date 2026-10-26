import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from '../server.mjs';
import {createChatGPTService} from '../server/chatgpt.mjs';
import {MemoryStore,mockProtocol} from '../tests/chatgpt-fixtures.mjs';

// Every operation uses a fresh ephemeral service. Vendor traffic is blocked.
const directory=await mkdtemp(path.join(os.tmpdir(),'cc-action-feedback-'));
const checks=[],errors=[],requests=[];
const server=createServer({campaignDirectory:directory,chatgpt:createChatGPTService({store:new MemoryStore(),protocol:mockProtocol(),supported:false})});
let browser,heldRoute,releaseHeld,actionMode='normal',liveFixture=false,liveMutationFixture=null,liveSnapshotOverride=null,delayEdit=false;
const mutationCount=(suffix)=>requests.filter(r=>r.method==='POST'&&r.url.endsWith(suffix)).length;
const readCount=(id)=>requests.filter(r=>r.method==='GET'&&r.url.endsWith('/api/campaign/'+id)).length;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.route('**/*',async route=>{
  const request=route.request(),url=request.url();
  if(!url.startsWith(base+'/'))return route.abort();
  if(request.method()==='GET'&&url===base+'/api/campaign'){
   const response=await route.fetch(),json=await response.json();
   json.campaignDefaults={enabled:liveFixture,capUsd:2,provider:'anthropic',model:'claude-opus-5-5',policyVersion:'campaign-usd-v1'};if(liveFixture)json.readiness={provider:'TEST FIXTURE',model:'no-external-calls',configured:true,consent:true,keyPresent:true,maxOutputTokens:4096,blocked:false,retrieval:{configured:true,authorized:true,backend:'TEST FIXTURE',method:'canned-local-evidence',blocked:false}};
   return route.fulfill({response,json});
  }
  if(liveFixture&&request.method()==='GET'&&/^\/api\/campaign\/[a-zA-Z0-9-]+$/.test(new URL(url).pathname)&&!url.endsWith('/trails')){
   const response=await route.fetch(),json=await response.json();
   if(json.id){json.billing={policyVersion:'campaign-usd-v1',ceilingUsd:2,reservedUsd:0.1,knownActualUsd:0.04,remainingUsd:1.9,callCount:1,uncertain:false,blockedReason:null};if(liveSnapshotOverride)Object.assign(json,liveSnapshotOverride);json.mode='live-grounded';json.modeLabel='TEST FIXTURE - no external provider calls';liveMutationFixture=json;}
   return route.fulfill({response,json});
  }
  if(request.method()==='POST'&&url.endsWith('/edit')&&delayEdit){await new Promise(r=>setTimeout(r,750));return route.continue();}
  if(request.method()==='POST'&&url.endsWith('/revise')){
   if(actionMode==='delayed'){await new Promise(r=>setTimeout(r,750));return route.continue();}
   if(actionMode==='http-error')return route.fulfill({status:503,contentType:'application/json',json:{error:{code:'fixture_unavailable',message:'Fixture service unavailable. Saved drafts are retained.'}}});
   if(actionMode==='hang'){heldRoute=route;return new Promise(resolve=>{releaseHeld=resolve;});}
   if(liveFixture){const json=structuredClone(liveMutationFixture);json.version++;json.revisionCount++;json.status='awaiting_approval';return route.fulfill({status:200,json});}
  }
  return route.continue();
 });
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async dialog=>{errors.push('Unexpected confirmation on an authorized budget: '+dialog.message());await dialog.dismiss();});
 page.on('request',request=>{if(request.url().startsWith(base+'/api/campaign'))requests.push({method:request.method(),url:request.url()});});
 await page.clock.install();
 await page.goto(base+'/campaign.html');
 await page.waitForFunction(()=>document.querySelector('#counts').textContent.includes('25 curated'));
 const completeOffline=async()=>{await page.locator('#generation-mode').selectOption('offline-template');await page.locator('#create').click();await page.waitForFunction(()=>document.querySelector('#run-state').textContent==='AWAITING APPROVAL');};
 await completeOffline();
 assert.equal(await page.locator('#review-feedback').getAttribute('role'),'status');
 assert.ok(await page.locator('#approve').isDisabled());
 assert.match(await page.locator('#approval-reason').innerText(),/check|acknowledg|review/i);
 assert.equal(await page.locator('#approval-check').isChecked(),false);
 checks.push('Approval is disabled with a visible review-checkbox explanation beside the action');

 actionMode='delayed';
 const firstVersion=await page.locator('#bundle-version').innerText(),beforeRevision=mutationCount('/revise');
 await page.locator('#revise').click();
 assert.match(await page.locator('#review-feedback').innerText(),/running|checking|reviewing|progress|working/i);
 assert.ok(await page.locator('#revise').isDisabled());
 await page.locator('#revise').evaluate(button=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));
 await page.waitForFunction(version=>document.querySelector('#bundle-version').textContent!==version,firstVersion);
 await page.waitForFunction(()=>!document.querySelector('#revise').disabled);
 assert.equal(mutationCount('/revise')-beforeRevision,1);
 assert.match(await page.locator('#review-feedback').innerText(),/complete|finished|ready/i);
 actionMode='normal';
 checks.push('Offline review shows immediate progress and completion, and repeated click produces exactly one POST');

 const beforeMissing=mutationCount('/decide');
 await page.locator('#accept-revision').evaluate(button=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));
 assert.match(await page.locator('#review-feedback').innerText(),/no|missing|unavailable|not.*pending/i);
 assert.equal(mutationCount('/decide'),beforeMissing);
 checks.push('Missing proposal gives explicit feedback without a mutation');

 await page.locator('#reject').click();
 await page.waitForFunction(()=>document.querySelector('#run-state').textContent==='REJECTED');
 assert.match(await page.locator('#review-feedback').innerText(),/reject/i);
 assert.match(await page.locator('#review-feedback').innerText(),/new|start/i);
 assert.ok(await page.locator('#revise').isDisabled());
 assert.ok(await page.locator('#approve').isDisabled());
 assert.ok(await page.locator('#export').isDisabled());
 assert.ok(await page.locator('#new-run').isEnabled());
 checks.push('Reject is terminal and directs the user to a new collection; review, approval and export stay blocked');
 await page.locator('#new-run').click();
 await completeOffline();

 const secondId=await page.locator('#saved-runs').inputValue();
 const ackBootstrap=await (await page.request.get(base+'/api/campaign')).json();
 const changeVersionWithoutRevision=async runId=>{let state=await (await page.request.get(base+'/api/campaign/'+runId)).json();for(const decision of ['request_evidence','resume']){const response=await page.request.post(base+'/api/campaign/'+runId+'/decide',{headers:{'x-cc-csrf':ackBootstrap.csrf},data:{decision,expectedVersion:state.version}});assert.equal(response.status(),200);state=await response.json();}return state;};
 await page.locator('#approval-check').check();assert.ok(await page.locator('#approve').isEnabled());
 const refreshedState=await changeVersionWithoutRevision(secondId);
 await page.locator('#refresh-status').click();
 await page.waitForFunction(version=>document.querySelector('#bundle-version').textContent==='BUNDLE V'+version,refreshedState.version);
 assert.equal(await page.locator('#approval-check').isChecked(),false);assert.ok(await page.locator('#approve').isDisabled());
 checks.push('Read-only refresh to a changed bundle version clears the prior review acknowledgement');
 await page.locator('#new-run').click();await completeOffline();
 const thirdId=await page.locator('#saved-runs').inputValue(),sameVersionState=await changeVersionWithoutRevision(thirdId);assert.equal(sameVersionState.version,refreshedState.version);
 await page.locator('#refresh-status').click();await page.waitForFunction(version=>document.querySelector('#bundle-version').textContent==='BUNDLE V'+version,sameVersionState.version);
 await page.locator('#approval-check').check();assert.ok(await page.locator('#approve').isEnabled());
 await page.locator('#saved-runs').selectOption(secondId);
 await page.waitForFunction(id=>localStorage.getItem('cc.week3.run')===id,secondId);
 assert.equal(await page.locator('#approval-check').isChecked(),false);assert.ok(await page.locator('#approve').isDisabled());
 checks.push('Switching saved runs clears acknowledgement even when both runs have the same bundle version');
 await page.locator('#saved-runs').selectOption(thirdId);await page.waitForFunction(id=>localStorage.getItem('cc.week3.run')===id,thirdId);
 const saveText=(await page.locator('#artifact-text').inputValue())+'\nA deliberate editorial note saved by the reviewer.';await page.locator('#artifact-text').fill(saveText);delayEdit=true;
 const beforeSave=mutationCount('/edit');await page.locator('#save-artifact').click();
 assert.ok(await page.locator('#artifact-text').isDisabled());assert.ok(await page.locator('#save-artifact').isDisabled());
 await page.locator('#save-artifact').evaluate(button=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));
 await page.keyboard.type('This input must not replace the saving draft');assert.equal(await page.locator('#artifact-text').inputValue(),saveText);
 await page.waitForFunction(()=>document.querySelector('#run-state').textContent==='NEEDS REVISION'&&!document.querySelector('#artifact-text').disabled);
 assert.equal(await page.locator('#artifact-text').inputValue(),saveText);assert.equal(mutationCount('/edit')-beforeSave,1);delayEdit=false;
 checks.push('Delayed save immediately locks the editor and repeated save, preserving exactly the captured draft text');
 await page.locator('#saved-runs').selectOption(secondId);await page.waitForFunction(id=>localStorage.getItem('cc.week3.run')===id,secondId);await page.waitForFunction(()=>document.querySelector('#run-state').textContent==='AWAITING APPROVAL');

 actionMode='http-error';
 const beforeError=mutationCount('/revise'),versionBeforeError=await page.locator('#bundle-version').innerText();
 await page.locator('#revise').click();
 await page.waitForFunction(()=>document.querySelector('#review-feedback').textContent.includes('Fixture service unavailable'));
 assert.match(await page.locator('#review-feedback').innerText(),/refresh status/i);
 assert.equal(mutationCount('/revise')-beforeError,1);
 assert.equal(await page.locator('#bundle-version').innerText(),versionBeforeError);
 assert.ok(await page.locator('#revise').isEnabled());
 checks.push('HTTP failure is visible at the action, preserves the saved bundle and recommends status refresh');
 actionMode='normal';

 const id=await page.locator('#saved-runs').inputValue();
 const bootstrap=await (await page.request.get(base+'/api/campaign')).json();
 const current=await (await page.request.get(base+'/api/campaign/'+id)).json();
 const external=await page.request.post(base+'/api/campaign/'+id+'/decide',{headers:{'x-cc-csrf':bootstrap.csrf},data:{decision:'request_evidence',expectedVersion:current.version}});
 assert.equal(external.status(),200);
 const beforeStale=mutationCount('/revise'),beforeStaleReads=readCount(id);
 await page.locator('#revise').click();
 await page.waitForFunction(()=>document.querySelector('#run-state').textContent==='WAITING EVIDENCE');
 assert.equal(mutationCount('/revise')-beforeStale,1);
 assert.ok(readCount(id)>beforeStaleReads);
 assert.match(await page.locator('#review-feedback').innerText(),/changed|stale|refresh/i);
 checks.push('A real stale version gets one failed POST and read-only refresh; it never retries the mutation');
 const beforeRefreshPosts=requests.filter(r=>r.method==='POST').length,beforeRefreshReads=readCount(id);
 await page.locator('#refresh-status').click();
 await page.waitForFunction(()=>!document.querySelector('#refresh-status').disabled);
 assert.equal(requests.filter(r=>r.method==='POST').length,beforeRefreshPosts);
 assert.ok(readCount(id)>beforeRefreshReads);
 checks.push('Refresh status is read-only');
 await page.locator('#resume').click();
 await page.waitForFunction(()=>document.querySelector('#run-state').textContent==='AWAITING APPROVAL');

 actionMode='hang';
 const beforeHang=mutationCount('/revise');
 await page.locator('#revise').click();
 while(!heldRoute)await new Promise(r=>setTimeout(r,10));
 await page.clock.fastForward(46000);
 await page.waitForFunction(()=>/timed out|timeout/i.test(document.querySelector('#review-feedback').textContent));
 assert.match(await page.locator('#review-feedback').innerText(),/refresh status/i);
 assert.equal(mutationCount('/revise')-beforeHang,1);
 assert.ok(await page.locator('#revise').isEnabled());
 await heldRoute.abort().catch(()=>{});releaseHeld?.();heldRoute=null;releaseHeld=null;actionMode='normal';
 checks.push('A hanging action times out within the configured bound, unlocks controls and never retries a possibly completed mutation');

 liveFixture=true;
 await page.reload();
 await page.waitForFunction(()=>document.querySelector('#mode-title').textContent.includes('Live'));
 const beforeLive=mutationCount('/revise');
 assert.match(await page.locator('#budget-panel').innerText(),/2\.00/);
 await page.locator('#revise').click();
 await page.waitForFunction(()=>!document.querySelector('#revise').disabled);
 assert.equal(mutationCount('/revise')-beforeLive,1);
 checks.push('A user-requested review on an authorized $2 run sends one POST without another confirmation');
 assert.equal(await page.locator('#run-state').innerText(),'AWAITING APPROVAL');
 const beforeFreshResumePosts=requests.filter(r=>r.method==='POST').length,beforeFreshResumeReads=readCount(id);
 liveSnapshotOverride={status:'stopped',resumeStatus:'running',billing:null,version:Number((await page.locator('#bundle-version').innerText()).replace('BUNDLE V',''))+1};
 await page.locator('#resume').click();
 await page.waitForFunction(()=>document.querySelector('#budget-message').textContent.includes('predates'));
 assert.ok(readCount(id)>beforeFreshResumeReads);assert.equal(requests.filter(r=>r.method==='POST').length,beforeFreshResumePosts);assert.equal(await page.locator('#run-state').innerText(),'STOPPED');
 assert.match(await page.locator('#review-feedback').innerText(),/predates|blocked/i);assert.ok(await page.locator('#resume').isDisabled());
 checks.push('Resume refreshes stale local state first; newly discovered legacy live run without billing blocks all continuation without a mutation');
 assert.deepEqual(errors,[]);
 await mkdir('evidence',{recursive:true});
 await writeFile('evidence/week3-action-feedback-browser.json',JSON.stringify({timestamp:new Date().toISOString(),scope:'Disposable local server and browser, real offline workflow, intercepted failures/timeouts and live snapshots. Zero paid/provider calls; external network blocked. User data untouched.',checks,errors,mutationRequests:requests.filter(r=>r.method==='POST').length},null,2));
 console.log(JSON.stringify({passed:checks.length,checks},null,2));
}finally{
 if(heldRoute)await heldRoute.abort().catch(()=>{});releaseHeld?.();
 await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));
 await rm(directory,{recursive:true,force:true});
}
