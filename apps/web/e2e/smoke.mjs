// End-to-end smoke test of the office dashboard. Re-seed first for a clean run:
//   pnpm --filter @timber/web db:seed && pnpm --filter @timber/web start &
//   node apps/web/e2e/smoke.mjs
// Env: BASE_URL (default http://localhost:3000), SHOT_DIR (default <repo>/screenshots-tmp/web)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOT_DIR ?? path.resolve(here, '../../../screenshots-tmp/web');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const errors = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
const num = (s) => Number(String(s).replace(/[^0-9.-]/g, ''));

function watch(page, label) {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource/.test(t)) return; // basemap tiles are unreachable offline (reported via requestfailed)
    errors.push(`[${label}] console: ${t}`);
  });
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (/arcgisonline|mapbox\.com/.test(u)) return;
    if (r.failure()?.errorText === 'net::ERR_ABORTED') return;
    errors.push(`[${label}] request failed: ${u} ${r.failure()?.errorText}`);
  });
}

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.fill('#email', 'joe@example.com');
  await page.fill('#password', 'timber123');
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')]);
  await page.waitForSelector('[data-testid=map][data-ready="1"]', { timeout: 30000 });
  await page.waitForFunction(() => Number(document.querySelector('[data-testid=row-count]')?.textContent) > 0, null, { timeout: 30000 });
  await page.waitForTimeout(1200); // fit-bounds animation
}

const rowCount = (page) => page.$eval('[data-testid=row-count]', (e) => Number(e.textContent));
const mapCount = (page) => page.$eval('[data-testid=map]', (e) => Number(e.getAttribute('data-tree-count')));
const totalTrees = (page) => page.$eval('[data-testid=total-trees]', (e) => parseInt(e.textContent, 10));
const totalValue = (page) => page.$eval('[data-testid=total-value]', (e) => e.textContent);

