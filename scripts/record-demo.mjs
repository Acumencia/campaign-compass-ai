import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8'}).trim();
const preflight=process.env.DEMO_PREFLIGHT==='1';
await mkdir(new URL('../submission/recording/qa/',import.meta.url),{recursive:true});
const narration=JSON.parse(await readFile(new URL('../submission/narration-timing.json',import.meta.url),'utf8'));
const pages={'/development':await readFile(new URL('../submission/development-evidence.html',import.meta.url)),'/verification':await readFile(new URL('../submission/verification-evidence.html',import.meta.url))};
const evidenceServer=http.createServer((req,res)=>{if(!pages[req.url]){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(pages[req.url]);});
await new Promise(resolve=>evidenceServer.listen(0,'127.0.0.1',resolve));
const evidenceBase=`http://127.0.0.1:${evidenceServer.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:fileURLToPath(new URL('../submission/recording/',import.meta.url)),size:{width:1440,height:1000}}});
await context.route('https://**/*',route=>route.abort());
await context.route('http://127.0.0.1:4173/auth/**',route=>route.abort());
const page=await context.newPage(),start=Date.now(),timeline=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
async function segment(id,action,during){
  await action();const timing=narration.find(n=>n.id===id),at=(Date.now()-start)/1000;
  timeline.push({...timing,start:at});console.log(`Recording: ${id} at ${at.toFixed(1)}s`);
  await page.screenshot({path:fileURLToPath(new URL(`../submission/recording/qa/${id}.png`,import.meta.url))});
  await Promise.all([page.waitForTimeout(preflight?100:(timing.duration+0.8)*1000),!preflight&&during?during():Promise.resolve()]);
}
try{
  await page.goto('http://127.0.0.1:4173/');await page.locator('#dashboard').waitFor({state:'visible'});
  await segment('intro',async()=>{});
  await segment('metrics',async()=>{await page.locator('.chart-details summary').first().click();},async()=>{await page.waitForTimeout(7500);await page.locator('.chart-details').first().scrollIntoViewIfNeeded();});
  await segment('filters',async()=>{await page.locator('#channel').selectOption('Instagram');await page.locator('#audience').selectOption('Prospecting');await page.locator('[data-view="platforms"]').click();await page.evaluate(()=>scrollTo(0,0));});
  await segment('campaigns',async()=>{await page.locator('[data-view="campaigns"]').click();await page.locator('#search').pressSequentially('discovery',{delay:110});});
  await segment('trends',async()=>{await page.locator('[data-view="trends"]').click();await page.locator('[data-metric="conversions"]').click();await page.locator('.full-chart').scrollIntoViewIfNeeded();});
  await segment('glossary',async()=>{await page.locator('#reset').click();await page.locator('#glossary-button').click();await page.locator('#glossary-search').fill('CPA');});
  await segment('brief',async()=>{await page.locator('#close-glossary').click();await page.locator('#brief-button').click();await page.locator('#answer .answer-card').waitFor();assert.match(await page.locator('#answer').innerText(),/DETERMINISTIC DEMO/);});
  await segment('anomaly',async()=>{await page.locator('[data-question="Explain the CPA anomaly"]').click();await page.locator('#answer .answer-card').waitFor();});
  await segment('scenario',async()=>{await page.locator('#close-assistant').click();await page.locator('[data-view="lab"]').click();await page.locator('#from-channel').selectOption('Twitter');await page.locator('#to-channel').selectOption('Facebook');await page.locator('#scenario-form button').click();await page.locator('#scenario-result').scrollIntoViewIfNeeded();assert.equal(await page.locator('#export-proposal').isDisabled(),true);});
  await segment('review',async()=>{await page.locator('#review').check();assert.equal(await page.locator('#export-proposal').isEnabled(),true);});
  await segment('connection',async()=>{
    assert.equal(await page.locator('#connection-profile option').count(),1,'Recording must contain no saved account entries');
    assert.equal((await page.locator('#connection-account').textContent()).trim(),'');
    await page.locator('#connection-button').click();await page.locator('#connection-dialog').waitFor({state:'visible'});
    assert.match(await page.locator('#connection-status').innerText(),/Not connected/);
  });
  await segment('build',async()=>{await page.goto(evidenceBase+'/development');});
  await segment('verification',async()=>{await page.goto(evidenceBase+'/verification');});
  await segment('close',async()=>{await page.goto('http://127.0.0.1:4173/');await page.locator('#dashboard').waitFor({state:'visible'});});
  const duration=(Date.now()-start)/1000;assert.ok(duration<295);assert.deepEqual(errors,[]);
  const video=page.video();await context.close();const file=await video.path();
  if(preflight){console.log('All fourteen recording interactions passed preflight.');process.exitCode=0;}else{
  await copyFile(file,new URL('../submission/campaign-compass-demo-raw.webm',import.meta.url));
  await writeFile(new URL('../submission/recording-timeline.json',import.meta.url),JSON.stringify({startedAt:new Date(start).toISOString(),duration,applicationCommit:sourceCommit,evidenceMilestoneCommit:'6977f67c6a3878e78000424e6d1039cdc7c016d9',video:'campaign-compass-demo-raw.webm',browser:await browser.version(),segments:timeline,method:'Continuous real Chrome app interactions and actual saved source/test evidence; no generated frames or desktop capture; Microsoft Zira synthetic narration mixed separately',liveInferenceVerified:false,liveAuthorizationAttempted:false,errors},null,2));
  console.log(`Real current-version recording saved: ${duration.toFixed(2)} seconds.`);
  }
}finally{await browser.close();await new Promise(resolve=>evidenceServer.close(resolve));}
