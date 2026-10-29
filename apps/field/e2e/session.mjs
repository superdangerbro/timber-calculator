// End-to-end field session in headless Chromium at iPhone 17 Pro Max size.
// Speech is simulated with the typed-transcript box (?speech=text), TTS is
// recorded silently (?tts=silent) and shown on screen, GPS comes from
// Playwright's geolocation emulation near the CB12 block.
//
//   pnpm --filter @timber/field dev        # in one terminal
//   node apps/field/e2e/session.mjs        # in another (BASE_URL to override)
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? 'http://localhost:5173/';
const SHOTS = process.env.SHOTS ?? join(here, '../../../screenshots-tmp/field');
mkdirSync(SHOTS, { recursive: true });

const START = { latitude: 50.6995, longitude: -120.3505 };
let step = 0;
const errors = [];
const log = (...a) => console.log(`[${String(++step).padStart(2, '0')}]`, ...a);
function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  geolocation: { ...START, accuracy: 4 },
  permissions: ['geolocation'],
  acceptDownloads: true,
});
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

// No internet tiles in the sandbox: every external request fails fast until we
// deliberately serve fake imagery for the "download map" step.
let serveTiles = false;
let tilePng = null;
await context.route(/^https?:\/\/(?!localhost)/, async (route) => {
  if (serveTiles && /World_Imagery|api\.mapbox\.com/.test(route.request().url()) && tilePng) {
    return route.fulfill({ status: 200, contentType: 'image/png', body: tilePng });
  }
  return route.abort('internetdisconnected');
});

const shot = async (name) => {
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
  console.log('    screenshot', name);
};
const tid = (id) => page.locator(`[data-testid="${id}"]`);
const say = async (text) => {
  await tid('type-input').fill(text);
  await tid('type-input').press('Enter');
  await page.waitForTimeout(150);
};
const waitStep = async (p) => page.waitForFunction((p) => document.querySelector('.tally')?.getAttribute('data-step') === p, p, { timeout: 8000 });
const lastTag = async () => (await tid('tag-big').textContent())?.trim();
const num = async (id, v) => {
  await tid(id).fill(String(v));
  await tid(id).press('Enter');
};
/** Fill the Measure form by tapping, like a glove would. */
const fillTree = async ({ sp, circ, dbh, height, s, t, b, defects = [], other, leave }) => {
  if (sp) await tid(`sp-chip-${sp}`).click();
  if (circ !== undefined) await num('input-circ', circ);
  if (dbh !== undefined) await num('input-dbh', dbh);
  if (height !== undefined) await num('input-height', height);
  if (s) await tid(`seg-straightness-${s}`).click();
  if (t) await tid(`seg-twist-${t}`).click();
  if (b) await tid(`seg-branchiness-${b}`).click();
  for (const d of defects) await tid(`defect-${d}`).click();
  if (other) await num('defect-other', other);
  if (leave) await tid('leave-toggle').click();
};
const startTree = async () => {
  await tid('new-tree').click();
  await waitStep('measure');
  await tid('pinbar').waitFor();
};
const pinNow = async () => {
  await page.waitForFunction(() => !document.querySelector('[data-testid=pin-now]')?.disabled || document.querySelector('[data-testid=re-pin]'), null, { timeout: 8000 });
  if (await tid('pin-now').count()) await tid('pin-now').click();
  await tid('re-pin').waitFor();
};
/** Measure -> Photo (skipped) -> Get tag. */
const tagIt = async () => {
  await tid('next-photo').click();
  await waitStep('photo');
  await tid('get-tag').click();
  await waitStep('saved');
  return lastTag();
};
let walk = 0;
const moveTo = async (dNorthM, dEastM) => {
  walk++;
  const lat = START.latitude + dNorthM / 111320;
  const lon = START.longitude + dEastM / (111320 * Math.cos((START.latitude * Math.PI) / 180));
  await context.setGeolocation({ latitude: lat, longitude: lon, accuracy: 3 + (walk % 4) });
};
const makeJpeg = async (path, label) => {
  const b64 = await page.evaluate((label) => {
    const c = document.createElement('canvas');
    c.width = 2400; c.height = 1800;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 1800);
    grad.addColorStop(0, '#9cc7e8'); grad.addColorStop(1, '#2f5d3a');
    g.fillStyle = grad; g.fillRect(0, 0, 2400, 1800);
    g.fillStyle = '#5b3b22'; g.fillRect(1050, 300, 300, 1500);
    g.fillStyle = '#ff6b1a'; g.fillRect(1030, 1000, 340, 70);
    g.fillStyle = '#fff'; g.font = 'bold 54px sans-serif'; g.fillText(label, 1110, 1052);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `hsl(${100 + (i % 40)},40%,${15 + (i % 30)}%)`; g.fillRect((i * 97) % 2400, (i * 53) % 900, 6, 6); }
    return c.toDataURL('image/jpeg', 0.95).split(',')[1];
  }, label);
  writeFileSync(path, Buffer.from(b64, 'base64'));
};

