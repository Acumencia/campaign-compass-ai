import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {loadKnowledge,retrieve} from '../server/knowledge.mjs';
const corpus=await loadKnowledge(), fixtures=JSON.parse(await readFile(new URL('../eval/knowledge-questions.json',import.meta.url),'utf8'));
const records=fixtures.map(item=>{
  const start=performance.now(), matches=retrieve(corpus,item.question,5), elapsed=performance.now()-start;
  const found=item.expectedEvidence.filter(e=>matches.some(c=>c.sourceId===e.sourceId&&c.heading===e.heading));
  const graded=['direct','cross_document','version_conflict'].includes(item.category);
  return {...item,cohort:Number(item.id.slice(1))<=15?'original15':'expanded15',retrieval:{method:corpus.config.retrieval,topK:5,elapsedMs:elapsed,matches:matches.map(({chunkId,sourceId,heading,score,startLine,endLine})=>({chunkId,sourceId,heading,score,startLine,endLine})),expectedEvidenceRecall:graded?found.length/item.expectedEvidence.length:null,missingEvidence:item.expectedEvidence.filter(e=>!found.includes(e))},answerCorrectness:null,citationSupport:null,abstentionCorrectness:null,endToEndLatencyMs:null,
    analysis:graded?(found.length===item.expectedEvidence.length?'Expected evidence present; answer quality remains untested.':'Lexical top-5 missed expected evidence. Inspect vocabulary, chunk boundaries and document ranking before considering embeddings.'):'Retrieval is diagnostic only; clarification or abstention behavior requires generation evaluation.'};
});
const normalized=text=>text.replace(/\s+/g,' ').trim();
const provenanceFailures=corpus.chunks.filter(c=>{const d=corpus.documents.find(d=>d.sourceId===c.sourceId);return !d||createHash('sha256').update(c.text).digest('hex')!==c.contentHash||!normalized(d.text.split('\n').slice(c.startLine-1,c.endLine).join(' ')).includes(c.text);}).map(c=>c.chunkId);
const scored=records.filter(r=>r.retrieval.expectedEvidenceRecall!==null);
const times=records.map(r=>r.retrieval.elapsedMs).sort((a,b)=>a-b);
const report={schemaVersion:1,corpusVersion:corpus.corpusVersion,generatedAt:new Date().toISOString(),scope:'Local lexical retrieval and provenance only; no embedding or generation call.',summary:{questions:records.length,cohorts:Object.fromEntries(['original15','expanded15'].map(c=>{const rows=records.filter(r=>r.cohort===c),graded=rows.filter(r=>r.retrieval.expectedEvidenceRecall!==null);return [c,{questions:rows.length,graded:graded.length,meanRecall:graded.reduce((n,r)=>n+r.retrieval.expectedEvidenceRecall,0)/graded.length}];})),answerableQuestions:scored.length,allExpectedEvidenceAt5:scored.filter(r=>r.retrieval.expectedEvidenceRecall===1).length,meanExpectedEvidenceRecallAt5:scored.reduce((s,r)=>s+r.retrieval.expectedEvidenceRecall,0)/scored.length,provenanceChecked:corpus.chunks.length,provenanceFailures,retrievalOnlyP95Ms:times[Math.ceil(times.length*.95)-1],modelEvaluation:'pending',endToEndLatencyMs:null},records};
await mkdir(new URL('../eval/',import.meta.url),{recursive:true});await writeFile(new URL('../eval/knowledge-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.summary,null,2));if(provenanceFailures.length)process.exitCode=1;
