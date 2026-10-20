import {createHash} from 'node:crypto';
import {readFile, readdir, lstat, mkdir, writeFile, rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
export const CONFIG = Object.freeze({version: 2, maxWords: 180, overlapWords: 30, retrieval: 'lexical-tfidf-cosine-v1'});
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const sourcePattern = /^[a-z0-9][a-z0-9-]{0,60}\.(md|txt)$/;
export class KnowledgeError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, {status, code}); }
}
const invalid = message => new KnowledgeError(400, 'invalid_request', message);
export function exactFields(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value,k))) throw invalid('Unsupported request fields.');
}
export function buildCorpus(inputs) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 50) throw invalid('Provide 1 to 50 source documents.');
  const names = new Set();
  const documents = [], chunks = [];
  for (const input of [...inputs].sort((a,b) => a.name.localeCompare(b.name,'en'))) {
    const {name, text} = input;
    if (!sourcePattern.test(name) || names.has(name) || typeof text !== 'string' || Buffer.byteLength(text) > 100000 || text.includes('\0')) throw invalid('Invalid source document.');
    names.add(name);
    const lines = text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n').map(l=>l.replace(/\t/g,' ').replace(/ +/g,' ').trimEnd());
    const sourceId = name.replace(/\.(md|txt)$/,'');
    if (documents.some(d=>d.sourceId===sourceId)) throw invalid('Duplicate source identifier.');
    const title = lines.find(l=>/^# /.test(l))?.slice(2).trim() || sourceId;
    if(title.length>200 || lines.some(l=>/^#{1,6}\s/.test(l)&&l.length>207))throw invalid('Source titles and headings must be at most 200 characters.');
    let metadata={provenance:'synthetic',owner:'Campaign Compass teaching corpus',version:'unspecified',effective:'unspecified',status:'active',supersededBy:'none',scope:sourceId};
    const header=lines.find(l=>l.startsWith('<!-- metadata: '));
    if(header){try{metadata=JSON.parse(header.slice(15,-4));exactFields(metadata,['provenance','owner','version','effective','status','supersededBy','scope']);if(Object.values(metadata).some(v=>typeof v!=='string'||v.length>160)||metadata.provenance!=='synthetic'||!['active','superseded','expired'].includes(metadata.status))throw Error();}catch{throw invalid('Invalid synthetic source metadata.');}}
    const document = {sourceId,metadata, filename: name, title, contentHash: digest(text), text: lines.join('\n'), license: 'Original synthetic demo content; MIT', synthetic: true};
    documents.push(document);
    let heading = title, words = [], sectionLine = 1;
    const occurrences = new Map();
    function flush() {
      for (let start=0; start<words.length; start+=CONFIG.maxWords-CONFIG.overlapWords) {
        const part=words.slice(start,start+CONFIG.maxWords), content=part.map(w=>w.word).join(' ');
        const contentHash=digest(content), signature=digest({sourceId,heading,content});
        const occurrence=(occurrences.get(signature)||0)+1; occurrences.set(signature,occurrence);
        chunks.push({chunkId:`${sourceId}:${signature.slice(0,24)}:${occurrence}`, sourceId, metadata, heading, sectionLine,
          startLine:part[0].line, endLine:part.at(-1).line, text:content, contentHash, wordCount:part.length});
        if(start+CONFIG.maxWords>=words.length) break;
      }
      words=[];
    }
    lines.forEach((line,i)=>{
      if(line.startsWith('<!-- metadata: '))return;
      const match=line.match(/^#{1,6}\s+(.+)$/);
      if(match){flush();heading=match[1].trim();sectionLine=i+1;}
      else for(const word of line.trim().split(/\s+/).filter(Boolean)) words.push({word,line:i+1});
    });
    flush();
  }
  if (!chunks.length || chunks.length > 5000) throw invalid('Corpus must contain 1 to 5000 chunks.');
  return {schemaVersion:1, corpusVersion:`sha256:${digest({config:CONFIG,documents:documents.map(({sourceId,contentHash})=>({sourceId,contentHash}))})}`,
    config:CONFIG, documents, chunks, providers:{embeddings:'not_configured', generation:'not_configured'}};
}
export async function readCorpus(directory) {
  const entries=await readdir(directory,{withFileTypes:true});
  const candidates=entries.filter(e=>/\.(md|txt)$/i.test(e.name));
  if(candidates.length>50) throw invalid('Too many source documents.');
  const inputs=[];
  for(const entry of candidates){
    if(!sourcePattern.test(entry.name)||!entry.isFile()||entry.isSymbolicLink()) throw invalid('Only regular Markdown/text source files are allowed.');
    const filename=path.join(directory,entry.name), stat=await lstat(filename);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>100000) throw invalid('Invalid source file.');
    inputs.push({name:entry.name,text:await readFile(filename,'utf8')});
  }
  return buildCorpus(inputs);
}
export async function ingest(directory, indexPath) {
  const corpus=await readCorpus(directory);
  let previous; try{previous=JSON.parse(await readFile(indexPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const old=new Map((previous?.documents||[]).map(d=>[d.sourceId,d.contentHash]));
  const changes={added:[],changed:[],deleted:[]};
  for(const d of corpus.documents){if(!old.has(d.sourceId))changes.added.push(d.sourceId);else if(old.get(d.sourceId)!==d.contentHash)changes.changed.push(d.sourceId);old.delete(d.sourceId);}
  changes.deleted=[...old.keys()].sort();
  // Full atomic replacement removes deleted chunks; stable content IDs survive rebuilds.
  const result={...corpus,ingestedAt:previous?.corpusVersion===corpus.corpusVersion?previous.ingestedAt:new Date().toISOString()};
  await mkdir(path.dirname(indexPath),{recursive:true});
  const temp=`${indexPath}.${process.pid}.tmp`;
  await writeFile(temp,JSON.stringify(result,null,2)+'\n',{flag:'wx'}); await rename(temp,indexPath);
  return {corpus:result,changes};
}
export async function loadKnowledge({directory=fileURLToPath(new URL('../data/knowledge/corpus/',import.meta.url)), indexPath=new URL('../data/knowledge/index.json',import.meta.url)}={}) {
  let saved;try{saved=JSON.parse(await readFile(indexPath,'utf8'));}
  catch{throw new KnowledgeError(503,'ingestion_required','Run npm run knowledge:ingest before using Knowledge.');}
  const current=await readCorpus(directory);
  if(saved.corpusVersion!==current.corpusVersion || digest(saved.chunks)!==digest(current.chunks) || digest(saved.documents)!==digest(current.documents))
    throw new KnowledgeError(409,'corpus_changed','Sources changed. Run npm run knowledge:ingest and refresh Knowledge.');
  return {...current,ingestedAt:saved.ingestedAt};
}
const stop=new Set('a an the is are be to of and or for in on with what which how does do can i we it our me about from this that as has have you your any some there available products product items item options looking sell'.split(' '));
const tokens=text=>(text.toLowerCase().match(/[a-z0-9]+/g)||[]).filter(t=>!stop.has(t));
export function retrieve(corpus, question, limit=5, {sourceIds=[]}={}) {
  if(typeof question!=='string'||!question.trim()||question.length>500||!Number.isInteger(limit)||limit<1||limit>10) throw invalid('Provide a question of 1 to 500 characters and a limit of 1 to 10.');
  const eligible=corpus.chunks.filter(c=>sourceIds.length?sourceIds.includes(c.sourceId):!c.metadata||c.metadata.status==='active');
  const bags=eligible.map(c=>tokens(`${c.heading} ${c.text}`));
  const query=tokens(question), terms=[...new Set(query)], n=bags.length;
  const df=new Map(); for(const bag of bags)for(const term of new Set(bag))df.set(term,(df.get(term)||0)+1);
  const idf=t=>Math.log((n+1)/((df.get(t)||0)+1))+1;
  const vector=bag=>{const m=new Map();for(const t of bag)m.set(t,(m.get(t)||0)+1);for(const [t,f] of m)m.set(t,(1+Math.log(f))*idf(t));return m;};
  const norm=v=>Math.sqrt([...v.values()].reduce((s,x)=>s+x*x,0));
  const q=vector(query), qnorm=norm(q);
  return bags.map((bag,i)=>{const v=vector(bag), denom=norm(v)*qnorm;return {...eligible[i],score:denom?terms.reduce((s,t)=>s+(q.get(t)||0)*(v.get(t)||0),0)/denom:0};})
    .filter(c=>c.score>0).sort((a,b)=>b.score-a.score||a.chunkId.localeCompare(b.chunkId)).slice(0,limit);
}
export function manifest(corpus){return {schemaVersion:1,corpusVersion:corpus.corpusVersion,ingestedAt:corpus.ingestedAt,config:corpus.config,
  providers:corpus.providers,chunkCount:corpus.chunks.length,documents:corpus.documents.map(({text,...d})=>({...d,chunkCount:corpus.chunks.filter(c=>c.sourceId===d.sourceId).length}))};}
export function source(corpus,sourceId){
  if(typeof sourceId!=='string'||!(/^[a-z0-9][a-z0-9-]{0,60}$/).test(sourceId))throw invalid('Invalid source ID.');
  const document=corpus.documents.find(d=>d.sourceId===sourceId);
  if(!document)throw new KnowledgeError(404,'source_not_found','Source not found.');
  return {corpusVersion:corpus.corpusVersion,document,chunks:corpus.chunks.filter(c=>c.sourceId===sourceId)};
}
// Offline lexical mode stays independent of the RAG service in rag.mjs.
export function askKnowledge(corpus,{question,corpusVersion,topK=5,sourceIds=[]}){
  if(corpusVersion!==corpus.corpusVersion)throw new KnowledgeError(409,'stale_corpus','Refresh Knowledge before asking.');
  const start=performance.now(), matches=retrieve(corpus,question,topK,{sourceIds});
  return {schemaVersion:1,corpusVersion,mode:'lexical',status:'generation_not_configured',answer:null,
    providers:corpus.providers,retrieval:{method:CONFIG.retrieval,matches,elapsedMs:performance.now()-start},
    notice:'Lexical source matches only. No embedding or generation call was made. Matches are not verified answers.'};
}
// Legacy foundation contract retained for compatibility. The RAG route uses
// validateGroundedAnswer in rag.mjs, with quoted citations and explicit non-answer states.
export function validateCitedAnswer(value, retrieval){
  exactFields(value,['corpusVersion','status','claims']);
  if(value.corpusVersion!==retrieval.corpusVersion||!['answered','clarification','insufficient_evidence'].includes(value.status)||!Array.isArray(value.claims)||value.claims.length>12)throw invalid('Invalid answer contract.');
  if(value.status!=='answered'){if(value.claims.length)throw invalid('Non-answer must not contain claims.');return value;}
  if(!value.claims.length)throw invalid('An answer needs cited claims.');
  const ids=new Set(retrieval.retrieval.matches.map(c=>c.chunkId));
  for(const claim of value.claims){exactFields(claim,['text','citations']);if(typeof claim.text!=='string'||!claim.text.trim()||claim.text.length>2000||!Array.isArray(claim.citations)||claim.citations.length<1||claim.citations.length>5||new Set(claim.citations).size!==claim.citations.length||claim.citations.some(id=>!ids.has(id)))throw invalid('Every claim needs valid retrieved citations.');}
  return value;
}
