import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('.',import.meta.url));
const allowed=new Set(['index.html','styles.css','src/app.mjs','src/metrics.mjs','src/assistant.mjs','src/glossary.mjs','data/campaigns.csv']);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.csv':'text/csv; charset=utf-8'};
export function createServer(){return http.createServer(async(req,res)=>{
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end('Method not allowed');return;}
  let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html';}catch{res.writeHead(400);res.end('Bad request');return;}
  if(!allowed.has(name)){res.writeHead(404);res.end('Not found');return;}
  try{const bytes=await readFile(path.join(root,name));res.writeHead(200,{'Content-Type':types[path.extname(name)]});res.end(req.method==='HEAD'?undefined:bytes);}catch{res.writeHead(500);res.end('Application asset unavailable. Run npm run generate.');}
});}
if(process.argv[1]===fileURLToPath(import.meta.url)){createServer().listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log('Campaign Compass: http://127.0.0.1:4173 (loopback only)'));}
