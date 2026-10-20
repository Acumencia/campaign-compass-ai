// Re-run existing isolated QA without replacing their historical evidence.
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
await mkdir('evidence/pinecone-regression',{recursive:true});
for(const name of ['api-only-browser-qa','knowledge-browser-qa','rag-fixture-browser-qa','rag-live-setup-browser-qa']){
 const source=await readFile(new URL(`./${name}.mjs`,import.meta.url),'utf8'),file=new URL(`./${name}.pinecone-regression.mjs`,import.meta.url);
 try{await writeFile(file,source.replaceAll('evidence/','evidence/pinecone-regression/'),{flag:'wx'});await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[file.pathname.replace(/^\/([A-Za-z]:)/,'$1')],{stdio:'inherit',env:{...process.env,CAMPAIGN_OPENAI_ENABLED:'0',CAMPAIGN_ANTHROPIC_ENABLED:'0'},windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`${name} exited ${code}`)));});}
 finally{await unlink(file).catch(()=>{});}
}
