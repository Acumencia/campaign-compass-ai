import {chromium} from 'playwright';

import assert from 'node:assert/strict';

import {mkdtemp,rm,writeFile} from 'node:fs/promises';

import os from 'node:os';import path from 'node:path';

import {createServer} from '../server.mjs';

import {createCampaignService} from '../server/campaign.mjs';

import {createChatGPTService} from '../server/chatgpt.mjs';

import {MemoryStore,mockProtocol} from '../tests/chatgpt-fixtures.mjs';

const directory=await mkdtemp(path.join(os.tmpdir(),'cc-proposal-ui-')),checks=[],errors=[];

let calls=0,proposalCalls=0,delayProposal=0;

const wait=(ms,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(Object.assign(new Error('Fixture cancelled'),{code:'cancelled'}));},{once:true});});

const generator={enhance:async({artifacts})=>{calls++;return structuredClone(artifacts);},check:async({artifacts,signal})=>{calls++;await wait(50,signal);return artifacts.find(a=>a.id==='linkedin').text.includes('Revised narrative for clarity.')?[]:[{artifactId:'linkedin',issue:'The opening needs clearer narrative.',suggestion:'Add the fixture revision while retaining manual wording.'}];},proposeRevision:async({artifacts,signal})=>{calls++;proposalCalls++;await wait(delayProposal,signal);return artifacts.map(a=>({...structuredClone(a),text:a.text+'\nRevised narrative for clarity.'}));},status:()=>({provider:'TEST FIXTURE',model:'canned-no-provider-calls',calls,tokens:0,cost:0})};

const service=createCampaignService({directory});

const facade={...service,advance:(o,id,args)=>service.advance(o,id,{...args,generator}),revise:(o,id,args)=>service.revise(o,id,{...args,generator}),decide:(o,id,args)=>service.decide(o,id,{...args,generator})};

const server=createServer({campaignService:facade,campaignDirectory:directory,chatgpt:createChatGPTService({store:new MemoryStore(),protocol:mockProtocol(),supported:false})});let browser;

