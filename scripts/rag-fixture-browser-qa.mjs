// TEST ONLY browser integration: no model, network service or real credentials.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {createServer} from '../server.mjs';
import {createChatGPTService} from '../server/chatgpt.mjs';
import {MemoryStore,mockProtocol} from '../tests/chatgpt-fixtures.mjs';
import {fixture} from '../tests/rag-fixtures.mjs';
const cleanup=[],f=await fixture({after:fn=>cleanup.push(fn)},{authorizeAccess:async({session})=>!!session});
let mode='answered';const original=f.generation.generate;
f.generation.generate=async(request,options)=>{
 const data=JSON.parse(request.input);
 if(mode==='clarification')return {corpusVersion:data.corpusVersion,status:'clarification',message:'Which product do you mean?',claims:[]};
 const result=await original(request,options);if(mode==='invalid')result.claims[0].citations[0].quote='A fabricated quote that does not occur.';return result;
};
let browser,server;
const checks=[];
try{
 await f.service.buildIndex();
 server=createServer({rag:f.service,loadCorpus:async()=>f.corpus,chatgpt:createChatGPTService({store:new MemoryStore(),protocol:mockProtocol(),supported:false})});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.locator('#dashboard').waitFor({state:'visible'});await page.locator('#ask-workspace-button').click();await page.locator('#ask-options summary').click();await page.waitForFunction(()=>!document.querySelector('#knowledge-submit').disabled);await page.locator('#knowledge-mode').selectOption('rag');
 const ask=async()=>{await page.locator('#knowledge-question').fill('bottle capacity');await page.locator('#knowledge-submit').click();};
 await ask();await page.getByRole('heading',{name:'Cited answer',exact:true}).waitFor();await page.locator('.ask-diagnostics summary').click();assert.match(await page.locator('#knowledge-results blockquote').innerText(),/650 milliliters/);assert.match(await page.locator('#knowledge-results').innerText(),/TEST ONLY fixtures/);checks.push('TEST ONLY pipeline renders cited answer through actual session/CSRF flow');
 await page.locator('#knowledge-results section button').first().click();await page.locator('#knowledge-source pre').waitFor();assert.match(await page.locator('#knowledge-source').innerText(),/650 milliliters/);checks.push('Cited source button opens actual source lines');
 mode='clarification';await ask();await page.getByRole('heading',{name:'Clarification needed',exact:true}).waitFor();assert.match(await page.locator('#knowledge-results').innerText(),/Which product/);checks.push('TEST ONLY clarification renders separately from factual claims');
 await page.locator('#knowledge-source-filter').selectOption('pack');const before=f.calls.generation;await ask();await page.getByRole('heading',{name:'Insufficient evidence',exact:true}).waitFor();assert.equal(f.calls.generation,before);checks.push('Filtered empty retrieval does not invoke generation fixture');
 mode='invalid';await page.locator('#knowledge-source-filter').selectOption('');await ask();await page.waitForFunction(()=>document.querySelector('#knowledge-status').textContent.includes('failed the grounded answer contract'));assert.match(await page.locator('.ask-failure-diagnostics').innerText(),/quote_not_in_source/);assert.equal(await page.locator('#knowledge-results blockquote').count(),0);checks.push('Invalid quotation is rejected before answer display');
 mode='answered';await page.setViewportSize({width:390,height:844});await ask();await page.getByRole('heading',{name:'Cited answer',exact:true}).waitFor();await page.locator('.ask-diagnostics summary').click();assert.equal(await page.locator('#ask-workspace').evaluate(d=>d.scrollWidth<=d.clientWidth),true);checks.push('RAG options and cited output fit 390-pixel dialog');
 assert.deepEqual(errors,[]);await mkdir('evidence',{recursive:true});await page.screenshot({path:'evidence/rag-test-only-mobile.png'});await writeFile('evidence/rag-test-only-browser-qa.json',JSON.stringify({capturedAt:new Date().toISOString(),execution:'TEST ONLY hand-authored vectors and canned JSON; not model or semantic-performance evidence',scope:'Installed Chrome, isolated context, in-memory session store, external traffic blocked',checks,errors},null,2)+'\n');console.log(`${checks.length} TEST ONLY RAG browser checks passed.`);
}finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}for(const clean of cleanup)await clean();}
