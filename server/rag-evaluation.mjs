import {performance} from 'node:perf_hooks';
import {retrieve} from './knowledge.mjs';
function retrievalMetrics(item,matches){
  const graded=['direct','cross_document','version_conflict'].includes(item.category);
  const present=e=>matches.some(m=>m.sourceId===e.sourceId&&m.heading===e.heading);
  return {expectedEvidenceRecall:graded?item.expectedEvidence.filter(present).length/item.expectedEvidence.length:null,missingEvidence:item.expectedEvidence.filter(e=>!present(e)),matches:matches.map(({chunkId,sourceId,heading,score})=>({chunkId,sourceId,heading,score}))};
}
export async function evaluateComparisons(corpus,fixtures,{service,allowProviderCalls=false,signal}={}){
  const records=[];
  for(const item of fixtures){
    if(signal?.aborted)throw new Error('Evaluation cancelled.');
    const start=performance.now(),lexical=retrieve(corpus,item.question,5);
    const record={id:item.id,cohort:Number(item.id.slice(1))<=15?'original15':'expanded15',category:item.category,question:item.question,expectedBehavior:item.expectedBehavior,lexical:{method:'lexical-tfidf-cosine-v1',elapsedMs:performance.now()-start,...retrievalMetrics(item,lexical)},vector:{status:'not_run',reason:'Provider calls not enabled.',expectedEvidenceRecall:null,matches:null},answer:{status:'not_run',claims:null,citationStructureValid:null,expectedStateMatch:null,answerCorrectness:null,citationEntailment:null,clarificationQuality:null,reviewNotes:null},endToEndLatencyMs:null};
    if(allowProviderCalls){
      if(!service)throw new Error('Explicit RAG service required.');
      try{
        const result=await service.ask(corpus,{question:item.question,corpusVersion:corpus.corpusVersion,topK:5,sourceIds:[]},{signal});
        record.vector=result.retrieval?{status:'measured',method:result.retrieval.vectorMethod||result.retrieval.method,...retrievalMetrics(item,result.retrieval.vectorMatches||result.retrieval.matches)}:{status:result.status,reason:result.notice,expectedEvidenceRecall:null,matches:null};
        if(result.retrieval&&result.diagnostics)record.suppliedContext={method:'bounded vector plus lexical coverage',...retrievalMetrics(item,result.retrieval.matches.filter(c=>result.diagnostics.contextChunkIds.includes(c.chunkId)))};
        record.runId=result.runId;record.startedAt=result.startedAt;record.providers=result.providers;
        record.answer.status=result.status;record.answer.claims=result.answer?.claims??null;
        record.answer.message=result.answer?.message??null;
        record.answer.citationStructureValid=result.answer?.status==='answered'?true:null;
        if(['answered','clarification','insufficient_evidence'].includes(result.status))record.answer.expectedStateMatch=result.status===(item.category==='ambiguous'?'clarification':item.category==='unanswerable'?'insufficient_evidence':'answered');
        record.endToEndLatencyMs=result.diagnostics?.totalMs??null;record.diagnostics=result.diagnostics;
        if(result.retrieval&&result.diagnostics)record.vector.contextEvidenceRecall=retrievalMetrics(item,(result.retrieval.vectorMatches||result.retrieval.matches).filter(c=>result.diagnostics.contextChunkIds.includes(c.chunkId))).expectedEvidenceRecall;
      }catch(error){
        if(signal?.aborted)throw error;
        record.vector={status:'error',code:error.code||'evaluation_failed',expectedEvidenceRecall:null,matches:null};record.answer.status='error';
        const evidence=error.evaluationEvidence;
        if(error.code==='invalid_answer'&&evidence){
          record.suppliedContext={method:'bounded vector plus lexical coverage',...retrievalMetrics(item,evidence.retrieval.matches.filter(c=>evidence.diagnostics.contextChunkIds.includes(c.chunkId)))};
          record.runId=evidence.runId;record.startedAt=evidence.startedAt;record.providers=evidence.providers;
          record.vector={status:'measured',method:evidence.retrieval.vectorMethod||evidence.retrieval.method,...retrievalMetrics(item,evidence.retrieval.vectorMatches||evidence.retrieval.matches)};
          record.diagnostics=evidence.diagnostics;record.endToEndLatencyMs=evidence.diagnostics.totalMs;
          record.vector.contextEvidenceRecall=retrievalMetrics(item,(evidence.retrieval.vectorMatches||evidence.retrieval.matches).filter(c=>evidence.diagnostics.contextChunkIds.includes(c.chunkId))).expectedEvidenceRecall;
          record.answer.error={code:'invalid_answer',stage:'answer_validation',reason:evidence.validationReason};
        }
      }
    }
    record.analysis=record.answer.status==='error'?'Answer failed; inspect preserved stage diagnostics if available. Rejected output is not retained.':record.vector.status==='not_run'?'Vector retrieval and generated answers remain untested.':record.vector.expectedEvidenceRecall!==null&&record.vector.expectedEvidenceRecall<1?'Inspect missing source sections, query embedding, ranking, filters and context budget.': 'Review factual correctness and semantic citation support manually; valid citation syntax does not prove support.';
    records.push(record);
  }
  const summaryFor=(key,subset=records)=>{const measured=subset.map(r=>r[key].expectedEvidenceRecall).filter(v=>v!==null);return {gradedQuestions:measured.length,allExpectedEvidence:measured.length?measured.filter(v=>v===1).length:null,meanRecall:measured.length?measured.reduce((s,v)=>s+v,0)/measured.length:null};};
  return {schemaVersion:1,corpusVersion:corpus.corpusVersion,generatedAt:new Date().toISOString(),execution:!allowProviderCalls?'offline lexical only':service.testOnly?'TEST ONLY fixtures — not semantic/model performance':'configured provider requests',summary:{questions:records.length,lexical:summaryFor('lexical'),vector:summaryFor('vector'),cohorts:Object.fromEntries(['original15','expanded15'].map(c=>[c,{questions:records.filter(r=>r.cohort===c).length,lexical:summaryFor('lexical',records.filter(r=>r.cohort===c)),vector:summaryFor('vector',records.filter(r=>r.cohort===c))}])),semanticAnswerEvaluation:'manual review pending'},records};
}
