import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
const checks=[];const record=label=>checks.push({check:label,status:'passed'});
try{
  await page.goto(process.env.APP_URL||'http://127.0.0.1:4173');await page.locator('#dashboard').waitFor({state:'visible'});
  assert.match(await page.locator('#filter-summary').innerText(),/336 daily records/);record('Dataset and overview render');
  await page.locator('#brief-button').click();await page.locator('#answer .answer-card').waitFor();
  assert.match(await page.locator('#answer').innerText(),/total.spend/);assert.match(await page.locator('.mode-banner').innerText(),/No live model/);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#assistant-dialog').evaluate(d=>d.open),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'brief-button');record('Grounded brief, Escape, focus return');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'start');record('Keyboard navigation reaches date filters');
  await page.getByLabel('Channel',{exact:true}).selectOption('Instagram');await page.getByLabel('Audience',{exact:true}).selectOption('Prospecting');
  for(const view of ['platforms','campaigns','trends','lab','overview']){await page.locator(`[data-view="${view}"]`).click();assert.match(await page.locator('#filter-summary').innerText(),/28 daily records/);}record('Shared filters persist across all five views');
  await page.locator('[data-view="campaigns"]').click();await page.locator('#search').fill('not a campaign');assert.match(await page.locator('#campaign-results').innerText(),/No campaigns match/);record('Campaign search empty result');
  await page.getByLabel('Campaign goal',{exact:true}).selectOption('Traffic');assert.equal(await page.locator('#empty').isVisible(),true);assert.equal(await page.locator('#brief-button').isDisabled(),true);record('Global empty state disables brief');
  await page.locator('#empty-reset').click();await page.locator('[data-view="lab"]').click();await page.locator('#scenario-form button').click();assert.equal(await page.locator('#export-proposal').isDisabled(),true);await page.locator('#review').check();assert.equal(await page.locator('#export-proposal').isEnabled(),true);record('Review gate enables proposal export');
  const downloadPromise=page.waitForEvent('download');await page.locator('#export-proposal').click();const download=await downloadPromise;assert.equal(download.suggestedFilename(),'campaign-compass-reviewed-proposal.json');record('Reviewed proposal downloads locally');
  await page.setViewportSize({width:390,height:844});
  for(const view of ['overview','platforms','campaigns','trends','lab']){await page.locator(`[data-view="${view}"]`).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await page.locator('[data-view="trends"]').click();const bounds=await page.locator('[data-metric="revenue"]').boundingBox();assert.ok(bounds.x+bounds.width<=390);record('All views fit mobile viewport; metric buttons remain inside viewport');
  await page.locator('#brief-button').click();await page.locator('#answer .answer-card').waitFor();assert.equal(await page.locator('#assistant-dialog').evaluate(d=>d.getBoundingClientRect().width<=window.innerWidth),true);await page.keyboard.press('Escape');record('Mobile copilot fits viewport');
  const failure=await context.newPage();await failure.route('**/data/campaigns.csv',route=>route.fulfill({status:500,body:'Unavailable'}));await failure.goto('http://127.0.0.1:4173');await failure.locator('#error').waitFor({state:'visible'});assert.equal(await failure.locator('#brief-button').isDisabled(),true);record('Real browser handles dataset loading failure');
  assert.deepEqual(errors,[]);record('No uncaught application errors');
  await mkdir('evidence',{recursive:true});await writeFile('evidence/browser-qa.json',JSON.stringify({capturedAt:new Date().toISOString(),browser:await browser.version(),automation:'Playwright using installed Chrome in an isolated context; separate from user-browser CUA inspection',checks,errors},null,2));
  console.log(`Browser QA: ${checks.length} checks passed.`);
}finally{await context.close();await browser.close();}
