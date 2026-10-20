// Nonsecret configuration only. Consent, credentials and verification are never persisted.
import {lstatSync,readFileSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {validatePineconeConfig} from './pinecone.mjs';
export const blankSettings=()=>({version:1,selectedProvider:null,generation:{},embedding:null,storage:{backend:'local'}});
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.sort().join();
export function validateSettings(s){
 if(!exact(s,['version','selectedProvider','generation','embedding','storage'])||s.version!==1||![null,'','openai','anthropic'].includes(s.selectedProvider)||!s.generation||typeof s.generation!=='object'||Array.isArray(s.generation)||Object.keys(s.generation).some(k=>!['openai','anthropic'].includes(k)))throw Error('Invalid local settings');
 for(const [provider,g]of Object.entries(s.generation))if(!exact(g,['enabled','model','maxOutputTokens'])||typeof g.enabled!=='boolean'||typeof g.model!=='string'||(!g.model&&g.enabled)||(g.model&&!new RegExp(provider==='openai'?'^gpt-[a-zA-Z0-9._-]{1,100}$':'^claude-[a-zA-Z0-9._-]{1,100}$').test(g.model))||!Number.isInteger(g.maxOutputTokens)||g.maxOutputTokens<128||g.maxOutputTokens>8192)throw Error('Invalid generation settings');
 if(s.embedding!==null){const e=s.embedding;if(!exact(e,['model','dimensions'])||!['text-embedding-3-small','text-embedding-3-large'].includes(e.model)||!Number.isInteger(e.dimensions)||e.dimensions<1||e.dimensions>(e.model==='text-embedding-3-small'?1536:3072))throw Error('Invalid embedding settings');}
 if(s.storage?.backend==='local'){if(!exact(s.storage,['backend']))throw Error('Invalid storage settings');}else validatePineconeConfig(s.storage);
 return s;
}
function regular(file){const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>16384)throw Error('Unsafe settings file');}
export function readSettings(file){try{regular(file);return validateSettings(JSON.parse(readFileSync(file,'utf8')));}catch(e){if(e.code==='ENOENT')return blankSettings();throw Error('Local settings are invalid or unsafe; no file was overwritten.');}}
export function writeSettings(file,value){validateSettings(value);const temp=file+'.'+randomUUID()+'.tmp',lock=file+'.lock';let guard,fd;
 try{guard=openSync(lock,'wx',0o600);try{regular(file);}catch(e){if(e.code!=='ENOENT')throw e;}fd=openSync(temp,'wx',0o600);writeFileSync(fd,JSON.stringify(value)+'\n');fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temp,file);}
 finally{if(fd!==undefined)closeSync(fd);try{unlinkSync(temp);}catch{}if(guard!==undefined){closeSync(guard);try{unlinkSync(lock);}catch{}}}
}
