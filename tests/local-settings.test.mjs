import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,link} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {blankSettings,readSettings,writeSettings,validateSettings} from '../server/local-settings.mjs';
import {createKeyStore} from '../server/key-store.mjs';
test('nonsecret settings reject unexpected fields, malformed state, links and conflicting writers',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cc-settings-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'key.json.settings.json');
 assert.deepEqual(readSettings(file),blankSettings());for(const change of [{consent:true},{apiKey:'synthetic-only'},{selectedProvider:'other'},{generation:{anthropic:{enabled:true,model:'gpt-wrong',maxOutputTokens:512}}},{storage:{backend:'local',host:'unexpected'}},{embedding:{model:'unknown',dimensions:1}}])assert.throws(()=>validateSettings({...blankSettings(),...change}));
 writeSettings(file,blankSettings());await writeFile(file+'.lock','');assert.throws(()=>writeSettings(file,{...blankSettings(),selectedProvider:'anthropic'}));assert.deepEqual(readSettings(file),blankSettings());await rm(file+'.lock');await link(file,file+'.alias');assert.throws(()=>readSettings(file));assert.throws(()=>writeSettings(file,blankSettings()));await rm(file+'.alias');await writeFile(file,'{bad');const store=await createKeyStore({filename:path.join(dir,'key.json'),environment:{}});assert.equal(store.status().settingsStatus,'invalid');assert.throws(()=>store.configure('anthropic',true,'claude-test'),{code:'invalid_settings'});assert.equal(await readFile(file,'utf8'),'{bad');
});

test('explicit no-provider selection survives restart without falling back to environment provider',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cc-settings-selection-'));t.after(()=>rm(dir,{recursive:true,force:true}));const options={filename:path.join(dir,'key.json'),environment:{CAMPAIGN_GENERATION_PROVIDER:'anthropic'}};let store=await createKeyStore(options);assert.equal(store.providers.status().provider,'anthropic');store.select('');store=await createKeyStore(options);assert.equal(store.providers.status().provider,'');
});
