// Headless UI test for shared-history.js — the router that makes the URL
// the source of truth for which screen is showing.
//
//   node test/history.test.js           # exits non-zero on any failure
//
// This guards the two bugs the router exists to fix, and it has to test
// BEHAVIOUR rather than markup: both are invisible to any assertion that
// reads the DOM alone.
//
//   - The Android hardware Back button used to leave the PWA from any
//     detail screen, because no page ever pushed a history entry. That is
//     page.goBack() here.
//   - A detail screen could not be bookmarked or returned to, because
//     every page replaceState'd its own ?id= away on load. That is the
//     "the URL still carries the id" assertions.
//
// clientes.html is the representative page (the pilot the pattern was
// built on). The fake is deliberately the smallest thing that lets the
// page render a list and a detail — the per-page behaviour is already
// covered by each page's own suite.
const http = require('http');
const fs = require('fs');
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
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
                '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(WEB_DIR, rel || 'clientes.html');
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

const CLIENTES = [
  { id: 'C1', name: 'Maria Silva', organization: 'Doces da Maria', phone: null, email: null },
  { id: 'C2', name: 'Clube Helvetia', organization: 'Associação', phone: null, email: null },
];

(async () => {
  const server = await serve();
  const BASE = 'http://127.0.0.1:' + server.address().port + '/';
  const failures = [];
  const errors = [];
  const check = (label, cond) => { if (!cond) failures.push('FAIL: ' + label); };

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });

  await ctx.route('**/functions/v1/maga-api', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    let resp;
    if (body.action === 'clientes') {
      resp = { clientes: CLIENTES };
    } else if (body.action === 'cliente_detail') {
      const c = CLIENTES.find(x => x.id === body.id);
      resp = c
        ? { found: true, cliente: c, eventos: [], pagamentos: [],
            total_price_all: 0, total_paid_all: 0, balance_due_all: 0 }
        : { found: false, id: body.id };
    } else if (body.action === 'notebook_detail') {
      resp = { found: true, notebook: { id: 'NB1' }, notes: [] };
    } else {
      resp = { error: 'bad action' };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resp) });
  });

  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await ctx.addInitScript(() => { try { localStorage.setItem('checklist_pass', 'x'); } catch (_) {} });

  const idInUrl = () => new URL(page.url()).searchParams.get('id');

  // --- list -> detail pushes a real history entry ---
  await page.goto(BASE + 'clientes.html');
  await page.waitForSelector('#new-cliente', { timeout: 6000 });
  check('the list screen carries no id in the URL', idInUrl() === null);

  await page.click('.row[data-id="C1"]');
  await page.waitForSelector('#detail-title', { timeout: 6000 });
  check('opening a row shows that record', (await page.textContent('#detail-title')).includes('Maria Silva'));
  check('opening a row writes the id into the URL — the deep link', idInUrl() === 'C1');

  // The whole point: hardware Back returns to the list instead of leaving
  // the app. Before shared-history.js there was no entry to go back to.
  await page.goBack();
  await page.waitForSelector('#new-cliente', { timeout: 6000 });
  check('Back from a detail returns to the list', idInUrl() === null);
  check('Back re-renders the list, not an empty screen',
    (await page.$$('.row[data-id]')).length === 2);

  await page.goForward();
  await page.waitForSelector('#detail-title', { timeout: 6000 });
  check('Forward returns to the detail', idInUrl() === 'C1');
  check('Forward renders the right record',
    (await page.textContent('#detail-title')).includes('Maria Silva'));

  // The back BUTTON in the subheader has to behave like hardware Back, or
  // the two disagree about where you are — which is how the pilot first
  // failed: the button re-rendered the list while the URL stayed on ?id=.
  await page.click('#back');
  await page.waitForSelector('#new-cliente', { timeout: 6000 });
  check('the ← back button also clears the id from the URL', idInUrl() === null);

  // --- a cold deep link ---
  await page.goto(BASE + 'clientes.html?id=C2');
  await page.waitForSelector('#detail-title', { timeout: 6000 });
  check('a cold ?id= link opens that record',
    (await page.textContent('#detail-title')).includes('Clube Helvetia'));
  check('a cold ?id= link KEEPS the id in the URL (it used to erase it)',
    idInUrl() === 'C2');

  // --- a stale id: one convention app-wide ---
  await page.goto(BASE + 'clientes.html?id=GONE');
  await page.waitForSelector('#new-cliente', { timeout: 6000 });
  check('an unknown id falls back to the list', (await page.$$('.row[data-id]')).length === 2);
  check('an unknown id is cleaned out of the URL so a reload cannot repeat it',
    idInUrl() === null);
  check('an unknown id says so rather than failing silently',
    (await page.textContent('#list-toast')).includes('não encontrado'));

  // --- keyboard reachability of the row itself ---
  // A row is a real <button>, so Tab reaches it and Enter opens it. This
  // is measured, not asserted from a class name: phase 1 shipped focus
  // rings onto elements that could not receive focus at all.
  await page.goto(BASE + 'clientes.html');
  await page.waitForSelector('#new-cliente', { timeout: 6000 });
  const reached = await page.evaluate(async () => {
    const row = document.querySelector('.row[data-id="C1"]');
    if (!row) return 'no row';
    if (row.tagName !== 'BUTTON') return 'row is a ' + row.tagName + ', not a button';
    row.focus();
    return document.activeElement === row ? 'ok' : 'not focusable';
  });
  check('a list row is a real button and can take focus: ' + reached, reached === 'ok');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#detail-title', { timeout: 6000 });
  check('Enter on a focused row opens it', idInUrl() === 'C1');

  await browser.close();
  server.close();

  console.log('--- JS errors ---');
  console.log(errors.length ? errors.join('\n') : '(none)');
  console.log('--- failures ---');
  console.log(failures.length ? failures.join('\n') : '(none)');
  process.exit(failures.length || errors.length ? 1 : 0);
})();
