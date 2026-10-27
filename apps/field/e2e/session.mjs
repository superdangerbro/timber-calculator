// End-to-end field session in headless Chromium at iPhone 17 Pro Max size.
// Speech is simulated with the typed-transcript box (?speech=text), TTS is
// recorded silently (?tts=silent) and shown on screen, GPS comes from
// Playwright's geolocation emulation near the CB12 block.
//
//   pnpm --filter @timber/field dev        # in one terminal
//   node apps/field/e2e/session.mjs        # in another (BASE_URL to override)
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
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
const phase = () => page.locator('.tally').getAttribute('data-phase');
const waitPhase = async (p) => page.waitForFunction((p) => document.querySelector('.tally')?.getAttribute('data-phase') === p, p, { timeout: 8000 });
const lastTag = async () => (await tid('tag-big').textContent())?.trim();
let walk = 0;
const moveTo = async (dNorthM, dEastM) => {
  walk++;
  const lat = START.latitude + dNorthM / 111320;
  const lon = START.longitude + dEastM / (111320 * Math.cos((START.latitude * Math.PI) / 180));
  await context.setGeolocation({ latitude: lat, longitude: lon, accuracy: 3 + (walk % 4) });
};

try {
  // ---------------------------------------------------------------- boot
  await page.goto(`${BASE}?speech=text&tts=silent&notch=1`);
  await tid('talk').waitFor();
  await page.waitForTimeout(1500);
  log('Tally home, empty');
  await shot('01-tally-empty');

  // ---------------------------------------------------------------- block boundary
  await tid('tab-maps').click();
  await tid('boundary-file').setInputFiles(join(here, 'fixtures/cb12.geojson'));
  await tid('block-CB12').waitFor();
  log('Imported CB12 boundary');
  await shot('02-maps-block-imported');
  await tid('tab-tally').click();
  await page.waitForTimeout(800);

  // ---------------------------------------------------------------- tree 1: casual sentence
  await moveTo(10, 5);
  await tid('talk').click();
  await waitPhase('listening');
  log('Talk pressed -> listening');
  await shot('03-listening');
  await say('big fir forty two about thirty metres straight four no twist clean');
  await waitPhase('readback');
  const spoken1 = await tid('spoken').textContent();
  assert(/Douglas-fir/i.test(spoken1), `readback mentions species: ${spoken1}`);
  log('Readback:', spoken1);
  await shot('04-readback-full-draft');
  await say('save');
  await waitPhase('saved');
  assert((await lastTag()) === 'J-0001', 'first tag J-0001');
  log('Saved J-0001');
  await shot('05-saved-tag-J-0001');

  // ---------------------------------------------------------------- tree 2: zero taps, straight after save
  await moveTo(28, -12);
  await say('cedar fifty five twenty eight metres straight three twist four branchy two some sweep');
  await waitPhase('readback');
  await say('save');
  await waitPhase('saved');
  assert((await lastTag()) === 'J-0002', 'second tag');
  log('Saved J-0002 (no taps)');

  // ---------------------------------------------------------------- tree 3: missing fields + correction
  await moveTo(40, 22);
  await tid('talk').click();
  await say('lodgepole thirty');
  await waitPhase('readback');
  const spoken3 = await tid('spoken').textContent();
  assert(/missing/i.test(spoken3), `readback lists missing: ${spoken3}`);
  log('Readback with missing:', spoken3);
  await shot('06-readback-missing');
  await say('twenty four metres straight five twist five branchy four');
  await say('no, thirty two');
  await page.waitForFunction(() => document.querySelector('[data-testid="field-dbhCm"]')?.textContent?.includes('32'));
  log('Correction applied: DBH 32');
  await shot('07-correction-dbh-32');
  await say('save');
  await waitPhase('saved');
  assert((await lastTag()) === 'J-0003', 'third tag');

  // ---------------------------------------------------------------- offline from here on
  await context.setOffline(true);
  log('Network OFF');

  // tree 4 then undo
  await moveTo(55, -30);
  await say('larch thirty eight twenty six metres straight four twist four branchy three');
  await say('save');
  await waitPhase('saved');
  assert((await lastTag()) === 'J-0004', 'fourth tag');
  await say('undo');
  await page.waitForFunction(() => /Voided J-0004/.test(document.querySelector('[data-testid="notice"]')?.textContent ?? ''));
  log('Undo voided J-0004');
  await shot('08-undo-voided');

  // tree 5: re-tally, number 4 is never reused
  await say('larch thirty eight twenty six metres straight four twist four branchy three');
  await say('save');
  await waitPhase('saved');
  assert((await lastTag()) === 'J-0005', 'J-0004 not reused');
  await say('repeat');
  assert(/zero zero zero five/i.test(await tid('spoken').textContent()), 'repeat speaks tag');
  log('Saved J-0005, repeat ok (offline)');
  await shot('09-offline-saved-J-0005');

  // leave tree
  await moveTo(70, 8);
  await say('leave tree big fir seventy two');
  await say('save');
  await waitPhase('saved');
  assert((await lastTag()) === 'J-L0001', 'leave series');
  log('Leave tree J-L0001');
  await shot('10-leave-tree');

  // ---------------------------------------------------------------- tree 6 via Bluetooth clicker + clinometer
  await moveTo(85, -18);
  await page.locator('body').click({ position: { x: 5, y: 500 } }).catch(() => {});
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press('Space'); // clicker: saved -> next tree
  await waitPhase('listening');
  await say('spruce thirty six straight four twist four branchy three');
  await say('measure height');
  await tid('measure').waitFor();
  log('Clinometer open');
  await shot('11-measure-base');
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
  await shot('12-measure-top');
  await tid('mark').click();
  const h = (await tid('height-result').textContent()).trim();
  log('Clinometer height', h);
  assert(/^2[67]\.\d m$/.test(h), `height from angles ${h}`); // 20*(tan52 - tan(-4)) = 27.0
  await shot('13-measure-result');
  await tid('mark').click(); // "Use"
  await tid('measure').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('[data-testid="field-heightM"]')?.textContent?.includes('clino'));
  await shot('14-height-filled');
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press('Enter'); // clicker in readback = save
  await waitPhase('saved');
  assert((await lastTag()) === 'J-0006', 'clicker save J-0006');
  log('Clicker saved J-0006');
  await shot('15-tally-after-six');

  // ---------------------------------------------------------------- tree list + edit
  await tid('tab-trees').click();
  await tid('tree-list').waitFor();
  log('Trees list');
  await shot('16-trees-list');
  await tid('row-J-0002').click();
  await tid('tree-editor').waitFor();
  await tid('field-dbhCm').click();
  await tid('input-dbhCm').fill('57');
  await tid('input-dbhCm').press('Enter');
  await shot('17-tree-editor');
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
  await shot('18-trees-filter-fd');
  await page.locator('.void-toggle input').uncheck();
  await page.locator('.fchip').first().click();
  await tid('prod-pole').click();
  await shot('19-trees-filter-poles');
  await tid('prod-all').click();

  // ---------------------------------------------------------------- audit
  await context.setGeolocation({ latitude: START.latitude + 30 / 111320, longitude: START.longitude, accuracy: 4 });
  await tid('tab-audit').click();
  await tid('audit-card').waitFor();
  await page.waitForTimeout(800);
  log('Audit, nearest first:', await tid('audit-tag').textContent());
  await shot('20-audit');
  const target = (await tid('audit-tag').textContent()).trim();
  await tid('audit-type').fill('cut stump forty');
  await tid('audit-type').press('Enter');
  await tid('audit-flash').waitFor();
  const flash = await tid('audit-flash').textContent();
  assert(flash.includes(target) && /cut/.test(flash) && /40/.test(flash), `audit status: ${flash}`);
  await tid('audit-next').click();
  await tid('status-damaged').click();
  log('Audit:', flash);
  await shot('21-audit-status');

  // ---------------------------------------------------------------- settings + export
  await tid('tab-settings').click();
  await tid('settings-screen').waitFor();
  await shot('22-settings');
  const [download] = await Promise.all([page.waitForEvent('download'), tid('export-csv').click()]);
  const csvPath = join(SHOTS, 'export.csv');
  await download.saveAs(csvPath);
  const csv = readFileSync(csvPath, 'utf8');
  assert(csv.includes('J-0001') && csv.includes('J-0006') && !csv.includes('J-0004'), 'CSV has live trees only');
  log(`CSV export ${csv.split('\n').length - 1} rows`);
  await page.locator('.page').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await shot('23-settings-export');

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
  await shot('24-maps-downloaded');
  serveTiles = false; // from now on tiles can only come from local storage

  // ---------------------------------------------------------------- reload: data persisted
  await page.reload();
  await tid('talk').waitFor();
  await page.waitForTimeout(2500);
  assert((await lastTag()) === 'J-0006', 'last tag shown after reload');
  await shot('25-tally-after-reload');
  await tid('tab-trees').click();
  await tid('when-all').click();
  const rows = await page.locator('.tree-row').count();
  assert(rows === 5, `5 live trees after reload, got ${rows}`); // J-0001,2,5,6 + J-L0001
  log(`Reload: ${rows} live trees persisted`);
  await shot('26-trees-after-reload');
  await tid('tab-settings').click();
  assert((await tid('next-tag').textContent()).trim() === 'J-0007', 'next tag survives reload');

  // ---------------------------------------------------------------- offline again, after reload: still tallies
  await context.setOffline(true);
  await tid('tab-tally').click();
  await moveTo(100, 30);
  await tid('talk').click();
  await say('douglas fir forty five thirty two metres straight five twist five branchy four');
  await say('save');
  await waitPhase('saved');
  assert((await lastTag()) === 'J-0007', 'offline after reload J-0007');
  log('Offline tally after reload -> J-0007');
  await shot('27-offline-after-reload');
  await context.setOffline(false);

  // simulated GPS toggle
  await tid('tab-settings').click();
  await tid('sim-gps').click();
  await page.waitForTimeout(1500);
  await tid('tab-tally').click();
  await page.waitForTimeout(1200);
  await shot('28-simulated-gps');
  await tid('tab-settings').click();
  await tid('sim-gps').click();

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
