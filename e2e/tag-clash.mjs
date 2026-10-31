// A phone tallies before its first sign-in (J-0001), then signs in as Joe, whose
// account already has J-0001..J-0074. The phone must flag the clash, re-tag in
// one tap, and the server must end with no duplicate live tags.
//   (web on 3000 freshly seeded, field dev on 5173)  node e2e/tag-clash.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const FIELD = process.env.FIELD_URL ?? 'http://localhost:5173/?speech=text&tts=silent&notch=1';
const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const SHOTS = 'screenshots-tmp/integration';
mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
const errors = [];

const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  geolocation: { latitude: 50.7003, longitude: -120.3501, accuracy: 4 }, permissions: ['geolocation'] });
await c.route(/^https?:\/\/(?!localhost)/, (r) => r.abort('internetdisconnected'));
const p = await c.newPage();
p.on('pageerror', (e) => errors.push(String(e)));
const tid = (i) => p.getByTestId(i);
const waitPhase = (ph) => p.waitForFunction((ph) => document.querySelector('.tally')?.getAttribute('data-phase') === ph, ph, { timeout: 8000 });
const waitReadback = () =>
  p.waitForFunction(() => /^(?!Tag )\S/.test(document.querySelector('[data-testid=spoken]')?.textContent ?? ''), null, { timeout: 8000 });
const say = async (t) => { await tid('type-input').fill(t); await tid('type-input').press('Enter'); await p.waitForTimeout(300); };

await p.goto(FIELD);
await tid('tab-settings').click();
await tid('units-metric').click(); // this script talks metric DBH
await tid('measure-dbh').click();
await tid('tab-tally').click();
await p.waitForTimeout(800);
await tid('new-tree').click(); // New tree, then voice on (typed fallback)
await tid('mic').click();
await tid('listening').waitFor();
await say('pine thirty twenty metres straight four twist four branchy four');
await waitReadback();
await say('save');
await waitPhase('saved');
const before = (await tid('tag-big').textContent()).trim();
assert(before === 'J-0001', 'offline tag J-0001, got ' + before);

await tid('tab-settings').click();
await p.getByPlaceholder('Server URL').fill(WEB);
await p.getByPlaceholder('Email').fill('joe@example.com');
await p.getByPlaceholder('Password').fill('timber123');
await p.getByRole('button', { name: /^sign in$/i }).click();
await tid('settings-msg').filter({ hasText: /Signed in as/ }).waitFor({ timeout: 15000 });
await p.waitForTimeout(3000);

// The office sees the clash before the phone fixes it.
const w = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await w.context().route(/^https?:\/\/(?!localhost)/, (r) => r.abort('internetdisconnected'));
w.on('pageerror', (e) => errors.push('web: ' + e));
await w.request.post(`${WEB}/api/auth/login`, { data: { email: 'joe@example.com', password: 'timber123' } });
await w.goto(WEB + '/');
await tid('tab-tally').click(); // (phone) back to tally
await w.getByTestId('dup-tags').waitFor({ timeout: 15000 });
await w.getByTestId('dup-tags').click();
await w.waitForTimeout(800);
assert((await w.getByTestId('dup-badge').count()) === 2, 'two DUP badges for J-0001');
await w.screenshot({ path: `${SHOTS}/06-web-duplicate-tag.png` });

await tid('clash-banner').waitFor({ timeout: 10000 });
const bannerText = await tid('clash-banner').textContent();
console.log('banner:', bannerText.replace(/\s+/g, ' '));
assert(/J-0001/.test(bannerText) && /J-0075/.test(bannerText), 'banner names old and new tag');
await p.screenshot({ path: `${SHOTS}/07-field-clash-banner.png` });
await tid('clash-retag').click();
await p.waitForFunction(() => /J-0075/.test(document.querySelector('[data-testid=tag-big]')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
const after = (await tid('tag-big').textContent()).trim();
assert(after === 'J-0075', 're-tagged to J-0075, got ' + after);
await p.screenshot({ path: `${SHOTS}/08-field-retagged.png` });
assert((await tid('clash-banner').count()) === 0, 'banner gone');

await tid('tab-settings').click();
await p.getByRole('button', { name: /sync now/i }).click();
await p.waitForTimeout(4000);

const trees = await (await w.request.get(`${WEB}/api/trees`)).json();
const list = Array.isArray(trees) ? trees : trees.trees;
const counts = {};
for (const t of list) if (!t.voided) counts[t.tag] = (counts[t.tag] ?? 0) + 1;
const dups = Object.entries(counts).filter(([, n]) => n > 1);
assert(dups.length === 0, 'server duplicates: ' + JSON.stringify(dups));
assert(list.some((t) => t.tag === 'J-0075'), 'J-0075 on server');
await w.reload();
await w.waitForTimeout(2500);
assert((await w.getByTestId('dup-tags').count()) === 0, 'dashboard duplicate warning cleared');
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await b.close();
console.log('PASS');
