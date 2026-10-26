import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {createReadOnlyAnthropicStore} from './key-store.mjs';
async function localText(filename,limit){const st=await lstat(filename);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>limit)throw Error('Unsafe local configuration');return readFile(filename,'utf8');}
// Local ignored pointer, never accepted from HTTP or exposed in responses.
export async function loadCampaignStartup(root){
 const pointer=path.join(root,'key.json.campaign-source.json');let text;
 try{text=await localText(pointer,4096);}catch(e){if(e.code==='ENOENT')return null;return unavailable();}
 try{
  const config=JSON.parse(text);
  if(!config||Object.keys(config).sort().join()!=='environmentFile,keyFile,version'||config.version!==1||![config.keyFile,config.environmentFile].every(v=>typeof v==='string'&&path.isAbsolute(v)))throw Error();
  const parsed=parseEnv(await localText(config.environmentFile,65536));
  const environment={};for(const suffix of ['ENABLED','API_KEY','GENERATION_MODEL','MAX_OUTPUT_TOKENS'])environment['CAMPAIGN_ANTHROPIC_'+suffix]=parsed['CAMPAIGN_ANTHROPIC_'+suffix];
  return createReadOnlyAnthropicStore({filename:config.keyFile,environment});
 }catch{return unavailable();}
}
function unavailable(){return {status:()=>({provider:'anthropic',generationConfigured:false,keyPresent:false,blocked:'The read-only campaign startup configuration is unavailable. Review it locally and restart.'}),generation:null};}
