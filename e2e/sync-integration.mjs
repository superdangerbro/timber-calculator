// Field app <-> server round trip: sign in from the phone, tally trees, sync,
// then confirm they show in the dashboard and that a dashboard edit flows back.
//   pnpm --filter @timber/web start  &  pnpm --filter @timber/field dev  &
//   node e2e/sync-integration.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const FIELD = process.env.FIELD_URL ?? 'http://localhost:5173/?speech=text&tts=silent';
const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const SHOTS = 'screenshots-tmp/integration';
mkdirSync(SHOTS, { recursive: true });
const errors = [];
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

const browser = await chromium.launch();
const phone = await browser.newContext({
  viewport: { width: 440, height: 956 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  geolocation: { latitude: 50.7003, longitude: -120.3501, accuracy: 4 }, permissions: ['geolocation'],
});
await phone.route(/^https?:\/\/(?!localhost)/, (r) => r.abort('internetdisconnected'));
const p = await phone.newPage();
p.on('pageerror', (e) => errors.push('field: ' + e));

const tid = (id) => p.getByTestId(id);
await p.goto(FIELD);
await tid('tab-settings').click();
await p.getByPlaceholder('Server URL').fill(WEB);
await p.getByPlaceholder('Email').fill('joe@example.com');
await p.getByPlaceholder('Password').fill('timber123');
await p.getByRole('button', { name: /^sign in$/i }).click();
await p.getByTestId('settings-msg').filter({ hasText: /Signed in as/ }).waitFor({ timeout: 15000 });
await p.waitForTimeout(3000); // initial pull
await p.screenshot({ path: `${SHOTS}/01-field-signed-in.png` });

await tid('tab-tally').click();
await p.waitForTimeout(800);
const waitPhase = (ph) => p.waitForFunction((ph) => document.querySelector('.tally')?.getAttribute('data-phase') === ph, ph, { timeout: 8000 });
const say = async (t) => {
  await tid('type-input').fill(t);
  await tid('type-input').press('Enter');
  await p.waitForTimeout(300);
};
await tid('talk').click();
await say('fir fifty one thirty two metres straight five no twist clean');
await waitPhase('readback');
await say('save');
await waitPhase('saved');
const tag1 = (await tid('tag-big').textContent()).trim();
console.log('first phone tag', tag1);
assert(Number(tag1.slice(2)) > 74, `tag continues after server's J-0074, got ${tag1}`);
await say('cedar forty four twenty six metres straight three twist four branchy two rot at the butt');
await waitPhase('readback');
await say('save');
await waitPhase('saved');
await p.screenshot({ path: `${SHOTS}/02-field-tallied.png` });

await tid('tab-settings').click();
await p.getByRole('button', { name: /sync now/i }).click();
await p.waitForTimeout(4000);
await p.screenshot({ path: `${SHOTS}/03-field-synced.png` });

// Dashboard
const office = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await office.route(/^https?:\/\/(?!localhost)/, (r) => r.abort('internetdisconnected'));
const w = await office.newPage();
w.on('pageerror', (e) => errors.push('web: ' + e));
const login = await w.request.post(`${WEB}/api/auth/login`, { data: { email: 'joe@example.com', password: 'timber123' } });
assert(login.ok(), 'web login');
const trees = await (await w.request.get(`${WEB}/api/trees`)).json();
const list = Array.isArray(trees) ? trees : trees.trees;
const synced = list.find((t) => t.tag === tag1);
assert(synced, `${tag1} reached the server`);
assert(synced.species === 'FD' && synced.dbhCm === 51 && synced.heightM === 32, 'fields intact: ' + JSON.stringify(synced));
console.log('server has', list.length, 'trees incl', tag1);

// Dashboard edit flows back to the phone
const ev = await w.request.post(`${WEB}/api/trees/${synced.id}/events`, { data: { type: 'update', payload: { fields: { dbhCm: 53 } } } });
assert(ev.ok(), 'dashboard edit accepted: ' + ev.status() + ' ' + (await ev.text()));
await w.goto(WEB + '/');
await w.waitForTimeout(3000);
await w.screenshot({ path: `${SHOTS}/04-dashboard-with-phone-trees.png` });

await p.getByRole('button', { name: /sync now/i }).click();
await p.waitForTimeout(4000);
await tid('tab-trees').click();
await tid('when-all').click();
await p.waitForTimeout(800);
const row = tid(`row-${tag1}`);
await row.scrollIntoViewIfNeeded();
const card = await row.textContent();
console.log('phone row:', card.replace(/\s+/g, ' ').slice(0, 120));
assert(/53 cm/.test(card), 'dashboard edit pulled to phone');
await p.screenshot({ path: `${SHOTS}/05-field-after-pull.png` });

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
console.log('PASS');
