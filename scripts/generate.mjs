import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export const SEED = 271828;
export function generate(seed = SEED) {
  let state = seed;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  const channels = ['Facebook', 'Instagram', 'Pinterest', 'Twitter'];
  const audiences = ['Prospecting', 'Retargeting', 'Lookalike'];
  const goals = ['Purchase', 'Traffic', 'Awareness'];
  const names = ['Evergreen essentials', 'The discovery edit', 'Everyday inspiration', 'New perspectives'];
  const rows = [];
  for (let day = 0; day < 28; day++) {
    const date = new Date(Date.UTC(2026, 8, 14 + day)).toISOString().slice(0, 10);
    channels.forEach((channel, c) => audiences.forEach((audience, a) => {
      const fatigue = c === 1 && a === 0 && day >= 21;
      const spend = Math.round((170 + c * 18 + a * 52) * (0.86 + random() * 0.28) * (day % 7 > 4 ? 1.12 : 1) * 100);
      const impressions = Math.round(spend / (0.67 + c * 0.08) * (0.9 + random() * 0.2));
      const clicks = Math.round(impressions * (0.019 + a * 0.004 - c * 0.0015) * (fatigue ? 0.58 : 1));
      const conversions = Math.round(clicks * (0.038 + a * 0.011 - c * 0.004) * (0.9 + random() * 0.2));
      const revenue = Math.round(conversions * (58 + c * 4) * (0.94 + random() * 0.12) * 100);
      rows.push({date, campaignId:`cc-${c + 1}${a + 1}`, campaign:`${names[c]} / ${audience}`, channel, audience, goal:goals[a], spend, impressions, clicks, conversions, revenue});
    }));
  }
  return rows;
}
export function csv(rows) {
  const keys = Object.keys(rows[0]);
  return keys.join(',') + '\n' + rows.map(row => keys.map(key => row[key]).join(',')).join('\n') + '\n';
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL('../data/campaigns.csv', import.meta.url), csv(generate()));
  console.log(`Generated 336 synthetic rows. Seed ${SEED}; currency stored as integer USD cents.`);
}
