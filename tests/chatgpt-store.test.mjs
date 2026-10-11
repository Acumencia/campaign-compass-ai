import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ChatGPTStore, windowsPowerShellEnvironment} from '../server/chatgpt-store.mjs';

test('Windows helper removes duplicate module-path casing inherited through Python or PowerShell', () => {
  const env = windowsPowerShellEnvironment({SYSTEMROOT:'C:\\Windows', PSMODULEPATH:'wrong-from-python',
    PSModulePath:'wrong-from-powershell', PATH:'preserved'});
  assert.deepEqual(Object.keys(env).filter(key=>key.toLowerCase()==='psmodulepath'),['PSModulePath']);
  assert.equal(env.PSModulePath,path.join('C:\\Windows','System32/WindowsPowerShell/v1.0/Modules'));
  assert.equal(env.PATH,'preserved');
});

test('Windows store encrypts synthetic fixtures, writes atomically and stays outside the project', {skip:process.platform!=='win32',timeout:60000}, async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'cc-store-test-'));
  t.after(async()=>{
    const target=path.resolve(root),parent=path.resolve(os.tmpdir());
    if(!target.startsWith(parent+path.sep)||!path.basename(target).startsWith('cc-store-test-'))throw new Error('Unsafe test cleanup path');
    await rm(target,{recursive:true,force:true});
  });
  const store=new ChatGPTStore({directory:path.join(root,'only-synthetic-test-data')});
  assert.equal((await store.read()).hostId,null);
  await assert.rejects(stat(store.directory),error=>error.code==='ENOENT');
  await store.withLock(async(state,save)=>{
    state.profiles.push({id:'fixture',tokens:{access_token:'synthetic-fixture-value'}});await save();
  });
  const disk=await readFile(store.filename,'utf8');
  assert.doesNotMatch(disk,/synthetic-fixture-value|access_token/);
  assert.equal((await store.read()).profiles[0].tokens.access_token,'synthetic-fixture-value');
  await Promise.all([1,2].map(()=>store.withLock(async(state,save)=>{state.count=(state.count||0)+1;await save();})));
  assert.equal((await store.read()).count,2);
});