try {
  // ---------------------------------------------------------------- boot (Joe's defaults: imperial, circumference)
  await page.goto(`${BASE}?speech=text&tts=silent&notch=1`);
  await tid('new-tree').waitFor();
  await page.waitForTimeout(1500);
  assert((await tid('listening').count()) === 0, 'nothing listens on launch');
  log('Tally home, empty, mic off');
  await shot('01-tally-empty');

  // ---------------------------------------------------------------- block boundary
  await tid('tab-maps').click();
  await tid('boundary-file').setInputFiles(join(here, 'fixtures/cb12.geojson'));
  await tid('block-CB12').waitFor();
  log('Imported CB12 boundary');
  await shot('02-maps-block-imported');
  await tid('tab-tally').click();
  await page.waitForTimeout(800);

  // ---------------------------------------------------------------- tree 1: every step by buttons, with a photo
  await moveTo(10, 5);
  await startTree();
  log('New tree -> pinning');
  await shot('03-pinning');
  await tid('re-pin').waitFor({ timeout: 12000 }); // auto-pins after averaging
  const acc = await tid('pin-accuracy').textContent();
  assert(/fix/.test(acc), `pin shows accuracy and fixes: ${acc}`);
  log('Pinned:', acc);
  await fillTree({ sp: 'FD', circ: 52, height: 98, s: 4, t: 5, b: 5 });
  const derived = await tid('derived-dbh').textContent();
  assert(/DBH 16\.5 in/.test(derived), `DBH derived from circumference: ${derived}`);
  log('Form filled, derived', derived.split('(')[0].trim());
  await shot('04-form-filled');
  await tid('next-photo').click();
  await waitStep('photo');
  await shot('05-photo-step');
  const jpeg1 = join(SHOTS, 'tree1.jpg');
  await makeJpeg(jpeg1, 'J-0001');
  const [ch1] = await Promise.all([page.waitForEvent('filechooser'), tid('photo-library').click()]);
  await ch1.setFiles(jpeg1);
  await tid('pending-photo').waitFor({ timeout: 15000 });
  await shot('06-photo-added');
  await tid('get-tag').click();
  await waitStep('saved');
  assert((await lastTag()) === 'J-0001', 'first tag J-0001');
  assert(/Write this on the tape/.test(await tid('last-tag').textContent()), 'tag hero caption');
  assert(/Photo \(1\)/.test(await tid('saved-photo').textContent()), 'photo saved with the tree');
  log('Saved J-0001 with 1 photo');
  await shot('07-saved-tag-J-0001');

  // ---------------------------------------------------------------- tree 2: missing fields -> confirm -> fill in
  await moveTo(28, -12);
  await startTree();
  await pinNow();
  await fillTree({ sp: 'CW', circ: 68, height: 92, s: 3, defects: ['sweep'] });
  await tid('next-photo').click();
  await tid('get-tag').click();
  await tid('confirm-missing').waitFor();
  const conf = await tid('confirm-missing').textContent();
  assert(/twist, branchiness/.test(conf), `confirm lists missing: ${conf}`);
  log('Confirm:', conf.replace(/\s+/g, ' ').slice(0, 60));
  await shot('08-confirm-missing');
  await tid('confirm-back').click();
  await waitStep('measure');
  assert((await tid('confirm-missing').count()) === 0, 'confirm closes');
  await shot('09-missing-highlighted');
  await fillTree({ t: 4, b: 2 });
  assert((await tagIt()) === 'J-0002', 'second tag');
  log('Saved J-0002');

  // ---------------------------------------------------------------- metric + DBH from here (Settings)
  await tid('tab-settings').click();
  await tid('units-metric').click();
  await tid('measure-dbh').click();
  await tid('tab-tally').click();

  // tree 3: DBH form, switch to circumference, tag anyway with a gap
  await moveTo(40, 22);
  await startTree();
  await pinNow();
  await fillTree({ sp: 'PL', dbh: 30, height: 24, s: 5, t: 5 });
  await tid('girth-mode').click();
  await num('input-circ', 100.5);
  assert(/DBH 32 cm/.test(await tid('derived-dbh').textContent()), 'metric circumference -> DBH 32');
  await shot('10-form-metric-circ');
  await tid('next-photo').click();
  await tid('get-tag').click();
  await tid('confirm-tag').click();
  await waitStep('saved');
  assert((await lastTag()) === 'J-0003', 'third tag (tagged anyway)');
  log('Saved J-0003 with branchiness missing');

  // ---------------------------------------------------------------- offline from here on
  await context.setOffline(true);
  log('Network OFF');

  // tree 4 then undo
  await moveTo(55, -30);
  await startTree();
  await fillTree({ sp: 'LW', dbh: 38, height: 26, s: 4, t: 4, b: 3 });
  assert((await tagIt()) === 'J-0004', 'fourth tag');
  await tid('undo').click();
  await page.waitForFunction(() => /Voided J-0004/.test(document.querySelector('[data-testid="notice"]')?.textContent ?? ''));
  log('Undo voided J-0004');
  await shot('11-undo-voided');

  // tree 5: re-tally, number 4 is never reused
  await startTree();
  await fillTree({ sp: 'LW', dbh: 38, height: 26, s: 4, t: 4, b: 3 });
  assert((await tagIt()) === 'J-0005', 'J-0004 not reused');
  await tid('repeat').click();
  log('Saved J-0005 (offline)');
  await shot('12-offline-saved-J-0005');

  // leave tree
  await moveTo(70, 8);
  await startTree();
  await fillTree({ sp: 'FD', dbh: 72, leave: true });
  assert((await tagIt()) === 'J-L0001', 'leave series');
  log('Leave tree J-L0001');
  await shot('13-leave-tree');

  // ---------------------------------------------------------------- tree 6 via Bluetooth clicker + clinometer
  await moveTo(85, -18);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press('Space'); // clicker: saved -> new tree
  await waitStep('measure');
  await fillTree({ sp: 'SX', dbh: 36, s: 4, t: 4, b: 3 });
  await tid('open-measure').click();
  await tid('measure').waitFor();
  log('Clinometer open');
  await shot('14-measure-base');
  await tid('distance').fill('20');
  const setPitch = async (v) =>
    tid('pitch-slider').evaluate((el, v) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
  await setPitch(-4);
  await tid('mark').click();
  await setPitch(52);
  await tid('mark').click();
  const h = (await tid('height-result').textContent()).trim();
  log('Clinometer height', h);
  assert(/^2[67]\.\d m$/.test(h), `height from angles ${h}`); // 20*(tan52 - tan(-4)) = 27.0
  await shot('15-measure-result');
  await tid('mark').click(); // "Use"
  await tid('measure').waitFor({ state: 'detached' });
  assert(/^2[67]/.test(await tid('input-height').inputValue()), 'height filled from clinometer');
  await shot('16-height-filled');
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press('Enter'); // clicker: measure -> photo
  await waitStep('photo');
  await page.keyboard.press('Enter'); // clicker: photo -> tag
  await waitStep('saved');
  assert((await lastTag()) === 'J-0006', 'clicker tag J-0006');
  assert((await tid('listening').count()) === 0, 'clicker never starts the mic');
  log('Clicker tagged J-0006');
  await shot('17-tally-after-six');

  // ---------------------------------------------------------------- tree list + edit
  await tid('tab-trees').click();
  await tid('tree-list').waitFor();
  log('Trees list');
  await shot('20-trees-list');
  await tid('row-J-0002').click();
  await tid('tree-editor').waitFor();
  await tid('field-dbhCm').click();
  await tid('input-dbhCm').fill('57');
  await tid('input-dbhCm').press('Enter');
  await shot('21-tree-editor');
  await tid('save-edit').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="row-J-0002"]')?.textContent?.includes('57 cm'));
  log('Edited J-0002 DBH -> 57 (update event)');
  // void J-0003 from the list
  await tid('row-J-0003').click();
  await tid('void').click();
  await tid('confirm-void').click();
  await page.waitForTimeout(300);
  assert((await tid('row-J-0003').count()) === 0, 'voided row hidden');
  await page.locator('.void-toggle input').check();
  await tid('sp-FD').click();
  log('Filtered FD incl. voids');
  await shot('22-trees-filter-fd');
  await page.locator('.void-toggle input').uncheck();
  await page.locator('.fchip').first().click();
  await tid('prod-pole').click();
  await shot('23-trees-filter-poles');
  await tid('prod-all').click();

  // ---------------------------------------------------------------- audit
  await context.setGeolocation({ latitude: START.latitude + 30 / 111320, longitude: START.longitude, accuracy: 4 });
  await tid('tab-audit').click();
  await tid('audit-card').waitFor();
  await page.waitForTimeout(800);
  log('Audit, nearest first:', await tid('audit-tag').textContent());
  await shot('24-audit');
  const target = (await tid('audit-tag').textContent()).trim();
  await tid('audit-type').fill('cut stump forty');
  await tid('audit-type').press('Enter');
  await tid('audit-flash').waitFor();
  const flash = await tid('audit-flash').textContent();
  assert(flash.includes(target) && /cut/.test(flash) && /40/.test(flash), `audit status: ${flash}`);
  await tid('audit-next').click();
  await tid('status-damaged').click();
  log('Audit:', flash);
  await shot('25-audit-status');

  // ---------------------------------------------------------------- settings + export
  await tid('tab-settings').click();
  await tid('settings-screen').waitFor();
  await shot('26-settings');
  const [download] = await Promise.all([page.waitForEvent('download'), tid('export-csv').click()]);
  const csvPath = join(SHOTS, 'export.csv');
  await download.saveAs(csvPath);
  const csv = readFileSync(csvPath, 'utf8');
  assert(csv.includes('J-0001') && csv.includes('J-0006') && !csv.includes('J-0004'), 'CSV has live trees only');
  log(`CSV export ${csv.split('\n').length - 1} rows`);
  await page.locator('.page').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await shot('27-settings-export');

  // ---------------------------------------------------------------- back online: offline map download
  await context.setOffline(false);
  log('Network ON');
  const tileGen = await context.newPage();
  tilePng = Buffer.from(
    (
      await tileGen.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const g = c.getContext('2d');
        g.fillStyle = '#21402c';
        g.fillRect(0, 0, 256, 256);
        let s = 7;
        const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 900; i++) {
          const x = rnd() * 256, y = rnd() * 256, r = 2 + rnd() * 7;
          g.fillStyle = `hsl(${105 + rnd() * 40}, ${25 + rnd() * 25}%, ${12 + rnd() * 18}%)`;
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
        return c.toDataURL('image/png');
      })
    ).split(',')[1],
    'base64',
  );
  await tileGen.close();
  serveTiles = true;
  await tid('tab-maps').click();
  await tid('download-CB12').click();
  await tid('region-CB12').waitFor({ timeout: 60000 });
  log('Offline map:', await tid('region-CB12').textContent());
  await shot('28-maps-downloaded');
  serveTiles = false; // from now on tiles can only come from local storage

  // ---------------------------------------------------------------- reload: data persisted
  await page.reload();
  await tid('new-tree').waitFor();
  await page.waitForTimeout(2500);
  assert((await lastTag()) === 'J-0006', 'last tag shown after reload');
  await shot('29-tally-after-reload');
  await tid('tab-trees').click();
  await tid('when-all').click();
  const rows = await page.locator('.tree-row').count();
  assert(rows === 5, `5 live trees after reload, got ${rows}`); // J-0001,2,5,6 + J-L0001
  log(`Reload: ${rows} live trees persisted`);
  await shot('30-trees-after-reload');
  await tid('tab-settings').click();
  assert((await tid('next-tag').textContent()).trim() === 'J-0007', 'next tag survives reload');

  // ---------------------------------------------------------------- offline again, after reload: still tallies
  await context.setOffline(true);
  await tid('tab-tally').click();
  await moveTo(100, 30);
  await startTree();
  await fillTree({ sp: 'FD', dbh: 45, height: 32, s: 5, t: 5, b: 4 });
  await tagIt();
  assert((await lastTag()) === 'J-0007', 'offline after reload J-0007');
  log('Offline tally after reload -> J-0007');
  await shot('31-offline-after-reload');
  await context.setOffline(false);

  // simulated GPS toggle
  await tid('tab-settings').click();
  await tid('sim-gps').click();
  await page.waitForTimeout(1500);
  await tid('tab-tally').click();
  await page.waitForTimeout(1200);
  await shot('32-simulated-gps');
  await tid('tab-settings').click();
  await tid('sim-gps').click();

  // ---------------------------------------------------------------- v2: circumference in imperial, photo, info card
  const V2 = join(here, '../../../screenshots-tmp/v2');
  mkdirSync(V2, { recursive: true });
  const shot2 = async (name) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(V2, `${name}.png`) });
    console.log('    screenshot v2', name);
  };
  await tid('tab-settings').click();
  await tid('units-imperial').click();
  await tid('measure-circumference').click();
  await tid('tab-tally').click();
  await page.waitForTimeout(600);
  await moveTo(60, -40);
  // One tree by voice (typed fallback stands in for the microphone).
  await tid('mic').click();
  await tid('listening').waitFor();
  await tid('voice-stop').waitFor();
  log('Voice on: listening, Stop visible');
  await shot2('field-00-voice-listening');
  await tid('voice-stop').click();
  await tid('listening').waitFor({ state: 'detached' });
  assert(await tid('new-tree').isVisible(), 'Stop goes back to the buttons');
  log('Stop -> back to buttons');
  await tid('mic').click();
  await tid('listening').waitFor();
  await say('new tree');
  await waitStep('measure');
  await say('fir circumference seventy five inches ninety eight feet straight four no twist clean');
  await page.waitForFunction(() => /^Douglas-fir/.test(document.querySelector('[data-testid=spoken]')?.textContent ?? ''), null, { timeout: 8000 });
  const rb = (await tid('spoken').textContent()).trim();
  assert(rb === 'Douglas-fir, circumference 75 inches, DBH 23.9 inches, 98 feet, straightness 4, twist 5, branchiness 5.', `imperial readback: ${rb}`);
  assert((await tid('input-circ').inputValue()) === '75', 'voice filled the form');
  log('Imperial readback:', rb);
  await shot2('field-01-readback-circumference');
  await say('save');
  await waitStep('saved');
  const circTag = await lastTag();
  assert(circTag === 'J-0008', `circumference tree tag ${circTag}`);
  await tid('mic').click(); // voice off
  await tid('listening').waitFor({ state: 'detached' });
  // Stored metric: 75 in = 190.5 cm circumference, DBH = C / pi = 60.6 cm, 98 ft = 29.9 m.
  const stored = await page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('timber-field');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const q = r.result.transaction('events').objectStore('events').getAll();
      q.onsuccess = () => res(q.result.map((row) => row.event).find((e) => e.type === 'create' && e.payload.tag === 'J-0008')?.payload.fields);
    };
  }));
  assert(stored && stored.circumferenceCm === 190.5 && Math.abs(stored.dbhCm - 60.6) < 0.05 && Math.abs(stored.heightM - 29.9) < 0.05,
    'stored metric fields: ' + JSON.stringify(stored));
  log('Stored:', JSON.stringify({ circumferenceCm: stored.circumferenceCm, dbhCm: stored.dbhCm, heightM: stored.heightM }));
  await shot2('field-02-saved-with-photo-button');

  // Photo: a big test JPEG (exercises the on-device shrink to <= 1280 px).
  const jpegPath = join(V2, 'test-photo.jpg');
  await makeJpeg(jpegPath, 'J-0008');
  await tid('saved-photo').click();
  await tid('photo-sheet').waitFor();
  await shot2('field-03-photo-sheet');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), tid('photo-library').click()]);
  await chooser.setFiles(jpegPath);
  await tid('photo-sheet').waitFor({ state: 'detached', timeout: 15000 });
  await page.waitForFunction(() => /Photo added/.test(document.querySelector('[data-testid=notice]')?.textContent ?? ''), null, { timeout: 8000 });
  log('Photo attached to', circTag);

  // Tap the tree's dot -> info card with the thumbnail.
  const pt = await page.evaluate((tag) => {
    const m = window.__fieldMaps['tally-map'];
    const f = m.querySourceFeatures('trees').find((x) => x.properties.tag === tag);
    if (!f) return null;
    m.jumpTo({ center: f.geometry.coordinates });
    const p = m.project(f.geometry.coordinates);
    const r = m.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, circTag);
  assert(pt, 'tree dot on map');
  await page.waitForTimeout(400);
  await page.mouse.click(pt.x, pt.y);
  await tid('tree-card').waitFor({ timeout: 5000 });
  await page.waitForFunction(() => {
    const img = document.querySelector('[data-testid=tree-card] [data-testid=photo-img]');
    return img && img.complete && img.naturalWidth > 0;
  }, null, { timeout: 8000 });
  const dims = await page.evaluate(() => {
    const img = document.querySelector('[data-testid=tree-card] [data-testid=photo-img]');
    return { w: img.naturalWidth, h: img.naturalHeight };
  });
  assert(Math.max(dims.w, dims.h) <= 1280, `photo shrunk to <= 1280 px, got ${dims.w}x${dims.h}`);
  const cardText = (await tid('tree-card').textContent()).replace(/\s+/g, ' ');
  assert(/75 in/.test(cardText) && /23\.9 in/.test(cardText) && /98 ft/.test(cardText) && /prices not set/.test(cardText), `card: ${cardText}`);
  log(`Info card OK, photo ${dims.w}x${dims.h}`);
  await shot2('field-04-info-card-photo');
  await tid('photo-thumb').first().click();
  await tid('photo-viewer').waitFor();
  await shot2('field-05-photo-fullscreen');
  await tid('photo-viewer').click();
  await page.locator('[data-testid=tree-card] .icon-btn[aria-label=Close]').click();

  // Totals without prices show volume, not dollars.
  assert(await tid('totals-volume').count(), 'totals show m³ when no prices');
  await shot2('field-06-totals-no-prices');

  // Tree editor: circumference field and derived DBH; stored metric.
  await tid('tab-trees').click();
  await tid('when-all').click();
  await tid(`row-${circTag}`).click();
  await tid('tree-editor').waitFor();
  await tid('field-circumferenceCm').click();
  await tid('input-circumferenceCm').fill('78');
  assert(/DBH 24\.8 in/.test(await tid('derived-dbh').textContent()), 'derived DBH shown while typing');
  await shot2('field-07-editor-circumference');
  await page.locator('[data-testid=editor-circumferenceCm] button[type=submit]').click();
  await tid('save-edit').click();
  await tid('tab-settings').click();
  await tid('units-metric').click();
  await tid('tab-trees').click();
  const rowText = (await tid(`row-${circTag}`).textContent()).replace(/\s+/g, ' ');
  assert(/C 198\.1 cm/.test(rowText) && /63\.1 cm/.test(rowText), `stored metric after edit: ${rowText}`);
  log('Edited circumference, metric row:', rowText);
  await shot2('field-08-trees-metric');
  await tid('tab-settings').click();
  await tid('units-imperial').click();


  // ---------------------------------------------------------------- v4: move the pin by hand, no voice
  const V4 = join(here, '../../../screenshots-tmp/v4');
  mkdirSync(V4, { recursive: true });
  const shot4 = async (name) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(V4, `${name}.png`) });
    console.log('    screenshot v4', name);
  };
  const createdPos = (tag) => page.evaluate((tag) => new Promise((res, rej) => {
    const r = indexedDB.open('timber-field');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const q = r.result.transaction('events').objectStore('events').getAll();
      q.onsuccess = () => {
        const evs = q.result.map((row) => row.event);
        const c = evs.find((e) => e.type === 'create' && e.payload.tag === tag);
        const ups = evs.filter((e) => c && e.treeId === c.treeId && e.type === 'update' && e.payload.position);
        res({ create: c?.payload.position, update: ups.at(-1)?.payload.position });
      };
    };
  }), tag);
  /** Pan a map with a real mouse drag, the way a finger would. */
  const dragMap = async (sel, dx, dy) => {
    const box = await page.locator(sel).boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 6 });
    await page.mouse.move(x + dx, y + dy, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  };
  await tid('tab-tally').click();
  assert(await tid('new-tree').isVisible(), 'New tree is the big idle button');
  await moveTo(120, 30);
  await startTree();
  await pinNow();
  await shot4('field-v4-01-pinned-zoomed');
  await tid('adjust-pin').click();
  await tid('adjust-panel').waitFor();
  await tid('pin-crosshair').waitFor();
  await shot4('field-v4-02-adjust-crosshair');
  await dragMap('[data-testid=tally-map] canvas', -90, 70);
  await page.waitForFunction(() => /moved/.test(document.querySelector('[data-testid=adjust-offset]')?.textContent ?? ''), null, { timeout: 5000 });
  log('Adjust offset:', (await tid('adjust-offset').textContent()).trim());
  await shot4('field-v4-03-adjust-moved');
  await tid('adjust-use').click();
  await tid('adjust-panel').waitFor({ state: 'detached' });
  assert(await page.locator('[data-testid=pinbar].moved').count(), 'pin bar shows the hand-placed pin');
  await shot4('field-v4-04-pinbar-moved');
  await fillTree({ sp: 'FD', circ: 70, height: 90, s: 4, t: 5, b: 5 });
  const movedTag = await tagIt();
  const mp = (await createdPos(movedTag)).create;
  assert(mp && mp.positionSource === 'adjusted' && typeof mp.gpsLat === 'number' && (mp.lat !== mp.gpsLat || mp.lon !== mp.gpsLon),
    'saved adjusted position with raw GPS: ' + JSON.stringify(mp));
  log(`${movedTag} saved adjusted: ${mp.lat.toFixed(6)},${mp.lon.toFixed(6)} (GPS ${mp.gpsLat.toFixed(6)},${mp.gpsLon.toFixed(6)})`);
  await shot4('field-v4-05-saved');

  // Info card -> Move pin on map -> Save spot writes an update event.
  const pt4 = await page.evaluate((tag) => {
    const m = window.__fieldMaps['tally-map'];
    const f = m.querySourceFeatures('trees').find((x) => x.properties.tag === tag);
    if (!f) return null;
    m.jumpTo({ center: f.geometry.coordinates });
    const p = m.project(f.geometry.coordinates);
    const r = m.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, movedTag);
  assert(pt4, 'moved tree dot on map');
  await page.waitForTimeout(400);
  await page.mouse.click(pt4.x, pt4.y);
  await tid('tree-card').waitFor({ timeout: 5000 });
  await tid('card-moved').waitFor();
  log('Card:', (await tid('card-moved').textContent()).trim());
  await shot4('field-v4-06-card-placed-by-hand');
  await tid('card-move-pin').click();
  await tid('move-tree').waitFor();
  await page.waitForTimeout(600);
  await shot4('field-v4-07-move-tree');
  await dragMap('[data-testid=move-map] canvas', 60, -50);
  await page.waitForFunction(() => /moved/.test(document.querySelector('[data-testid=move-offset]')?.textContent ?? ''), null, { timeout: 5000 });
  await shot4('field-v4-08-move-tree-dragged');
  await tid('move-save').click();
  await tid('move-tree').waitFor({ state: 'detached' });
  const up = (await createdPos(movedTag)).update;
  assert(up && up.positionSource === 'adjusted' && up.gpsLat === mp.gpsLat && (up.lat !== mp.lat || up.lon !== mp.lon),
    'update event moved the tree: ' + JSON.stringify(up));
  log('Moved again from the card, raw GPS kept');
  await shot4('field-v4-09-card-after-move');
  await page.locator('[data-testid=tree-card] .icon-btn[aria-label=Close]').click();

  // Tree editor has Move pin too.
  await tid('tab-trees').click();
  await tid('when-all').click();
  await tid(`row-${movedTag}`).click();
  await tid('tree-editor').waitFor();
  await tid('editor-moved').waitFor();
  await tid('editor-move-pin').waitFor();
  await shot4('field-v4-10-editor-move-pin');
  await tid('editor-move-pin').click();
  await tid('move-tree').waitFor();
  await tid('move-cancel').click();
  await tid('move-tree').waitFor({ state: 'detached' });
  await page.locator('[data-testid=tree-editor] .icon-btn[aria-label=Close]').click();
  await tid('tree-editor').waitFor({ state: 'detached' });
  await tid('tab-tally').click();
  await page.waitForTimeout(400);
  await shot4('field-v4-00-idle-new-tree');

  const relevant = errors.filter((e) => !/net::ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
  if (relevant.length) {
    console.log('CONSOLE ERRORS:\n' + relevant.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`\nPASS: full session, no console errors (${errors.length} expected network-blocked messages)`);
  }
} catch (err) {
  console.error('FAIL', err);
  console.error('console errors:', errors);
  await page.screenshot({ path: join(SHOTS, 'zz-failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
