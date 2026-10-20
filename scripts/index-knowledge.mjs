import {createRagService} from '../server/rag.mjs';
import {ragOptions} from '../server/rag-config.mjs';
import {createKeyStore} from '../server/key-store.mjs';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2);
const apiKey=(await createKeyStore({filename:fileURLToPath(new URL('../key.json',import.meta.url)),environment:process.env})).providers;
try{
 if(args.some(a=>a!=='--allow-api-calls'))throw new Error('Unsupported indexing option.');
 if(apiKey.status().enabled&&!args.includes('--allow-api-calls')){console.error('API indexing can incur charges. Run again with --allow-api-calls only after explicitly approving this work.');process.exitCode=1;}
 else console.log(JSON.stringify(await createRagService(ragOptions(apiKey)).buildIndex(),null,2));
}catch(error){console.error(JSON.stringify({code:error.code||'index_failed',message:error.code?error.message:'Local vector indexing failed.'}));process.exitCode=1;}
