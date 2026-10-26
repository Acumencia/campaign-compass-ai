import {blankSettings,readSettings,writeSettings} from './local-settings.mjs';
import {validatePineconeConfig} from './pinecone.mjs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createAPIProviders} from './api-providers.mjs';
import {createAnthropicKeyService} from './anthropic-api-key.mjs';
const exec=promisify(execFile);
export class KeyStoreError extends Error {constructor(code,status=400){super({invalid_settings:'Local nonsecret settings are invalid or could not be saved. No existing file was overwritten; review key.json.settings.json locally.',invalid_model:'Choose a valid model identifier for the selected provider. A model is required when the adapter is enabled.',invalid_key:'Enter a valid key without spaces (20-512 characters).',invalid_store:'Local key.json is invalid or unsafe. Repair it locally; it was not overwritten.',replace_required:'Confirm replacement of the existing saved key.',store_busy:'Credential storage is busy. Retry after the current save completes.',save_failed:'The key could not be saved. No credential details are included.'}[code]||'Credential settings are unavailable.');this.code=code;this.status=status;}}
const valid=value=>typeof value==='string'&&value.length>=20&&value.length<=512&&!/\s|[^\x21-\x7e]/.test(value);
const blank=()=>({version:1,openai:'',anthropic:''});
// Startup-only, read-only campaign scope. No provider registry or mutation methods escape.
export async function createReadOnlyAnthropicStore({filename,environment={}}){
 try{
  const state=await read(path.resolve(filename));
  const settings=readSettings(path.resolve(filename)+'.settings.json');
  const g=settings.generation.anthropic;
  const scoped={};
  for(const suffix of ['ENABLED','API_KEY','GENERATION_MODEL','MAX_OUTPUT_TOKENS'])scoped['CAMPAIGN_ANTHROPIC_'+suffix]=environment['CAMPAIGN_ANTHROPIC_'+suffix];
  if(state.anthropic)scoped.CAMPAIGN_ANTHROPIC_API_KEY=state.anthropic;
  if(g){scoped.CAMPAIGN_ANTHROPIC_ENABLED=g.enabled?'1':'0';scoped.CAMPAIGN_ANTHROPIC_GENERATION_MODEL=g.model;scoped.CAMPAIGN_ANTHROPIC_MAX_OUTPUT_TOKENS=String(g.maxOutputTokens);}
  const service=createAnthropicKeyService({environment:scoped,fetcher:async()=>{throw Error('Campaign budget transport required');}});
  return Object.freeze({status:()=>({...service.status(),provider:'anthropic',credentialAccess:'startup-read-only',embeddingsConfigured:false}),generation:service.generation?Object.freeze({withTransport:service.generation.withTransport}):null});
 }catch{return Object.freeze({status:()=>({provider:'anthropic',generationConfigured:false,keyPresent:false,blocked:'The read-only campaign configuration is unavailable. Review the local source and restart.'}),generation:null});}
}
async function protect(filename){
 if(process.platform==='win32'){
  const {stdout}=await exec('whoami.exe',['/user','/fo','csv','/nh'],{windowsHide:true});const sid=stdout.match(/S-1-5-[0-9-]+/)?.[0];if(!sid)throw Error();
  await exec('icacls.exe',[filename,'/inheritance:r','/grant:r',`*${sid}:(F)`],{windowsHide:true});
 }else await fs.chmod(filename,0o600);
}
async function regular(filename){const stat=await fs.lstat(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>8192)throw new KeyStoreError('invalid_store',409);return stat;}
async function read(filename){try{await regular(filename);const handle=await fs.open(filename,'r');try{const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>8192)throw Error();const value=JSON.parse(await handle.readFile('utf8'));if(!value||!['anthropic,openai,version','anthropic,openai,pinecone,version'].includes(Object.keys(value).sort().join(','))||value.version!==1||!['openai','anthropic',...(Object.hasOwn(value,'pinecone')?['pinecone']:[])].every(p=>value[p]===''||valid(value[p])))throw Error();return value;}finally{await handle.close();}}catch(e){if(e.code==='ENOENT')return blank();throw new KeyStoreError('invalid_store',409);}}
// Only caller-selected local paths; never accept paths or endpoints from HTTP input.
export async function createKeyStore({filename,environment={},fetcher=globalThis.fetch,commit=fs.rename,settingsFilename,transientGeneration=null,timeoutMs=30000}={}){
 filename=path.resolve(filename);let state,invalid=false,revision=0,providers;let storageConfig={backend:'local'},settings=blankSettings(),settingsInvalid=false,storageCache=null,storageIdentity='';const overrides={};settingsFilename ||= filename+'.settings.json';
 try{state=await read(filename);}catch{state=blank();invalid=true;}
 if(transientGeneration&&(!['anthropic'].includes(transientGeneration.provider)||!Number.isInteger(transientGeneration.maxOutputTokens)||transientGeneration.maxOutputTokens<128||transientGeneration.maxOutputTokens>8192))throw new KeyStoreError('invalid_model');
 function rebuild(){const effective=Object.create(environment);for(const [name,value]of Object.entries(overrides))Object.defineProperty(effective,name,{value,configurable:true});if(transientGeneration)Object.defineProperty(effective,'CAMPAIGN_ANTHROPIC_MAX_OUTPUT_TOKENS',{value:String(transientGeneration.maxOutputTokens),configurable:true});if(invalid){Object.defineProperty(effective,'CAMPAIGN_OPENAI_ENABLED',{value:'0'});Object.defineProperty(effective,'CAMPAIGN_ANTHROPIC_ENABLED',{value:'0'});}for(const [p,key]of [['openai','CAMPAIGN_OPENAI_API_KEY'],['anthropic','CAMPAIGN_ANTHROPIC_API_KEY']])if(state[p])Object.defineProperty(effective,key,{value:state[p],enumerable:true});const identity=JSON.stringify([storageConfig,invalid?'':state.pinecone||'',storageConfig.mode==='external'?[effective.CAMPAIGN_OPENAI_EMBEDDING_MODEL,effective.CAMPAIGN_OPENAI_EMBEDDING_DIMENSIONS]:null]);if(identity!==storageIdentity)storageCache=null;
 providers=createAPIProviders({environment:effective,fetcher,timeoutMs,storageConfig:invalid?{backend:'local'}:storageConfig,pineconeKey:invalid?'':state.pinecone||'',storageOverride:storageCache});storageCache=providers.storage;storageIdentity=identity;}
 function applySettings(){storageConfig=settings.storage;for(const k of Object.keys(overrides))delete overrides[k];if(settings.selectedProvider!==null)overrides.CAMPAIGN_GENERATION_PROVIDER=settings.selectedProvider;for(const [provider,g]of Object.entries(settings.generation)){const prefix=provider==='openai'?'CAMPAIGN_OPENAI_':'CAMPAIGN_ANTHROPIC_';overrides[prefix+'ENABLED']=g.enabled?'1':'0';overrides[prefix+'GENERATION_MODEL']=g.model;overrides[prefix+'MAX_OUTPUT_TOKENS']=String(g.maxOutputTokens);}if(settings.embedding){overrides.CAMPAIGN_EMBEDDING_PROVIDER='openai';overrides.CAMPAIGN_OPENAI_ENABLED='1';overrides.CAMPAIGN_OPENAI_EMBEDDING_MODEL=settings.embedding.model;overrides.CAMPAIGN_OPENAI_EMBEDDING_DIMENSIONS=String(settings.embedding.dimensions);}}
 try{settings=readSettings(settingsFilename);if(Object.values(state).some(key=>typeof key==='string'&&key&&JSON.stringify(settings).includes(key)))throw Error();applySettings();}catch{settingsInvalid=true;settings=blankSettings();}
 function persist(next){if(settingsInvalid)throw new KeyStoreError('invalid_settings',409);try{writeSettings(settingsFilename,next);}catch{throw new KeyStoreError('invalid_settings',409);}settings=next;}
 rebuild();
 function status(){return {available:!invalid,settingsStatus:settingsInvalid?'invalid':'available',openai:state.openai?'configured':'not_configured',anthropic:state.anthropic?'configured':'not_configured',pinecone:state.pinecone?'configured':'not_configured'};}
 async function save(provider,key,replace){
  if(!['openai','anthropic','pinecone'].includes(provider)||!valid(key)||typeof replace!=='boolean')throw new KeyStoreError('invalid_key');
  if(invalid)throw new KeyStoreError('invalid_store',409);
  const lock=filename+'.lock',temp=filename+'.'+randomUUID()+'.tmp';let guard,handle;
  try{
   try{guard=await fs.open(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new KeyStoreError('store_busy',409);throw e;}
   const current=await read(filename);if(current[provider]&&!replace)throw new KeyStoreError('replace_required',409);
   const next={...current,[provider]:key};handle=await fs.open(temp,'wx',0o600);await protect(temp);await handle.writeFile(JSON.stringify(next)+'\n');await handle.sync();await handle.close();handle=null;
   // Refuse unsafe destinations again immediately before atomic replacement.
   try{await regular(filename);}catch(e){if(e.code!=='ENOENT')throw e;}
   await commit(temp,filename);state=next;revision++;rebuild();
  }catch(e){if(e instanceof KeyStoreError)throw e;throw new KeyStoreError('save_failed',500);}
  finally{await handle?.close().catch(()=>{});await fs.unlink(temp).catch(()=>{});if(guard){await guard.close().catch(()=>{});await fs.unlink(lock).catch(()=>{});}}
 }
 function configure(provider,enabled,model,maxOutputTokens=2048){
  if(invalid)throw new KeyStoreError('invalid_store',409);
  if(!Number.isInteger(maxOutputTokens)||maxOutputTokens<128||maxOutputTokens>8192||!['openai','anthropic'].includes(provider)||typeof enabled!=='boolean'||typeof model!=='string'||(!model&&enabled)||(model&&!new RegExp(provider==='openai'?'^gpt-[a-zA-Z0-9._-]{1,100}$':'^claude-[a-zA-Z0-9._-]{1,100}$').test(model))||Object.values(state).some(value=>typeof value==='string'&&value&&model.includes(value)))throw new KeyStoreError('invalid_model');
  persist({...settings,generation:{...settings.generation,[provider]:{enabled,model,maxOutputTokens}}});const prefix=provider==='openai'?'CAMPAIGN_OPENAI_':'CAMPAIGN_ANTHROPIC_';overrides[prefix+'ENABLED']=enabled?'1':'0';overrides[prefix+'GENERATION_MODEL']=model;overrides[prefix+'MAX_OUTPUT_TOKENS']=String(maxOutputTokens);revision++;rebuild();
 }
 function configureEmbedding(model,dimensions){
  if(invalid)throw new KeyStoreError('invalid_store',409);
  if(!['text-embedding-3-small','text-embedding-3-large'].includes(model)||!Number.isInteger(dimensions)||dimensions<1||dimensions>(model==='text-embedding-3-small'?1536:3072))throw new KeyStoreError('invalid_model');
  persist({...settings,embedding:{model,dimensions}});overrides.CAMPAIGN_EMBEDDING_PROVIDER='openai';overrides.CAMPAIGN_OPENAI_ENABLED='1';overrides.CAMPAIGN_OPENAI_EMBEDDING_MODEL=model;overrides.CAMPAIGN_OPENAI_EMBEDDING_DIMENSIONS=String(dimensions);revision++;rebuild();
 }
 function configureStorage(value){if(invalid)throw new KeyStoreError('invalid_store',409);if(Object.values(state).some(key=>typeof key==='string'&&key&&JSON.stringify(value).includes(key)))throw new KeyStoreError('invalid_model');const next=validatePineconeConfig(value);persist({...settings,storage:next});storageConfig=next;revision++;rebuild();}
 function select(provider){if(!['','openai','anthropic'].includes(provider))throw new KeyStoreError('invalid_model');persist({...settings,selectedProvider:provider});overrides.CAMPAIGN_GENERATION_PROVIDER=provider;revision++;rebuild();}
 return {status,save,configure,configureEmbedding,configureStorage,select,get providers(){return providers;},get revision(){return revision;}};
}
