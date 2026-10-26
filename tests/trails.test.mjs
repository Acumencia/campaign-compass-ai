import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTrails,validateTrailManifest,searchEvidence,fetchSource,corpusCounts} from '../server/trails.mjs';

test('curated seed has 25 distinct cited routes and truthful counts',async()=>{
  const corpus=await loadTrails();assert.deepEqual(validateTrailManifest(corpus),[]);
  assert.equal(corpus.trails.length,25);assert.equal(new Set(corpus.trails.map(t=>t.canonicalIdentity)).size,25);
  const counts=await corpusCounts();assert.equal(counts.accepted,25);assert.equal(counts.indexed,0);assert.equal(counts.target,1000);assert.equal(counts.states.length,5);assert.equal(counts.reviewRequired,2);assert.equal(counts.dualUse,2);
  for(const trail of corpus.trails){assert.equal(trail.permissions.commercialGuiding.status,'unknown');for(const fact of trail.facts)assert.ok(await fetchSource(fact.sourceId));}
});
test('activity filters do not turn missing permission into access',async()=>{
  const ids=['nps-ever-anhinga','nps-ever-shark-valley'];
  assert.deepEqual((await searchEvidence('',{activity:'walking',ids})).map(t=>t.id),['nps-ever-anhinga']);
  assert.deepEqual((await searchEvidence('',{activity:'cycling',ids})).map(t=>t.id),['nps-ever-shark-valley']);
  assert.deepEqual(await searchEvidence('',{activity:'commercialGuiding'}),[]);
  assert.deepEqual(await searchEvidence('',{layer:'offer'}),[]);
  assert.equal(await fetchSource('unknown'),null);
  await assert.rejects(searchEvidence('',{},100));
  await assert.rejects(searchEvidence('',{ids:'not-an-array'}));
});
test('duplicate aliases, IDs and segment rows cannot inflate dossier counts',async()=>{
  const corpus=await loadTrails();const duplicate=structuredClone(corpus.trails[0]);duplicate.id='new-id';corpus.trails.push(duplicate);
  const errors=validateTrailManifest(corpus);assert.ok(errors.some(e=>e.includes('duplicate route')));assert.ok(errors.some(e=>e.includes('duplicate name')));
  duplicate.id=corpus.trails[0].id;duplicate.entityType='segment';assert.ok(validateTrailManifest(corpus).some(e=>e.includes('duplicate canonical')));assert.ok(validateTrailManifest(corpus).some(e=>e.includes('segment/route')));
});
test('reject absent rights, ungrounded permission, unsupported units and mixed commercial offers',async()=>{
  const corpus=await loadTrails(),t=corpus.trails[0];delete t.sources[0].license;t.permissions.commercialGuiding={status:'allowed',sourceId:'invented'};t.length.unit='minutes';t.price=25;
  const errors=validateTrailManifest(corpus);assert.ok(errors.some(e=>e.includes('rights')));assert.ok(errors.some(e=>e.includes('commercialGuiding')));assert.ok(errors.some(e=>e.includes('length')));assert.ok(errors.some(e=>e.includes('stored separately')));
});
test('restricted and contradictory source gaps remain visible',async()=>{
  const {trails}=await loadTrails();assert.equal(trails[0].permissions.cycling.status,'prohibited');
  assert.ok(trails[1].qualityFlags.includes('duration-conflict-within-source'));assert.ok(trails[1].gaps.some(g=>g.includes('inconsistent duration')));
  assert.ok(trails.slice(0,2).every(t=>t.permissions.ebike1.status==='unknown'));
  assert.equal(trails.find(t=>t.id==='nps-olym-cascading-terraces').permissions.walking.status,'unknown');
  assert.ok(trails.find(t=>t.id==='nps-brca-bristlecone').qualityFlags.includes('conflicting_facts'));
});
