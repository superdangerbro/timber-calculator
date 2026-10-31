// Pole pricing proof run at iPhone 17 Pro Max size: Settings > Prices (pole buyer
// bands), two cedar trees valued through the Stella-Jones card, a pole fault
// knocking one out of pole grade, and the info card for a valued pole.
//
//   pnpm --filter @timber/field dev
//   node apps/field/e2e/pole-pricing.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? 'http://localhost:5173/';
const SHOTS = process.env.SHOTS ?? join(here, '../../../screenshots-tmp/v5');
mkdirSync(SHOTS, { recursive: true });
const START = { latitude: 50.6995, longitude: -120.3505 };
const assert = (c, m) => { if (!c) throw new Error(`ASSERT: ${m}`); };
const errors = [];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 440, height: 956 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  geolocation: { ...START, accuracy: 4 }, permissions: ['geolocation'],
});
await context.route(/^https?:\/\/(?!localhost)/, (r) => r.abort('internetdisconnected'));
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
const tid = (id) => page.locator(`[data-testid="${id}"]`);
const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: join(SHOTS, `${name}.png`) }); console.log('screenshot', name); };
const num = async (id, v) => { await tid(id).fill(String(v)); await tid(id).press('Enter'); };
const waitStep = (p) => page.waitForFunction((p) => document.querySelector('.tally')?.getAttribute('data-step') === p, p, { timeout: 8000 });

await page.goto(`${BASE}?tts=silent`);
await tid('new-tree').waitFor();

// 1. Settings > Prices: the pole buyer bands are there out of the box.
await tid('tab-settings').click();
await tid('prices-section').scrollIntoViewIfNeeded();
const bands = await Promise.all([0, 1, 2].map(async (i) => [
  await tid(`tier-min-${i}`).inputValue(), await tid(`tier-max-${i}`).inputValue(), await tid(`tier-price-${i}`).inputValue(),
]));
console.log('bands', JSON.stringify(bands));
assert(JSON.stringify(bands) === JSON.stringify([['35', '40', '300'], ['45', '60', '340'], ['65', '', '500']]), 'buyer bands seeded');
await page.evaluate(() => document.querySelector('[data-testid=prices-section]').scrollIntoView({ block: 'start' }));
await shot('field-v5-01-settings-prices');
// Enter a cedar sawlog price (Joe's ~$200/m³) for the pole tops and non-pole cedar.
await tid('saw-CW').fill('200');
await page.waitForTimeout(300);

// 2. Tree 1: cedar, 79" around (~2 ft DBH), 100 ft marketable, clean -> pole.
await tid('tab-tally').click();
await tid('new-tree').click();
await waitStep('measure');
await page.waitForFunction(() => !document.querySelector('[data-testid=pin-now]')?.disabled || document.querySelector('[data-testid=re-pin]'), null, { timeout: 8000 });
if (await tid('pin-now').count()) await tid('pin-now').click();
await tid('sp-chip-CW').click();
await num('input-circ', 79);
await num('input-height', 100);
await tid('seg-straightness-5').click();
await tid('seg-twist-5').click();
await tid('seg-branchiness-4').click();
const check1 = (await tid('pole-check').textContent()).replace(/\s+/g, ' ');
console.log('tree 1:', check1);
assert(/Pole · 75 ft/.test(check1) && /cut 78 ft/.test(check1) && /\$500\/m³/.test(check1), `tree 1 pole call: ${check1}`);
await tid('pole-check').scrollIntoViewIfNeeded();
await page.evaluate(() => document.querySelector('[data-testid=pole-faults]').scrollIntoView({ block: 'center' }));
await shot('field-v5-02-cedar-75ft-pole-500');
await tid('next-photo').click(); await waitStep('photo');
await tid('get-tag').click(); await waitStep('saved');
const tag1 = (await tid('tag-big').textContent()).trim();

// 3. Tree 2: cedar 63" around, 80 ft -> 55 ft pole at $340; then a spike knot -> sawlog.
await tid('new-tree').click();
await waitStep('measure');
await page.waitForFunction(() => !document.querySelector('[data-testid=pin-now]')?.disabled || document.querySelector('[data-testid=re-pin]'), null, { timeout: 8000 });
if (await tid('pin-now').count()) await tid('pin-now').click();
await tid('sp-chip-CW').click();
await num('input-circ', 63);
await num('input-height', 80);
await tid('seg-straightness-5').click();
await tid('seg-twist-5').click();
await tid('seg-branchiness-4').click();
const check2 = (await tid('pole-check').textContent()).replace(/\s+/g, ' ');
console.log('tree 2:', check2);
assert(/Pole · 55 ft/.test(check2) && /\$340\/m³/.test(check2), `tree 2 pole call: ${check2}`);
await page.evaluate(() => document.querySelector('[data-testid=pole-faults]').scrollIntoView({ block: 'center' }));
await shot('field-v5-03-cedar-55ft-pole-340');
await tid('fault-knots').click();
const check3 = (await tid('pole-check').textContent()).replace(/\s+/g, ' ');
console.log('tree 2 with spike knot:', check3);
assert(/Sawlog/.test(check3) && /pole fault: Spike knot/.test(check3), `fault knocks out pole: ${check3}`);
await shot('field-v5-04-spike-knot-sawlog');
await tid('next-photo').click(); await waitStep('photo');
await tid('get-tag').click(); await waitStep('saved');

// 4. Info card for tree 1.
await page.waitForTimeout(600);
const pt = await page.evaluate((tag) => {
  const m = window.__fieldMaps['tally-map'];
  const f = m.querySourceFeatures('trees').find((x) => x.properties.tag === tag);
  if (!f) return null;
  m.jumpTo({ center: f.geometry.coordinates, zoom: 19 });
  const p = m.project(f.geometry.coordinates);
  const r = m.getCanvas().getBoundingClientRect();
  return { x: r.left + p.x, y: r.top + p.y };
}, tag1);
assert(pt, 'tree on map');
await page.waitForTimeout(400);
await page.mouse.click(pt.x, pt.y);
await tid('tree-card').waitFor({ timeout: 5000 });
const card = (await tid('tree-card').textContent()).replace(/\s+/g, ' ');
console.log('card:', card.slice(0, 260));
assert(/Pole · 75 ft/.test(card) && /78 ft/.test(card) && /\$500\/m³/.test(card) && /\$[\d,]{3,}/.test(card), 'card shows pole length, cut, $/m³ and value');
await shot('field-v5-05-card-valued-pole');

assert(errors.length === 0, `page errors: ${errors.join(' | ')}`);
console.log('PASS');
await browser.close();
