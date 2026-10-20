import {ingest} from '../server/knowledge.mjs';
import {fileURLToPath} from 'node:url';
const result=await ingest(fileURLToPath(new URL('../data/knowledge/corpus/',import.meta.url)),fileURLToPath(new URL('../data/knowledge/index.json',import.meta.url)));
console.log(JSON.stringify({corpusVersion:result.corpus.corpusVersion,documents:result.corpus.documents.length,chunks:result.corpus.chunks.length,changes:result.changes,providers:result.corpus.providers},null,2));
