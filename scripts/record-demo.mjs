// Records real app interactions with Playwright video. No screenshots are stitched into the video.
// Prerequisite: locally generated narration WAV files and narration-timing.json (see recording-notes).
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import http from 'node:http';
const narration=JSON.parse(await readFile('submission/narration-timing.json','utf8'));
const evidence=await readFile('submission/development-evidence.html');
const evidenceServer=http.createServer((req,res)=>{if(req.url!=='/development'){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(evidence);});
await new Promise(resolve=>evidenceServer.listen(4174,'127.0.0.1',resolve));
await mkdir('submission/recording',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:'submission/recording',size:{width:1440,height:1000}}});
const page=await context.newPage();const start=Date.now();const timeline=[];
async function segment(id,action){await action();const timing=narration.find(n=>n.id===id);const at=(Date.now()-start)/1000;timeline.push({...timing,start:at});console.log(`Recording: ${id} at ${at.toFixed(1)}s`);await page.waitForTimeout((timing.duration+0.8)*1000);}
try{
await page.goto('http://127.0.0.1:4173');await page.locator('#dashboard').waitFor({state:'visible'});
await segment('intro',async()=>{});
await segment('metrics',async()=>{await page.locator('.chart-details summary').first().click();await page.locator('.chart-details summary').first().scrollIntoViewIfNeeded();});
await segment('filters',async()=>{await page.locator('#channel').selectOption('Instagram');await page.locator('#audience').selectOption('Prospecting');await page.locator('[data-view="platforms"]').click();await page.evaluate(()=>scrollTo(0,0));});
await segment('campaigns',async()=>{await page.locator('[data-view="campaigns"]').click();await page.locator('#search').pressSequentially('discovery',{delay:140});});
await segment('trends',async()=>{await page.locator('[data-view="trends"]').click();await page.locator('[data-metric="conversions"]').click();await page.locator('.full-chart').scrollIntoViewIfNeeded();});
await segment('empty',async()=>{await page.locator('#goal').selectOption('Traffic');await page.evaluate(()=>scrollTo(0,0));});
await segment('brief',async()=>{await page.locator('#empty-reset').click();await page.locator('#brief-button').click();await page.locator('#answer .answer-card').waitFor();});
await segment('anomaly',async()=>{await page.locator('[data-question="Explain the CPA anomaly"]').click();await page.locator('#answer .answer-card').waitFor();});
await segment('scenario',async()=>{await page.keyboard.press('Escape');await page.locator('[data-view="lab"]').click();await page.locator('#from-channel').selectOption('Twitter');await page.locator('#to-channel').selectOption('Facebook');await page.locator('#scenario-form button').click();await page.locator('#scenario-result').scrollIntoViewIfNeeded();await page.locator('#review').check();});
await segment('evidence',async()=>{await page.goto('http://127.0.0.1:4174/development');});
await segment('close',async()=>{await page.goto('http://127.0.0.1:4173');await page.locator('#dashboard').waitFor({state:'visible'});});
const duration=(Date.now()-start)/1000;if(duration>295)throw new Error('Recording exceeds safety limit.');
const video=page.video();await context.close();const file=await video.path();await copyFile(file,'submission/campaign-compass-demo-raw.webm');
await writeFile('submission/recording-timeline.json',JSON.stringify({startedAt:new Date(start).toISOString(),duration,video:'campaign-compass-demo-raw.webm',segments:timeline,method:'Continuous Playwright video of real Chrome app interactions; synthetic narration mixed separately; no desktop capture or generated frames'},null,2));
console.log(`Real recording saved. Duration ${duration.toFixed(1)} seconds.`);
}finally{await browser.close();await new Promise(resolve=>evidenceServer.close(resolve));}
