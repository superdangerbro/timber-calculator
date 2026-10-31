// Dashboard proof for pole pricing: pole $/m³ bands, the Stella-Jones cedar card
// table, and a cedar pole's popup (length, cut, 6 ft diameter, $/m³).
//   node apps/web/e2e/pole-pricing.mjs   (web dev running, freshly seeded)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../screenshots-tmp/v5');
fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort('internetdisconnected'));
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#email', 'joe@example.com');
await page.fill('#password', 'timber123');
await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')]);
await page.waitForSelector('[data-testid=map][data-ready="1"]', { timeout: 30000 });
await page.waitForTimeout(1500);
if (await page.$('[data-testid=open-pricing]')) await page.click('[data-testid=open-pricing]');
await page.waitForSelector('[data-testid=pole-tiers]');
const scen = await page.$eval('[data-testid=scenario-select]', (s) => s.selectedOptions[0]?.textContent);
const bands = await page.$$eval('[data-testid^=tier-price-]', (els) => els.map((e) => e.value));
console.log('scenario', scen, 'bands', bands);
assert(scen === 'Pole buyer prices' && bands.join() === '300,340,500', 'pole buyer bands on the dashboard');
await page.click('[data-testid=pole-card-0] summary');
await page.waitForTimeout(300);
const rows = await page.$$('[data-testid^=card-row-]');
assert(rows.length === 12, `12 card rows, got ${rows.length}`);
await page.evaluate(() => document.querySelector('[data-testid=pole-tiers]').scrollIntoView({ block: 'start' }));
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/web-v5-01-pricing-bands-card.png` });
await page.evaluate(() => document.querySelector('[data-testid=pole-card-0]').scrollIntoView({ block: 'start' }));
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/web-v5-02-cedar-card-table.png` });

// Fly to each cedar and click it until one is a priced pole.
const cedarIds = await page.evaluate(async () => {
  const r = await fetch('/api/trees');
  const j = await r.json();
  const list = Array.isArray(j) ? j : j.trees;
  return list.filter((t) => t.species === 'CW' && !t.voided && !t.leaveTree).map((t) => ({ id: t.id, c: [t.lon, t.lat] }));
});
console.log('cedars', cedarIds.length);
let found = null;
for (const { id, c } of cedarIds) {
  const pt = await page.evaluate((c) => {
    const m = window.__timberMap;
    m.jumpTo({ center: c, zoom: 18 });
    const p = m.project(c); const r = m.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, c);
  if (!pt) continue;
  await page.waitForTimeout(300);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(400);
  const t = await page.evaluate(() => document.querySelector('.maplibregl-popup')?.textContent ?? '');
  if (/Pole cut/.test(t)) { found = t; break; }
}
assert(found, 'a cedar pole popup');
console.log('popup', found.replace(/\s+/g, ' '));
assert(/\$(300|340|500)\/m³/.test(found) && /″ o\.b\./.test(found), 'popup shows $/m³ and 6 ft diameter');
await page.screenshot({ path: `${SHOTS}/web-v5-03-cedar-pole-popup.png` });
console.log('PASS');
await browser.close();
