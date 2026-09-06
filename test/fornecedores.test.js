// Headless UI test for fornecedores.html — who the household buys from:
// create/edit/delete, the wa.me WhatsApp compose link, the "Produtos"
// list (comprado items sourced from here, produtos.fornecedor_id — pure
// reference metadata, see maga-api's module comment above
// produtoCostFor), the "+ Novo Produto" hand-off to produtos.html, and the
// separate pantry purchase history read through `fornecedor_detail`
// (every inbound stock_movements row tagged with this fornecedor_id,
// joined to the insumo for its name — no separate table).
//
//   node test/fornecedores.test.js      # exits non-zero on any failure
//   KEEP_SHOTS=1 node test/...          # also prints where screenshots went
//
// Same shape as clientes.test.js: serves the repo root over http and
// answers maga-api from an in-memory fake, so it never touches
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
const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), 'fornecedores-test-'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
                '.css': 'text/css', '.png': 'image/png' };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(WEB_DIR, rel || 'fornecedores.html');
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

const state = { fornecedores: [], movements: [], insumos: {}, produtos: [], seq: 0 };
const uid = (p) => p + (++state.seq);
function fornecedorOf(id) { return state.fornecedores.find(f => f.id === id); }

(async () => {
  const failures = [];
  const server = await serve();
  const PAGE = 'http://127.0.0.1:' + server.address().port + '/fornecedores.html';
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 414, height: 900 } });

  const errors = [];
  ctx.on('weberror', e => errors.push('pageerror: ' + e.error().message));

  await ctx.route('**/functions/v1/maga-api', async route => {
    const body = route.request().postDataJSON();
    let resp;
    if (body.action === 'fornecedores') {
      resp = { fornecedores: state.fornecedores.slice() };
    } else if (body.action === 'fornecedor_create') {
      const f = {
        id: uid('F'), name: body.name,
        phone: body.phone ?? null, email: body.email ?? null, notes: body.notes ?? null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      state.fornecedores.push(f);
      resp = { ok: true, fornecedor: f };
    } else if (body.action === 'fornecedor_update') {
      const f = fornecedorOf(body.id);
      if (!f) { resp = { error: 'unknown fornecedor' }; }
      else {
        ['name', 'phone', 'email', 'notes'].forEach(k => { if (k in body) f[k] = body[k]; });
        f.updated_at = new Date().toISOString();
        resp = { ok: true, fornecedor: f };
      }
    } else if (body.action === 'fornecedor_delete') {
      const linkedMovements = state.movements.filter(m => m.fornecedor_id === body.id);
      const linkedProdutos = state.produtos.filter(p => p.fornecedor_id === body.id);
      if (!body.force && (linkedMovements.length > 0 || linkedProdutos.length > 0)) {
        resp = { ok: false, reason: 'has_history', id: body.id, name: fornecedorOf(body.id).name,
          movements: linkedMovements.length, produtos: linkedProdutos.length };
      } else {
        linkedMovements.forEach(m => { m.fornecedor_id = null; });
        linkedProdutos.forEach(p => { p.fornecedor_id = null; });
        state.fornecedores = state.fornecedores.filter(f => f.id !== body.id);
        resp = { ok: true, id: body.id,
          movements_unlinked: linkedMovements.length, produtos_unlinked: linkedProdutos.length };
      }
    } else if (body.action === 'fornecedor_detail') {
      const f = fornecedorOf(body.id);
      if (!f) { resp = { found: false, id: body.id }; }
      else {
        const produtos = state.produtos.filter(p => p.fornecedor_id === f.id);
        const purchases = state.movements
          .filter(m => m.fornecedor_id === f.id)
          .map(m => ({ ...m, insumo: state.insumos[m.gtin] }))
          .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
        resp = { found: true, fornecedor: f, produtos, purchases };
      }
    } else {
      resp = { error: 'bad action' };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resp) });
  });

  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const check = (label, cond) => { if (!cond) failures.push('FAIL: ' + label); };
  const norm = (s) => s.replace(/\u00A0/g, ' ');

  await ctx.addInitScript(() => { try { localStorage.setItem('checklist_pass', 'x'); } catch (_) {} });
  await page.goto(PAGE);
  await page.waitForSelector('#new-fornecedor', { timeout: 6000 });
  check('empty state shows the create button', (await page.$('#new-fornecedor')) !== null);
  check('empty state message shown', (await page.textContent('#root')).includes('Nenhum fornecedor ainda'));

  // --- create ---
  await page.click('#new-fornecedor');
  await page.waitForSelector('#forn-name-i', { timeout: 6000 });
  await page.fill('#forn-name-i', 'Padaria Ceci');
  await page.fill('#forn-phone', '11994452426');
  await page.fill('#forn-email', 'contato@ceci.example');
  await page.fill('#forn-notes', 'Entrega às terças');
  await page.click('#forn-ok');
  await page.waitForSelector('#forn-name', { timeout: 6000 });
  check('one fornecedor exists', state.fornecedores.length === 1);
  check('detail shows the name', (await page.textContent('#forn-name')).includes('Padaria Ceci'));
  check('detail shows the phone', (await page.textContent('#root')).includes('11994452426'));
  check('detail shows the email', (await page.textContent('#root')).includes('contato@ceci.example'));
  check('detail shows the notes', (await page.textContent('#root')).includes('Entrega às terças'));
  check('no purchases yet', (await page.textContent('#root')).includes('Nenhuma compra registrada ainda'));

  const fornId = state.fornecedores[0].id;

  // --- WhatsApp compose ---
  await page.waitForSelector('#wa-text', { timeout: 6000 });
  await page.fill('#wa-text', 'Oi, tem croissant amanhã?');
  const waHref = await page.getAttribute('#wa-send', 'href');
  check('wa.me href carries the 55-prefixed number, got: ' + waHref,
    waHref.startsWith('https://wa.me/5511994452426?text='));
  check('wa.me href carries the encoded message',
    decodeURIComponent(waHref.split('text=')[1]) === 'Oi, tem croissant amanhã?');

  // --- "+ Novo Produto" hands off to produtos.html with this fornecedor
  // preset, following the app's existing ?id= deep-link convention ---
  check('no produtos yet', (await page.textContent('#root')).includes('Nenhum produto cadastrado ainda'));
  await Promise.all([
    page.waitForURL(/produtos\.html\?new=1&fornecedor_id=/, { timeout: 6000 }),
    page.click('#new-produto'),
  ]);
  check('navigated to produtos.html with the fornecedor preset',
    page.url().includes('fornecedor_id=' + fornId));

  // --- the Produtos list shows comprado items sourced here (metadata
  // only — not tied to purchase history) and links into produtos.html ---
  state.produtos.push({ id: uid('P'), name: 'Croissant avulso', kind: 'comprado', cost: 2.5, fornecedor_id: fornId });
  await page.goto(PAGE + '?id=' + fornId);
  await page.waitForSelector('#forn-name', { timeout: 6000 });
  check('deep link opens the right fornecedor',
    (await page.textContent('#forn-name')).includes('Padaria Ceci'));
  const produtosText = norm(await page.textContent('#root'));
  check('the produto sourced from this fornecedor is listed, got: ' + produtosText,
    produtosText.includes('Croissant avulso') && produtosText.includes('R$ 2,50'));
  await Promise.all([
    page.waitForURL(/produtos\.html\?id=/, { timeout: 6000 }),
    page.click('.row[data-produto]'),
  ]);

  // --- purchase history via fornecedor_detail (a SEPARATE concern from
  // the Produtos list above — this is about pantry ingredient purchases) ---
  state.insumos['789001'] = { gtin: '789001', name: 'Croissant', brand: null, net_qty: 1, net_unit: 'un' };
  state.movements.push({
    id: uid('M'), gtin: '789001', delta: 50, unit_cost: 2.5, fornecedor_id: fornId,
    occurred_at: '2026-08-20T09:00:00Z', note: null, reason: 'purchase',
  });
  await page.goto(PAGE + '?id=' + fornId);
  await page.waitForSelector('#forn-name', { timeout: 6000 });
  const purchaseText = norm(await page.textContent('#root'));
  check('purchase row shows the quantity and item, got: ' + purchaseText,
    purchaseText.includes('50× Croissant'));
  check('purchase row shows the unit cost', purchaseText.includes('R$ 2,50/un'));

  // --- delete: a fornecedor with BOTH a produto and purchase history
  // refuses first (shown as a confirm dialog naming both counts), force
  // unlinks both on confirmation ---
  await page.click('#del-forn');
  await page.waitForSelector('#confirm-ok', { timeout: 6000 });
  const refusalText = await page.textContent('.modal-card');
  check('the refusal names the produto count, got: ' + refusalText, refusalText.includes('1 produto'));
  check('the refusal names the movement count', refusalText.includes('1 compra'));
  await page.click('#confirm-ok');
  await page.waitForSelector('#new-fornecedor', { timeout: 8000 });
  check('the fornecedor is gone from state', state.fornecedores.length === 0);
  check('the movement survives with fornecedor_id nulled',
    state.movements[0].fornecedor_id === null);
  check('the produto survives with fornecedor_id nulled',
    state.produtos[0].fornecedor_id === null);

  // --- accent-insensitive search (foldSearchText): an unaccented typed
  // term matches a fornecedor name stored WITH accents, and a genuinely
  // different term still doesn't match (no over-matching) ---
  await page.waitForSelector('#search', { timeout: 6000 });
  await page.click('#new-fornecedor');
  await page.waitForSelector('#forn-name-i', { timeout: 6000 });
  await page.fill('#forn-name-i', 'José Ramírez');
  await page.click('#forn-ok');
  await page.waitForSelector('#forn-name', { timeout: 6000 });
  check('the accented fornecedor was created',
    state.fornecedores.length === 1 && state.fornecedores[0].name === 'José Ramírez');
  await page.click('#back');
  await page.waitForSelector('#search', { timeout: 6000 });

  await page.fill('#search', 'jose ramirez');
  await page.waitForFunction(
    () => (document.getElementById('root').textContent || '').includes('José Ramírez'),
    null, { timeout: 6000 });
  check('unaccented search "jose ramirez" matches the accented fornecedor name "José Ramírez", got: ' +
    await page.textContent('#root'),
    (await page.textContent('#root')).includes('José Ramírez'));

  await page.fill('#search', 'zzzznotfound');
  await page.waitForFunction(() => document.getElementById('no-match') !== null, null, { timeout: 6000 });
  check('an unrelated search term does not match the accented fornecedor (no over-matching)',
    !(await page.textContent('#root')).includes('José Ramírez'));

  await page.screenshot({ path: path.join(SHOTS, 'fornecedor_detalhe.png'), fullPage: true });
  await browser.close();
  server.close();
  if (process.env.KEEP_SHOTS) console.log('screenshots: ' + SHOTS);

  console.log('--- JS errors ---');
  console.log(errors.length ? errors.join('\n') : '(none)');
  console.log('--- failures ---');
  console.log(failures.length ? failures.join('\n') : '(none)');
  process.exit(failures.length || errors.length ? 1 : 0);
})();
