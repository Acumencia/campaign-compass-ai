import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {validateTrailManifest} from '../server/trails.mjs';

// Explicit offline intake. Never downloads, scrapes, indexes or promotes records.
const input = process.argv[2] || 'data/trails/pilot.json';
const reportPath = process.argv[3];
try {
  const manifest = JSON.parse(await readFile(resolve(input),'utf8'));
  const errors = validateTrailManifest(manifest);
  const report = {checkedAt:new Date().toISOString(),input,valid:errors.length===0,candidates:manifest.trails?.length||0,accepted:errors.length?0:manifest.trails.length,indexed:0,target:1000,errors,limitations:['Schema/provenance validation does not verify source truth.','Human route identity, connectivity, rights and permission review required before acceptance.','No ingestion, vector indexing or network requests performed.']};
  if (reportPath) await writeFile(resolve(reportPath),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report,null,2));
  if(errors.length) process.exitCode=1;
} catch(error) {console.error(`Trail validation failed: ${error.message}`);process.exitCode=1;}