try{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.route('**/*',async route=>{if(!route.request().url().startsWith(base+'/'))return route.abort();if(route.request().url()===base+'/api/campaign'&&route.request().method()==='GET'){const response=await route.fetch(),body=await response.json();body.campaignDefaults={enabled:true,capUsd:2,provider:'anthropic',model:'claude-opus-5-5',policyVersion:'campaign-usd-v1'};body.readiness={provider:'TEST FIXTURE',model:'canned-no-provider-calls',configured:true,consent:true,keyPresent:true,maxOutputTokens:4096,blocked:false,retrieval:{configured:true,authorized:true,backend:'TEST FIXTURE',method:'canned-local-evidence',blocked:false}};return route.fulfill({response,json:body});}return route.continue();});const page=await context.newPage();page.on('dialog',async dialog=>{errors.push('Unexpected repeated confirmation: '+dialog.message());await dialog.dismiss();});page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/campaign.html');await page.waitForFunction(()=>document.querySelector('#readiness-content').textContent.includes('TEST FIXTURE'));

const start=async()=>{await page.locator('#generation-mode').selectOption('live-grounded');await page.locator('#create').click();await page.waitForFunction(()=>document.querySelector('#run-state').textContent==='NEEDS REVISION');};await start();await page.locator('[data-artifact="linkedin"]').click();await page.locator('#artifact-text').fill((await page.locator('#artifact-text').inputValue())+'\nPersonal editorial choice.');await page.locator('#save-artifact').click();await page.waitForFunction(()=>document.querySelector('#edit-state').textContent==='SAVED');const original=await page.locator('#artifact-text').inputValue();

delayProposal=900;await page.locator('#revise').click();await page.locator('#revise').evaluate(b=>b.dispatchEvent(new MouseEvent('click',{bubbles:true})));await page.waitForFunction(()=>document.querySelector('#run-state').textContent==='AWAITING REVISION DECISION');assert.equal(proposalCalls,1);assert.equal(await page.locator('#artifact-text').inputValue(),original);assert.match(await page.locator('#proposal-comparison').innerText(),/includes manual edits/);await page.locator('#proposal-comparison summary').first().click();assert.match(await page.locator('.comparison').innerText(),/Personal editorial choice/);assert.match(await page.locator('.comparison').innerText(),/Revised narrative/);assert.ok(await page.locator('#approve').isDisabled());checks.push('Model fixture creates explicit proposal; current manual text unchanged; repeated revise dispatch makes one operation');

await page.locator('#reject-revision').click();await page.waitForFunction(()=>document.querySelector('#run-state').textContent==='NEEDS REVISION');assert.equal(await page.locator('#artifact-text').inputValue(),original);checks.push('Rejecting proposal preserves saved manual text without automatic retry');

await page.locator('#revise').click();await page.waitForFunction(()=>document.querySelector('#run-state').textContent==='AWAITING REVISION DECISION');await page.reload();await page.waitForFunction(()=>document.querySelector('#run-state').textContent==='AWAITING REVISION DECISION');await page.locator('[data-artifact="linkedin"]').click();assert.equal(await page.locator('#artifact-text').inputValue(),original);await page.locator('#accept-revision').click();await page.locator('#accept-revision').evaluate(b=>b.dispatchEvent(new MouseEvent('click',{bubbles:true})));await page.waitForFunction(()=>document.querySelector('#run-state').textContent==='AWAITING APPROVAL');assert.match(await page.locator('#artifact-text').inputValue(),/Personal editorial choice/);assert.match(await page.locator('#artifact-text').inputValue(),/Revised narrative/);assert.ok(await page.locator('#export').isDisabled());assert.ok(await page.locator('#revise').isDisabled());checks.push('Pending proposal survives refresh; explicit accept applies proposed text once and rechecks, still requiring final approval; two-round bound holds');

await page.locator('#new-run').click();await start();delayProposal=2500;await page.locator('#revise').click();await page.waitForFunction(()=>document.querySelector('#timeline').textContent.includes('revision'));await page.waitForTimeout(650);await page.locator('#stop').click();await page.waitForFunction(()=>document.querySelector('#run-state').textContent==='STOPPED');assert.ok(await page.locator('#accept-revision').isDisabled());await page.reload();await page.waitForFunction(()=>document.querySelector('#run-state').textContent==='STOPPED');await page.locator('#resume').click();await page.waitForFunction(()=>document.querySelector('#run-state').textContent==='NEEDS REVISION');delayProposal=0;await page.locator('#revise').click();await page.waitForFunction(()=>document.querySelector('#run-state').textContent==='AWAITING REVISION DECISION');checks.push('Interrupted proposal operation stops through backend abort, preserves checkpoint across refresh and resumes bounded revision');

await page.locator('#proposal-comparison summary').first().click();await page.setViewportSize({width:320,height:800});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);checks.push('Current/proposed comparison stacks without horizontal overflow at 320px');await page.locator('#workspace').evaluate(el=>el.insertAdjacentHTML('afterbegin','<p id="fixture-label">TEST FIXTURE · Canned model responses and readiness · No external provider calls</p>'));await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0);});await page.screenshot({path:'evidence/week3-proposal-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0);});await page.screenshot({path:'evidence/week3-proposal-desktop.png',fullPage:true});

await page.locator('[data-artifact="linkedin"]').click();await page.locator('#artifact-text').fill((await page.locator('#artifact-text').inputValue())+'\nA new manual decision.');await page.locator('#save-artifact').click();await page.waitForFunction(()=>document.querySelector('#proposal-version').textContent.startsWith('STALE'));assert.ok(await page.locator('#accept-revision').isDisabled());assert.match(await page.locator('#artifact-text').inputValue(),/A new manual decision/);checks.push('Manual edits invalidate pending proposal and disable stale acceptance without losing new text');assert.deepEqual(errors,[]);await writeFile('evidence/week3-proposal-browser.json',JSON.stringify({timestamp:new Date().toISOString(),scope:'Real local workflow and browser; injected canned generator fixture and readiness; zero external provider calls',checks,errors,generatorCalls:calls,proposalCalls},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));

}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});}