async function desktop(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'desktop');

  await page.goto(`${BASE}/`);
  check('unauthenticated dashboard redirects to login', page.url().startsWith(`${BASE}/login`));
  await page.screenshot({ path: `${SHOTS}/01-login-1440.png` });
  await login(page);

  const rows0 = await rowCount(page); const dots0 = await mapCount(page);
  check('dashboard loads ~120 trees', rows0 >= 100 && dots0 >= 100, `table ${rows0}, map dots ${dots0}`);
  const rendered = await page.evaluate(() => window.__timberMap.queryRenderedFeatures({ layers: ['trees'] }).length);
  check('map renders tree dots', rendered >= 100, `${rendered} rendered features`);
  await page.screenshot({ path: `${SHOTS}/02-dashboard-1440.png` });

  // Filters drive map + table together.
  await page.click('[data-testid=species-FD]');
  await page.waitForTimeout(300);
  const rowsFd = await rowCount(page); const dotsFd = await mapCount(page); const totFd = await totalTrees(page);
  check('species filter narrows table and map', rowsFd < rows0 && dotsFd === rowsFd && totFd === rowsFd, `FD: table ${rowsFd}, map ${dotsFd}, totals ${totFd}`);
  await page.selectOption('[data-testid=product-filter]', 'pole');
  await page.waitForTimeout(300);
  const rowsPole = await rowCount(page);
  check('product filter (FD poles)', rowsPole > 0 && rowsPole < rowsFd, `${rowsPole} FD poles`);
  await page.fill('[data-testid=dbh-min]', '45');
  await page.waitForTimeout(300);
  check('DBH range filter', (await rowCount(page)) <= rowsPole, `${await rowCount(page)} with DBH ≥ 45`);
  await page.screenshot({ path: `${SHOTS}/03-filtered-1440.png` });
  await page.click('[data-testid=reset-filters]');
  await page.waitForTimeout(300);
  check('reset filters restores all rows', (await rowCount(page)) === rows0);

  // Colour by.
  await page.selectOption('[data-testid=color-by]', 'product');
  await page.waitForTimeout(400);
  const legend = await page.textContent('[data-testid=legend]');
  check('colour-by product updates legend', /Pole/.test(legend) && /Sawlog/.test(legend));
  await page.screenshot({ path: `${SHOTS}/04-colour-by-product-1440.png` });

  // Click a dot -> popup + row selection.
  const pt = await page.evaluate(() => {
    const m = window.__timberMap; const f = m.queryRenderedFeatures({ layers: ['trees'] })[5];
    const p = m.project(f.geometry.coordinates); const r = m.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForSelector('.maplibregl-popup .pop-tag', { timeout: 5000 }).catch(() => {});
  const popupTag = await page.textContent('.maplibregl-popup .pop-tag').catch(() => null);
  const selRow = await page.$eval('tr.sel .tag', (e) => e.textContent).catch(() => null);
  check('map click opens popup and selects table row', !!popupTag && popupTag === selRow, `popup ${popupTag}, row ${selRow}`);
  await page.screenshot({ path: `${SHOTS}/05-popup-1440.png` });
  await page.keyboard.press('Escape');

  // Draw a polygon over part of the block.
  const allTotal = await totalTrees(page);
  await page.click('[data-testid=draw-btn]');
  const box = await page.$eval('[data-testid=map]', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const P = (fx, fy) => [box.x + box.w * fx, box.y + box.h * fy];
  for (const [fx, fy] of [[0.36, 0.25], [0.62, 0.22], [0.66, 0.7], [0.4, 0.78]]) { const [x, y] = P(fx, fy); await page.mouse.click(x, y); await page.waitForTimeout(120); }
  await page.screenshot({ path: `${SHOTS}/06-drawing-1440.png` });
  await page.click('[data-testid=finish-draw]');
  await page.waitForTimeout(500);
  const drawnTotal = await totalTrees(page);
  const totalsText = await page.textContent('[data-testid=totals]');
  check('drawn polygon gives area totals', drawnTotal > 0 && drawnTotal < allTotal && /Drawn area/.test(totalsText) && / ha/.test(totalsText), `${drawnTotal} of ${allTotal} trees`);
  check('table follows the area', (await rowCount(page)) === drawnTotal);
  await page.screenshot({ path: `${SHOTS}/07-drawn-area-1440.png` });

  // Save drawn area as a block.
  await page.click('[data-testid=save-block]');
  await page.fill('[data-testid=prompt-name]', 'Smoke test unit');
  await page.fill('[data-testid=prompt-code]', 'ST1');
  await page.click('[data-testid=prompt-confirm]');
  await page.waitForTimeout(800);
  const areaOpt = await page.$eval('[data-testid=area-select]', (s) => s.selectedOptions[0]?.textContent);
  check('save drawn area as block', /Smoke test unit/.test(areaOpt ?? ''), areaOpt);

  // Inline edit -> update event, value changes, history shows it.
  await page.selectOption('[data-testid=color-by]', 'value');
  const row = page.locator('[data-testid=tree-row]').filter({ has: page.locator('.badge.sawlog') }).first();
  const tag = await row.locator('.tag').textContent();
  const valueBefore = await row.locator('b.money').textContent();
  const dbhBefore = num(await row.locator('button[aria-label^="Edit DBH"]').textContent());
  await row.locator('button[aria-label^="Edit DBH"]').click();
  await page.fill('[data-testid=cell-input]', String(dbhBefore + 12));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.toast.ok', { timeout: 8000 });
  const edited = page.locator(`[data-testid=tree-row]:has(.tag:text-is("${tag}"))`);
  const valueAfter = await edited.locator('b.money').textContent();
  const dbhAfter = num(await edited.locator('button[aria-label^="Edit DBH"]').textContent());
  check('inline DBH edit saves and recalculates value', dbhAfter === dbhBefore + 12 && valueAfter !== valueBefore, `${tag}: DBH ${dbhBefore}→${dbhAfter}, value ${valueBefore}→${valueAfter}`);
  await edited.locator('button[aria-label^="Edit Status"]').click();
  await edited.locator('[data-testid=cell-input]').selectOption('damaged');
  await page.waitForTimeout(800);
  check('status edit', /damaged/.test(await edited.locator('.status').textContent()));
  await edited.locator('button:has-text("History")').click();
  await page.waitForSelector('[data-testid=chain-verified], [data-testid=chain-broken]', { timeout: 8000 });
  const hist = await page.textContent('[data-testid=history-list]');
  check('history shows update + status events with verified chain', (await page.$('[data-testid=chain-verified]')) !== null && /dbhCm → /.test(hist) && /Status → damaged/.test(hist));
  await page.screenshot({ path: `${SHOTS}/08-history-1440.png` });
  await page.keyboard.press('Escape');

  // Void a tree.
  const vrow = page.locator('[data-testid=tree-row]').nth(3);
  const vtag = await vrow.locator('.tag').textContent();
  const before = await rowCount(page);
  await vrow.locator('button:has-text("Void")').click();
  await page.fill('#void-reason', 'smoke test duplicate');
  await page.click('[data-testid=confirm-void]');
  await page.waitForTimeout(1000);
  check('void removes tree from live table', (await rowCount(page)) === before - 1, `${vtag} voided`);

  // Pricing what-if.
  const tvBefore = await totalValue(page);
  await page.fill('[data-testid="pole-piece-Class 1"]', '900');
  await page.fill('[data-testid=saw-FD]', '150');
  await page.waitForTimeout(300);
  const tvAfter = await totalValue(page);
  check('price change recalculates totals instantly', tvAfter !== tvBefore && (await page.$('[data-testid=dirty-note]')) !== null, `${tvBefore} → ${tvAfter}`);
  await page.click('[data-testid=save-as]');
  await page.fill('[data-testid=prompt-name]', 'Smoke: high pole prices');
  await page.click('[data-testid=prompt-confirm]');
  await page.waitForSelector('.toast.ok:has-text("Saved scenario")', { timeout: 8000 });
  const scen = await page.$eval('[data-testid=scenario-select]', (s) => s.selectedOptions[0]?.textContent);
  check('save scenario', scen === 'Smoke: high pole prices', scen);
  const firstScenario = await page.$eval('[data-testid=compare-select]', (s) => s.options[1].value);
  await page.selectOption('[data-testid=compare-select]', firstScenario);
  await page.waitForSelector('[data-testid=compare-table]');
  check('compare scenarios shows deltas', /\+\$/.test(await page.textContent('[data-testid=compare-table]')));
  await page.screenshot({ path: `${SHOTS}/09-pricing-compare-1440.png` });

  // Exports (of all rows shown, so clear the selection first).
  const clearSel = page.locator('.tt-left button:has-text("Clear")');
  if (await clearSel.count()) await clearSel.click();
  for (const fmt of ['csv', 'geojson', 'kml']) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`[data-testid=export-${fmt}]`)]);
    const file = path.join(SHOTS, `export.${fmt}`);
    await dl.saveAs(file);
    const text = fs.readFileSync(file, 'utf8');
    const ok = fmt === 'csv' ? text.split('\n').length > 2 : fmt === 'geojson' ? JSON.parse(text).features.length > 0 : /<kml/.test(text) && /<Placemark/.test(text);
    check(`export ${fmt.toUpperCase()}`, ok, `${dl.suggestedFilename()} (${text.length} bytes)`);
  }

  // Report.
  const [rep] = await Promise.all([ctx.waitForEvent('page'), page.click('[data-testid=open-report]')]);
  watch(rep, 'report');
  await rep.waitForSelector('[data-testid=report]', { timeout: 20000 });
  const repTrees = num(await rep.textContent('[data-testid=report-trees]'));
  check('report page summarises the area', repTrees === (await totalTrees(page)), `${repTrees} trees`);
  await rep.screenshot({ path: `${SHOTS}/10-report-1440.png`, fullPage: true });
  await rep.emulateMedia({ media: 'print' });
  await rep.screenshot({ path: `${SHOTS}/11-report-print-1440.png` });
  await rep.close();

  // Back to block view + settings.
  await page.selectOption('[data-testid=area-select]', { index: 1 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/12-dashboard-final-1440.png` });
  await page.goto(`${BASE}/settings`);
  await page.waitForSelector('[data-testid=devices]');
  check('settings shows devices', ((await page.textContent('[data-testid=devices]')).match(/iPhone/g) ?? []).length >= 2);
  await page.screenshot({ path: `${SHOTS}/13-settings-1440.png`, fullPage: true });
  await ctx.close();
}

async function tablet(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 1, hasTouch: false });
  const page = await ctx.newPage();
  watch(page, 'ipad');
  await login(page);
  check('iPad: dashboard loads', (await rowCount(page)) >= 100);
  await page.screenshot({ path: `${SHOTS}/20-dashboard-1024.png` });
  await page.click('[data-testid=open-pricing]');
  await page.waitForSelector('[data-testid=pricing-panel]');
  await page.screenshot({ path: `${SHOTS}/21-pricing-1024.png` });
  await page.goto(`${BASE}/settings`);
  await page.screenshot({ path: `${SHOTS}/22-settings-1024.png`, fullPage: true });
  await page.goto(`${BASE}/report`);
  await page.waitForSelector('[data-testid=report]');
  await page.screenshot({ path: `${SHOTS}/23-report-1024.png`, fullPage: true });
  await page.goto(`${BASE}/signup`).catch(() => {});
  await ctx.close();
}

const browser = await chromium.launch();
try {
  await desktop(browser);
  await tablet(browser);
} catch (e) {
  check('smoke run completed', false, e.stack);
} finally {
  await browser.close();
}
check('no console / page errors', errors.length === 0, errors.slice(0, 8).join('\n'));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
