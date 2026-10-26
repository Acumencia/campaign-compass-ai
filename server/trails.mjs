import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const pilotURL = new URL('../data/trails/pilot.json', import.meta.url);
const statuses = new Set(['allowed', 'prohibited', 'restricted', 'unknown']);
const requiredPermissions = ['walking','cycling','ebike1','ebike2','ebike3','commercialGuiding'];
const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
const validURL = value => {try {return new URL(value).protocol === 'https:';} catch {return false;}};

/** Validate curated dossiers, not raw segments. Never infer permission or identity. */
export function validateTrailManifest(manifest) {
  const errors = [];
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.trails)) return ['Expected schemaVersion 1 and trails array.'];
  if (!manifest.version || manifest.target !== 1000) errors.push('Version and explicit target of 1000 required.');
  const ids = new Set(), identities = new Set(), aliases = new Set(), sources = new Map();
  for (const [index, trail] of manifest.trails.entries()) {
    const at = trail?.id || `row ${index + 1}`;
    if (!trail || typeof trail !== 'object') {errors.push(`${at}: invalid record`);continue;}
    if (!/^[a-z0-9-]+$/.test(trail.id || '') || ids.has(trail.id)) errors.push(`${at}: missing or duplicate canonical ID`);
    ids.add(trail.id);
    if (!trail.name || !trail.state || !trail.landManager || !trail.canonicalIdentity) errors.push(`${at}: identity fields required`);
    if (identities.has(trail.canonicalIdentity)) errors.push(`${at}: duplicate route identity`);
    identities.add(trail.canonicalIdentity);
    for (const name of [trail.name, ...(trail.aliases || [])]) {
      const key = `${trail.state}:${normalize(name || '')}`;
      if (aliases.has(key)) errors.push(`${at}: duplicate name or alias requires manual route review`);
      aliases.add(key);
    }
    if (!['trail','connected-route'].includes(trail.entityType) || trail.identityVerified !== true) errors.push(`${at}: unresolved segment/route identity`);
    if (!['walking','cycling'].includes(trail.activity)) errors.push(`${at}: invalid activity`);
    if (!(trail.length?.value > 0) || !Number.isFinite(trail.length.value) || !['mi','km'].includes(trail.length.unit) || !trail.length.basis) errors.push(`${at}: invalid length/unit/basis`);
    if (!Array.isArray(trail.sources) || !trail.sources.length) errors.push(`${at}: provenance required`);
    const ownSources = new Set();
    for (const source of trail.sources || []) {
      if (!source.id || !validURL(source.url) || !source.title || !source.license || !validURL(source.rightsURL) || !validDate(source.retrievedAt) || (source.updatedAt !== null && !validDate(source.updatedAt))) errors.push(`${at}: incomplete source rights/date/URL`);
      if (sources.has(source.id) && JSON.stringify(sources.get(source.id)) !== JSON.stringify(source)) errors.push(`${at}: conflicting source version`);
      sources.set(source.id, source); ownSources.add(source.id);
    }
    for (const permission of requiredPermissions) {
      const record = trail.permissions?.[permission];
      if (!record || !statuses.has(record.status) || (record.status !== 'unknown' && !ownSources.has(record.sourceId))) errors.push(`${at}: ${permission} permission lacks evidence/status`);
    }
    if (!Array.isArray(trail.facts) || !trail.facts.length || trail.facts.some(f=>!f.id || !f.text || !ownSources.has(f.sourceId))) errors.push(`${at}: invalid fact citation`);
    if (!Array.isArray(trail.gaps) || !Array.isArray(trail.qualityFlags) || !trail.selectionRationale || !trail.version || !validURL(trail.conditionsSource)) errors.push(`${at}: quality/version/conditions fields required`);
    if (Object.hasOwn(trail,'price') || Object.hasOwn(trail,'availability') || Object.hasOwn(trail,'offer')) errors.push(`${at}: commercial offers must be stored separately`);
  }
  return errors;
}

export async function loadTrails(url = pilotURL) {
  const manifest = JSON.parse(await readFile(url, 'utf8'));
  const errors = validateTrailManifest(manifest);
  if (errors.length) throw new Error(`Trail corpus rejected: ${errors.join('; ')}`);
  return {...manifest, hash:createHash('sha256').update(JSON.stringify(manifest)).digest('hex')};
}

/** Local read-only retrieval; this is not an MCP transport or live conditions feed. */
export async function searchEvidence(query = '', filters = {}, limit = 5) {
  if (typeof query !== 'string' || query.length > 2000 || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Invalid bounded trail query.');
  if (Object.keys(filters).some(k=>!['ids','activity','state','layer'].includes(k))) throw new Error('Unsupported trail filter.');
  if (filters.ids && (!Array.isArray(filters.ids) || filters.ids.some(id=>typeof id!=='string'))) throw new Error('Invalid trail IDs.');
  if (filters.layer && filters.layer !== 'trail') return [];
  const terms = normalize(query).split(' ').filter(Boolean);
  const {trails} = await loadTrails();
  return trails.filter(t=>(!filters.ids || filters.ids.includes(t.id)) && (!filters.activity || t.permissions[filters.activity]?.status === 'allowed') && (!filters.state || t.state === filters.state))
    .map(t=>({trail:t,score:terms.reduce((n,term)=>n+Number(normalize(`${t.name} ${t.activity} ${t.state} ${t.facts.map(f=>f.text).join(' ')}`).includes(term)),0)}))
    .filter(item=>!terms.length || item.score>0).sort((a,b)=>b.score-a.score || a.trail.id.localeCompare(b.trail.id)).slice(0,limit).map(item=>item.trail);
}

export async function fetchSource(sourceId) {
  const {trails} = await loadTrails();
  return trails.flatMap(t=>t.sources).find(s=>s.id===sourceId) || null;
}

export async function corpusCounts() {
  const manifest = await loadTrails();
  const reviewRequired=manifest.trails.filter(t=>t.qualityFlags.includes('not-offer-eligible')).length;
  return {target:1000,candidates:manifest.trails.length,accepted:manifest.trails.length,indexed:0,localSearchable:manifest.trails.length,reviewRequired,demoEligible:manifest.trails.length-reviewRequired,dualUse:manifest.trails.filter(t=>t.permissions.walking.status==='allowed'&&t.permissions.cycling.status==='allowed').length,states:[...new Set(manifest.trails.map(t=>t.state))],version:manifest.version,snapshotRevision:manifest.snapshotRevision||manifest.version,hash:manifest.hash,scope:'Accepted factual dossiers include flagged review cases, not authorized offers. No vector indexing performed. Brand corpus and fictional offers counted separately.'};
}
