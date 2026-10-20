import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {createServer} from '../server.mjs';
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`,checks=[];
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.locator('#dashboard').waitFor({state:'visible'});
 await page.locator('#ask-workspace-button').click();await page.waitForFunction(()=>!document.querySelector('#knowledge-submit').disabled);
 await page.locator('#ask-options summary').click();await page.locator('#knowledge-mode').selectOption('lexical');assert.match(await page.locator('#ask-ready-title').innerText(),/Offline source/);checks.push('Corpus manifest loads without account connection');
 await page.locator('#knowledge-question').fill('Can the Dayline pack be called waterproof?');await page.locator('#knowledge-submit').click();await page.locator('#knowledge-results article').first().waitFor();
 assert.match(await page.locator('#knowledge-status').innerText(),/No embedding or generation call/);assert.match(await page.locator('#knowledge-results').innerText(),/score/);checks.push('Question returns explicitly lexical excerpts and scores');
 await page.locator('#knowledge-results article button').first().click();await page.locator('#knowledge-source pre').waitFor();assert.match(await page.locator('#knowledge-source').innerText(),/1  #/);checks.push('Source opens with numbered lines');
 await page.locator('#knowledge-button').click();await page.waitForFunction(()=>!document.querySelector('#knowledge-submit').disabled);await page.keyboard.press('Escape');assert.equal(await page.locator('#knowledge-dialog').evaluate(d=>d.open),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'knowledge-button');checks.push('Escape closes and restores focus');
 await page.locator('[data-view=overview]').click();await page.getByLabel('Audience',{exact:true}).selectOption('Prospecting');await page.getByLabel('Campaign goal',{exact:true}).selectOption('Traffic');await page.locator('#empty').waitFor({state:'visible'});await page.locator('#ask-workspace-button').click();await page.waitForFunction(()=>!document.querySelector('#knowledge-submit').disabled);checks.push('Knowledge remains available when dashboard filters are empty');
 await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('#ask-workspace').evaluate(d=>d.getBoundingClientRect().width<=innerWidth),true);assert.equal(await page.locator('#ask-workspace').evaluate(d=>d.scrollWidth<=d.clientWidth),true);checks.push('Knowledge dialog fits 390-pixel viewport');
 await page.locator('#knowledge-question').fill('qzxqzx');await page.locator('#knowledge-submit').click();await page.getByText('No lexical matches.',{exact:false}).waitFor();checks.push('No-match state makes no answer claim');
 await page.locator('#knowledge-mode').selectOption('rag');await page.locator('#knowledge-question').fill('What is the bottle capacity?');await page.locator('#knowledge-submit').click();await page.getByRole('heading',{name:'RAG is not configured',exact:true}).waitFor();assert.match(await page.locator('#knowledge-status').innerText(),/No model request/);checks.push('RAG mode reports missing providers without a fabricated answer');
 assert.deepEqual(errors,[]);checks.push('No uncaught browser errors');
 await mkdir('evidence',{recursive:true});await page.screenshot({path:'evidence/knowledge-mobile.png'});await writeFile('evidence/knowledge-browser-qa.json',JSON.stringify({capturedAt:new Date().toISOString(),browser:await browser.version(),scope:'Isolated installed Chrome; external traffic blocked; no model calls',checks,errors},null,2)+'\n');console.log(`${checks.length} Knowledge browser checks passed.`);
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
