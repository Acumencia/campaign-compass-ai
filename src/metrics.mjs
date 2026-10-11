export const DEFAULT_FILTERS = Object.freeze({start:'2026-09-14', end:'2026-10-11', channel:'All', audience:'All', goal:'All'});
export const CHANNELS = ['Facebook', 'Instagram', 'Pinterest', 'Twitter'];
export const AUDIENCES = ['Prospecting', 'Retargeting', 'Lookalike'];
export const GOALS = ['Purchase', 'Traffic', 'Awareness'];
const numeric = ['spend', 'impressions', 'clicks', 'conversions', 'revenue'];
export const ratio = (a, b) => b > 0 ? a / b : null;
export const keyOf = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
export function parseCSV(text) {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const expected = ['date','campaignId','campaign','channel','audience','goal',...numeric];
  if (header !== expected.join(',')) throw new Error('Dataset columns do not match the synthetic schema.');
  const seen = new Set();
  return lines.map(line => {
    const cells = line.split(',');
    if (cells.length !== expected.length) throw new Error('Malformed dataset row.');
    const row = Object.fromEntries(expected.map((key, i) => [key, cells[i]]));
    for (const key of numeric) {
      if (!/^\d+$/.test(row[key])) throw new Error('Dataset contains invalid numeric values.');
      row[key] = Number(row[key]);
      if (!Number.isSafeInteger(row[key])) throw new Error('Dataset number outside safe range.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || Number.isNaN(Date.parse(row.date)) || new Date(row.date).toISOString().slice(0,10) !== row.date || !CHANNELS.includes(row.channel) || !AUDIENCES.includes(row.audience) || !GOALS.includes(row.goal) || !/^cc-\d{2}$/.test(row.campaignId)) throw new Error('Dataset dimensions are invalid.');
    if (row.clicks > row.impressions || row.conversions > row.clicks) throw new Error('Dataset funnel is invalid.');
    const key = `${row.date}:${row.campaignId}`;
    if (seen.has(key)) throw new Error('Duplicate campaign day.');
    seen.add(key);
    return row;
  });
}
export function validateFilters(filters) {
  for (const key of ['start','end']) if (!/^\d{4}-\d{2}-\d{2}$/.test(filters[key]) || Number.isNaN(Date.parse(filters[key])) || new Date(filters[key]).toISOString().slice(0,10) !== filters[key]) throw new Error('Choose valid start and end dates.');
  if (filters.start > filters.end) throw new Error('Start date must be on or before end date.');
  for (const [key, values] of [['channel', CHANNELS], ['audience', AUDIENCES], ['goal', GOALS]]) if (!['All', ...values].includes(filters[key])) throw new Error('Choose a supported filter value.');
}
export function filterRows(rows, filters) {
  validateFilters(filters);
  return rows.filter(row => row.date >= filters.start && row.date <= filters.end && ['channel','audience','goal'].every(key => filters[key] === 'All' || row[key] === filters[key]));
}
export function aggregate(rows) {
  const sum = Object.fromEntries(numeric.map(key => [key, rows.reduce((n,row) => n + row[key], 0)]));
  return {...sum, spend:sum.spend / 100, revenue:sum.revenue / 100, ctr:ratio(sum.clicks * 100,sum.impressions), cvr:ratio(sum.conversions * 100,sum.clicks), cpa:ratio(sum.spend / 100,sum.conversions), roas:ratio(sum.revenue,sum.spend), roi:ratio((sum.revenue-sum.spend)*100,sum.spend), rows:rows.length};
}
export function group(rows, key) {
  return [...new Set(rows.map(row => row[key]))].sort().map(name => ({name, ...aggregate(rows.filter(row => row[key] === name))}));
}
export function contextId(filters) {
  const text = ['start','end','channel','audience','goal'].map(key => `${key}=${filters[key]}`).join('|');
  let hash=2166136261; for (const ch of text) hash=Math.imul(hash ^ ch.charCodeAt(0),16777619)>>>0;
  return `synthetic-v1-${hash.toString(16)}`;
}
export function snapshot(rows, filters) {
  const selected = filterRows(rows,filters);
  const total = aggregate(selected), platforms = group(selected,'channel'), daily = group(selected,'date');
  const campaigns = [...new Set(selected.map(row=>row.campaignId))].map(id => {
    const entries=selected.filter(row=>row.campaignId===id);
    return {id,...entries[0],...aggregate(entries)};
  });
  const facts={};
  const add = (prefix, value, label) => {
    for (const key of ['spend','revenue','impressions','clicks','conversions','ctr','cvr','cpa','roas','roi']) facts[`${prefix}.${key}`]={id:`${prefix}.${key}`,value:value[key],label:`${label} · ${key.toUpperCase()}`,unit:['spend','revenue','cpa'].includes(key)?'USD':['ctr','cvr','roi'].includes(key)?'%':key==='roas'?'×':'count'};
  };
  add('total',total,'Filtered total');
  platforms.forEach(platform=>add(`platform.${keyOf(platform.name)}`,platform,platform.name));
  const anomalies=[];
  for (const campaign of campaigns) {
    const days=selected.filter(row=>row.campaignId===campaign.id).sort((a,b)=>a.date.localeCompare(b.date));
    if (days.length < 14) continue;
    const recent=aggregate(days.slice(-7)), previous=aggregate(days.slice(-14,-7));
    if (previous.cpa && recent.cpa && previous.conversions>=10 && recent.conversions>=10 && recent.cpa / previous.cpa > 1.25) {
      const prefix=`anomaly.${campaign.id}`;
      add(`${prefix}.recent`,recent,`${campaign.channel} ${campaign.audience} · recent 7 days`);
      add(`${prefix}.previous`,previous,`${campaign.channel} ${campaign.audience} · preceding 7 days`);
      const change=(recent.cpa/previous.cpa-1)*100;
      facts[`${prefix}.change`]={id:`${prefix}.change`,value:change,label:`${campaign.channel} ${campaign.audience} · CPA change`,unit:'%'};
      anomalies.push({campaign,change,recent,previous,prefix});
    }
  }
  return {id:contextId(filters),filters:{...filters},selected,total,platforms,campaigns,daily,facts,anomalies};
}
export function scenario(snap, from, to, percent) {
  if (from===to) throw new Error('Choose two different channels.');
  if (!Number.isFinite(percent) || percent<1 || percent>25) throw new Error('Choose a transfer from 1% to 25%.');
  const source=snap.platforms.find(p=>p.name===from), target=snap.platforms.find(p=>p.name===to);
  if (!source || !target || !source.cpa || !target.cpa) throw new Error('Both channels need spend and conversions in this filter context.');
  const transfer=Math.round(source.spend*percent)/100;
  const delta=transfer/target.cpa-transfer/source.cpa;
  return {contextId:snap.id,from,to,percent,transfer,currentConversions:snap.total.conversions,estimatedConversions:snap.total.conversions+delta,delta,sourceBudget:source.spend-transfer,targetBudget:target.spend+transfer,totalBudget:snap.total.spend,assumption:'Constant observed CPA; no saturation, auction, attribution or audience-overlap effects. This is arithmetic, not a causal forecast.',evidence:[`platform.${keyOf(from)}.spend`,`platform.${keyOf(from)}.cpa`,`platform.${keyOf(to)}.cpa`]};
}
