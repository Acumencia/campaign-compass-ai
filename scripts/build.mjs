import {mkdir,copyFile} from 'node:fs/promises';
const files=['index.html','styles.css','src/app.mjs','src/metrics.mjs','src/assistant.mjs','src/glossary.mjs','src/chatgpt-client.mjs','src/connection-ui.mjs','data/campaigns.csv'];
for(const file of files){const output=new URL(`../dist/${file}`,import.meta.url);await mkdir(new URL('.',output),{recursive:true});await copyFile(new URL(`../${file}`,import.meta.url),output);}
console.log(`Static build complete: ${files.length} allowlisted assets; no secrets or development evidence bundled.`);
