import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('normal start uses optional server-side env file loading', async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(pkg.scripts.start,'node --env-file-if-exists=.env server.mjs');
});
test('isolated env fixtures preserve process precedence and fail closed without keys; no requests',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'campaign-env-test-'));
 const moduleUrl=new URL('../server/openai-api-key.mjs',import.meta.url).href;
 const source=`import {createOpenAIKeyService} from ${JSON.stringify(moduleUrl)}; const service=createOpenAIKeyService({fetcher:()=>{throw Error('unexpected network call');}}); console.log(JSON.stringify(service.status()));`;
 const base={SystemRoot:process.env.SystemRoot??'',TEMP:tmpdir()};
 const run=(extra={})=>{
  const result=spawnSync(process.execPath,['--env-file-if-exists=.env','--input-type=module','-e',source],{cwd:dir,env:{...base,...extra},encoding:'utf8'});
  assert.equal(result.status,0,'fixture process must exit successfully');
  assert.equal(result.stdout.includes('fixture-not-a-real-credential'),false);
  return JSON.parse(result.stdout);
 };
 const settings='CAMPAIGN_OPENAI_ENABLED=1\nCAMPAIGN_OPENAI_GENERATION_MODEL=gpt-6-astra\n';
 try {
  assert.equal(run().generationConfigured,false);
  await writeFile(path.join(dir,'.env'),settings+'CAMPAIGN_OPENAI_API_KEY=\n');
  assert.equal(run().generationConfigured,false);
  await writeFile(path.join(dir,'.env'),settings+'CAMPAIGN_OPENAI_API_KEY=fixture-not-a-real-credential\n');
  assert.equal(run().generationConfigured,true);
  assert.equal(run({CAMPAIGN_OPENAI_ENABLED:'0'}).keyStatus,'not_read_disabled');
  assert.equal(run({CAMPAIGN_OPENAI_API_KEY:''}).generationConfigured,false);
 } finally {await rm(dir,{recursive:true,force:true});}
});
