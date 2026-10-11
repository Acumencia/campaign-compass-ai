import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
const root=new URL('../',import.meta.url);
const excluded=new Set(['node_modules','.git','dist']);
const patterns=[[/-----BEGIN [A-Z ]*PRIVATE KEY-----/,'private key'],[/\bgh[pousr]_[A-Za-z0-9]{25,}\b/,'GitHub token'],[/\bsk-[A-Za-z0-9_-]{24,}\b/,'API key'],[/\bAKIA[A-Z0-9]{16}\b/,'access key'],[/(?:password|api[_-]?key|secret)\s*[:=]\s*["'][^"'\s]{12,}["']/i,'credential assignment']];
const findings=[];let checked=0;
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){if(excluded.has(entry.name))continue;const file=new URL(entry.name+(entry.isDirectory()?'/':''),dir);if(entry.isDirectory())await walk(file);else if(/\.(?:mjs|json|html|css|md|csv|txt|yml)$/.test(entry.name)){checked++;const content=await readFile(file,'utf8');for(const[pattern,label]of patterns)if(pattern.test(content))findings.push({file:path.relative(root.pathname,file.pathname),type:label});}else if(/^\.env(?:\.|$)/.test(entry.name))findings.push({file:entry.name,type:'environment file'});}}
await walk(root);
console.log(JSON.stringify({checked,findings,scope:'project text files; dependencies and binary artifacts excluded',limitation:'Heuristic pattern scan, not a proof of absence'},null,2));
if(findings.length)process.exitCode=1;
