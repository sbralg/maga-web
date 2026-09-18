// Headless smoke test for index.html — the tile dashboard, and specifically
// phase 4 of the app audit: the five busier tiles (tarefas/compras/eventos/
// estoque/financeiro) each grow a small live stat line from a new
// `dashboard_summary` action, fetched AFTER the tile grid itself has
// already painted (loadStats() in index.html).
//
//   node test/index.test.js              # exits non-zero on any failure
//   KEEP_SHOTS=1 node test/...           # also prints where screenshots went
//
// Same shape as compras.test.js/hoje.test.js: serves the repo root over
// http and answers maga-api from an in-memory fake, so it never touches
// Supabase and never needs a real passphrase.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadPlaywright() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch (_) { /* try the next */ }
  }
  console.error('playwright not found — npm i -D playwright, or set NODE_PATH');
  process.exit(2);
}
const { chromium } = loadPlaywright();

const WEB_DIR = path.resolve(__dirname, '..');
const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), 'index-test-'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
                '.css': 'text/css', '.png': 'image/png' };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(WEB_DIR, rel || 'index.html');
      if (!file.startsWith(WEB_DIR)) { res.writeHead(403).end(); return; }
      fs.readFile(file, (err, body) => {
        if (err) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        res.end(body);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// A rich scenario — every block populated, two of the five deliberately
// carrying a "needs attention" (warn) state (tarefas' overdue count,
// estoque's out-of-stock count, financeiro's negative saldo) — so both the
// plain and warn render paths get exercised in one page load.
const SUMMARY_OK = {
  tarefas: { pending_count: 3, overdue_count: 1 }, tarefas_error: null,
  compras: { lists_count: 2, items_open: 5 }, compras_error: null,
  eventos: {
    active_count: 2,
    next: { name: 'Aniversário da Ana', event_date: '2026-09-25', cliente_name: 'Ana' },
  }, eventos_error: null,
  estoque: { insumos_count: 10, out_of_stock_count: 2 }, estoque_error: null,
  financeiro: { month_receitas: 100, month_despesas: 150, month_saldo: -50 }, financeiro_error: null,
};

(async () => {
  const failures = [];
  const server = await serve();
  const PAGE = 'http://127.0.0.1:' + server.address().port + '/index.html';
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });

  const errors = [];
  ctx.on('weberror', e => errors.push('pageerror: ' + e.error().message));

  await ctx.addInitScript(() => {
    try { localStorage.setItem('checklist_pass', 'x'); } catch (_) {}
  });

  // Toggled between the two page loads below — 'ok' answers dashboard_summary
  // with SUMMARY_OK, 'undeployed' answers every unknown action the way a
  // real maga-api that predates this phase would: 400 {"error":"bad action"}.
  let mode = 'ok';
  const page = await ctx.newPage();
  // The 'undeployed' scenario below deliberately makes dashboard_summary
  // 400 — Chromium logs that as its own console error (a failed resource
  // load), which is the expected shape of that scenario, not a bug.
  page.on('console', m => {
    if (m.type() === 'error' && !/400 \(Bad Request\)/.test(m.text())) {
      errors.push('console: ' + m.text());
    }
  });

  // A manually-released gate, not a fixed delay: this sandbox's
  // Playwright<->Chromium round trips have unpredictable latency (see
  // feedback_sandbox_playwright_raf), so a `setTimeout` race would be
  // flaky in either direction. Holding the mocked response open until the
  // test explicitly releases it gives a deterministic window to assert
  // the pre-fetch ("still hidden") state before letting it resolve.
  let releaseSummary = () => {};
  let summaryGate = new Promise(r => { releaseSummary = r; });

  await page.route('**/functions/v1/maga-api', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'dashboard_summary' && mode === 'ok') {
      await summaryGate;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SUMMARY_OK) });
      return;
    }
    // Covers both the explicit 'undeployed' mode and any other action this
    // page might ever call by mistake — real maga-api 400s an unknown
    // action, never 200s it.
    await route.fulfill({ status: 400, contentType: 'application/json',
      body: JSON.stringify({ error: 'bad action' }) });
  });

  const check = (label, cond) => { if (!cond) failures.push('FAIL: ' + label); };

  // --- rich scenario: tiles paint immediately, stats patch in after ---
  await page.goto(PAGE);
  await page.waitForSelector('.tile', { timeout: 6000 });
  check('every menu destination except home renders as a tile',
    (await page.$$('.tile')).length ===
      (await page.evaluate(() => MENU_ITEMS.filter(i => i.page !== 'home').length)));
  check('a stat placeholder exists but starts hidden (summary fetch still pending), got: ' +
      (await page.getAttribute('.tile[data-page="tarefas"] .tile-stat', 'hidden')),
    (await page.getAttribute('.tile[data-page="tarefas"] .tile-stat', 'hidden')) !== null);
  check('a non-stat tile (insumos, a reference catalogue) has no stat placeholder at all',
    (await page.$('.tile[data-page="insumos"] .tile-stat')) === null);

  releaseSummary();
  await page.waitForFunction(
    () => !(document.querySelector('.tile[data-page="tarefas"] .tile-stat') || {}).hidden,
    null, { timeout: 6000 });

  check('tarefas shows the pending + overdue counts, got: ' +
      await page.textContent('.tile[data-page="tarefas"] .tile-stat'),
    (await page.textContent('.tile[data-page="tarefas"] .tile-stat')) === '3 pendentes · 1 atrasada');
  check('tarefas carries the warn class (it has an overdue item)',
    (await page.locator('.tile[data-page="tarefas"] .tile-stat').getAttribute('class')).includes('warn'));

  check('compras shows the open-item count, got: ' +
      await page.textContent('.tile[data-page="compras"] .tile-stat'),
    (await page.textContent('.tile[data-page="compras"] .tile-stat')) === '5 itens para comprar');
  check('compras does NOT carry the warn class (a shopping list isn\'t an alarm)',
    !(await page.locator('.tile[data-page="compras"] .tile-stat').getAttribute('class')).includes('warn'));

  check('eventos shows the active count and the next event date, got: ' +
      await page.textContent('.tile[data-page="eventos"] .tile-stat'),
    (await page.textContent('.tile[data-page="eventos"] .tile-stat')) === '2 em andamento · próximo 25/09');

  check('estoque shows the out-of-stock count, got: ' +
      await page.textContent('.tile[data-page="estoque"] .tile-stat'),
    (await page.textContent('.tile[data-page="estoque"] .tile-stat')) === '2 itens em falta');
  check('estoque carries the warn class (something is out of stock)',
    (await page.locator('.tile[data-page="estoque"] .tile-stat').getAttribute('class')).includes('warn'));

  const finText = await page.textContent('.tile[data-page="financeiro"] .tile-stat');
  check('financeiro shows the month saldo, got: ' + finText,
    finText.includes('Saldo do mês') && finText.includes('50,00'));
  check('financeiro carries the warn class (the saldo is negative)',
    (await page.locator('.tile[data-page="financeiro"] .tile-stat').getAttribute('class')).includes('warn'));

  await page.screenshot({ path: path.join(SHOTS, 'index-ok.png'), fullPage: true });

  // --- degraded scenario: an `maga-api` that predates this action ---
  // (a real 400 "bad action", not a network failure) must NOT break the
  // page — every tile keeps working as plain navigation, no error screen,
  // no stray dialog, no console error.
  mode = 'undeployed';
  let dialogFired = false;
  page.once('dialog', async d => { dialogFired = true; await d.dismiss(); });
  await page.reload();
  await page.waitForSelector('.tile', { timeout: 6000 });
  await page.waitForTimeout(400); // let the failed loadStats() fetch settle
  check('tiles still render fully when dashboard_summary 400s',
    (await page.$$('.tile')).length ===
      (await page.evaluate(() => MENU_ITEMS.filter(i => i.page !== 'home').length)));
  check('no stat line renders when the summary call fails, got: ' +
      await page.textContent('.tile[data-page="tarefas"] .tile-stat'),
    (await page.textContent('.tile[data-page="tarefas"] .tile-stat')) === '');
  check('the tarefas tile is still a real, working link to tarefas.html',
    (await page.getAttribute('.tile[data-page="tarefas"]', 'href')) === 'tarefas.html');
  check('no native dialog fired for the failed background fetch', !dialogFired);
  check('the page body has no error/retry screen (loadStats never touches #root wholesale)',
    !(await page.textContent('#root')).includes('Não foi possível carregar agora'));

  await page.screenshot({ path: path.join(SHOTS, 'index-degraded.png'), fullPage: true });

  await browser.close();
  server.close();
  if (process.env.KEEP_SHOTS) console.log('screenshots: ' + SHOTS);

  console.log('--- JS errors ---');
  console.log(errors.length ? errors.join('\n') : '(none)');
  console.log('--- failures ---');
  console.log(failures.length ? failures.join('\n') : '(none)');
  process.exit(failures.length || errors.length ? 1 : 0);
})();
