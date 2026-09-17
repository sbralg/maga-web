// Headless UI test for financeiro.html — the cost/revenue ledger.
//
//   node test/financeiro.test.js         # exits non-zero on any failure
//   KEEP_SHOTS=1 node test/...           # also prints where screenshots went
//
// Independent fake from eventos.test.js's, seeded with one pre-linked
// auto-posted entry (as if a payment had already been confirmed on
// Eventos) so the "automático" tag and the 🔗 deep link back to the evento
// can be exercised without re-driving the whole Eventos flow here.
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
const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), 'financeiro-test-'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
                '.css': 'text/css', '.png': 'image/png' };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(WEB_DIR, rel || 'financeiro.html');
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

const NOW = new Date();
const isoDaysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

const state = {
  lancamentos: [
    { id: 'L1', tipo: 'receita', amount: 40, categoria: 'evento',
      description: 'Pagamento — Bolo de aniversário', occurred_at: isoDaysAgo(2),
      evento_id: 'V1', evento_pagamento_id: 'P1', stock_movement_id: null,
      source: 'evento_payment', note: null, created_at: isoDaysAgo(2), updated_at: isoDaysAgo(2) },
  ],
  seq: 1,
};
const uid = (p) => p + (++state.seq);

function totalsFor(rows) {
  let total_receitas = 0, total_despesas = 0;
  for (const r of rows) {
    if (r.tipo === 'receita') total_receitas += Number(r.amount);
    else total_despesas += Number(r.amount);
  }
  return { total_receitas, total_despesas, saldo: total_receitas - total_despesas };
}

(async () => {
  const failures = [];
  const server = await serve();
  const PAGE = 'http://127.0.0.1:' + server.address().port + '/financeiro.html';
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 414, height: 900 } });

  const errors = [];
  ctx.on('weberror', e => errors.push('pageerror: ' + e.error().message));

  await ctx.route('**/functions/v1/maga-api', async route => {
    const body = route.request().postDataJSON();
    let resp;
    if (body.action === 'financeiro_lancamentos') {
      let rows = state.lancamentos.slice();
      if (body.tipo) rows = rows.filter(r => r.tipo === body.tipo);
      if (body.categoria) rows = rows.filter(r => r.categoria === body.categoria);
      if (body.date_from) rows = rows.filter(r => r.occurred_at >= body.date_from);
      if (body.date_to) rows = rows.filter(r => r.occurred_at < body.date_to);
      rows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
      resp = { lancamentos: rows, ...totalsFor(rows) };
    } else if (body.action === 'financeiro_lancamento_create') {
      const l = {
        id: uid('L'), tipo: body.tipo, amount: body.amount,
        categoria: body.categoria || 'outros', description: body.description,
        occurred_at: body.occurred_at || new Date().toISOString(),
        evento_id: body.evento_id || null, evento_pagamento_id: null, stock_movement_id: null,
        source: 'manual', note: body.note || null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      state.lancamentos.push(l);
      resp = { ok: true, lancamento: l };
    } else if (body.action === 'financeiro_lancamento_update') {
      const l = state.lancamentos.find(x => x.id === body.id);
      ['tipo', 'amount', 'categoria', 'description', 'occurred_at', 'note'].forEach(k => {
        if (k in body) l[k] = body[k];
      });
      resp = { ok: true, lancamento: l };
    } else if (body.action === 'financeiro_lancamento_delete') {
      state.lancamentos = state.lancamentos.filter(x => x.id !== body.id);
      resp = { ok: true, id: body.id };
    } else {
      resp = { error: 'bad action' };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resp) });
  });

  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const check = (label, cond) => { if (!cond) failures.push('FAIL: ' + label); };
  // Intl's pt-BR currency formatter uses a NBSP between "R$" and the
  // number; normalize it so plain-space checks aren't fooled by an
  // invisible character mismatch.
  const norm = (s) => s.replace(/ /g, ' ');
  // Regression guard for the alert()->fieldError() conversion: a native
  // dialog anywhere in this run means a validation path still uses alert().
  let dialogFired = false;
  page.on('dialog', async (d) => { dialogFired = true; await d.dismiss(); });

  await ctx.addInitScript(() => { try { localStorage.setItem('checklist_pass', 'x'); } catch (_) {} });
  await page.goto(PAGE);
  await page.waitForSelector('.entry', { timeout: 6000 });

  // --- the seeded auto-posted entry renders its tag and deep link ---
  check('the seeded entry shows the "automático" tag',
    (await page.textContent('.entry')).includes('automático'));
  check('the seeded entry links back to its evento, got href: ' +
      await page.getAttribute('.entry a.link', 'href'),
    (await page.getAttribute('.entry a.link', 'href')) === 'eventos.html?id=V1');
  check('the stats tiles show the seeded totals, got: ' + norm(await page.textContent('.stats')),
    norm(await page.textContent('.stats')).includes('R$ 40,00'));

  // --- create a standalone despesa ---
  await page.click('#new-lanc');
  await page.waitForSelector('#lanc-desc', { timeout: 6000 });
  check('the type defaults to despesa',
    await page.locator('#lanc-tipo-chips .chip[data-tipo="despesa"]').evaluate(
      el => el.classList.contains('active')));

  // Regression: empty amount, empty description, and a cleared date are
  // all live fields — the fieldError() case, one at a time as each is fixed.
  await page.click('#lanc-ok');
  await page.waitForSelector('#field-error-lanc-amount', { timeout: 6000 });
  check('empty amount shows a field error under #lanc-amount',
    (await page.textContent('#field-error-lanc-amount')).includes('Informe um valor válido'));

  await page.fill('#lanc-amount', '2590');
  await page.click('#lanc-ok');
  await page.waitForSelector('#field-error-lanc-desc', { timeout: 6000 });
  check('empty description shows a field error under #lanc-desc',
    (await page.textContent('#field-error-lanc-desc')).includes('descrição não pode ficar vazia'));

  await page.fill('#lanc-categoria', 'ingredientes');
  await page.fill('#lanc-desc', 'Farinha e açúcar');
  await page.fill('#lanc-date', '');
  await page.click('#lanc-ok');
  await page.waitForSelector('#field-error-lanc-date', { timeout: 6000 });
  check('an emptied date shows a field error under #lanc-date',
    (await page.textContent('#field-error-lanc-date')).includes('Informe a data'));

  await page.fill('#lanc-date', new Date().toISOString().slice(0, 10));
  await page.click('#lanc-ok');
  await page.waitForFunction(() => document.querySelectorAll('.entry').length === 2, null, { timeout: 6000 });
  check('a standalone despesa was created', state.lancamentos.length === 2);
  check('totals recompute after creating a despesa, got: ' + norm(await page.textContent('.stats')),
    norm(await page.textContent('.stats')).includes('R$ 25,90') &&
    norm(await page.textContent('.stats')).includes('R$ 14,10'));

  // --- create a standalone receita ---
  await page.click('#new-lanc');
  await page.waitForSelector('#lanc-desc', { timeout: 6000 });
  await page.click('#lanc-tipo-chips .chip[data-tipo="receita"]');
  await page.fill('#lanc-amount', '10000');
  await page.fill('#lanc-categoria', 'outros');
  await page.fill('#lanc-desc', 'Evento avulsa no balcão');
  await page.click('#lanc-ok');
  await page.waitForFunction(() => document.querySelectorAll('.entry').length === 3, null, { timeout: 6000 });
  check('a standalone receita was created',
    state.lancamentos.some(l => l.description === 'Evento avulsa no balcão' && l.tipo === 'receita'));

  // --- edit an entry, confirm totals recompute ---
  const despesaId = state.lancamentos.find(l => l.description === 'Farinha e açúcar').id;
  await page.click(`.entry[data-id="${despesaId}"] [data-edit]`);
  await page.waitForSelector('#lanc-amount', { timeout: 6000 });
  check('editing prefills the existing amount', (await page.inputValue('#lanc-amount')) === '25,90');
  await page.fill('#lanc-amount', '3000');
  await page.click('#lanc-ok');
  await page.waitForFunction(
    () => (document.querySelector('.stats') || {}).textContent?.includes('30,00'), null, { timeout: 6000 });
  check('the edited despesa amount is saved',
    state.lancamentos.find(l => l.id === despesaId).amount === 30);

  // --- filter chips (client-side, over the already-fetched page) — run
  // while a despesa still exists, so switching back to "Todos" has one to
  // reappear ---
  await page.click('.chiprow .chip[data-tipo="receita"]');
  await page.waitForFunction(
    () => document.querySelectorAll('.entry.despesa').length === 0, null, { timeout: 6000 });
  check('the receitas filter hides every despesa row',
    (await page.$$('.entry.despesa')).length === 0);
  check('at least one receita row remains visible', (await page.$$('.entry.receita')).length > 0);
  await page.click('.chiprow .chip[data-tipo=""]');
  await page.waitForFunction(
    () => document.querySelectorAll('.entry.despesa').length > 0, null, { timeout: 6000 });

  // --- delete an entry, behind confirmModal ---
  const beforeDelete = (await page.$$('.entry')).length;
  await page.click(`.entry[data-id="${despesaId}"] [data-del]`);
  await page.waitForSelector('#confirm-ok', { timeout: 6000 });
  await page.click('#confirm-ok');
  await page.waitForFunction(
    (n) => document.querySelectorAll('.entry').length === n, beforeDelete - 1, { timeout: 6000 });
  check('the deleted entry is gone from state',
    state.lancamentos.find(l => l.id === despesaId) === undefined);

  // --- período filter re-fetches without erroring ---
  await page.selectOption('#periodo', 'this');
  await page.waitForSelector('.msg, .entry', { timeout: 6000 });
  check('changing período does not error', errors.length === 0);

  check('no native alert()/confirm()/prompt() dialog fired anywhere in this run', !dialogFired);

  await page.screenshot({ path: path.join(SHOTS, 'financeiro.png'), fullPage: true });
  await browser.close();
  server.close();
  if (process.env.KEEP_SHOTS) console.log('screenshots: ' + SHOTS);

  console.log('--- JS errors ---');
  console.log(errors.length ? errors.join('\n') : '(none)');
  console.log('--- failures ---');
  console.log(failures.length ? failures.join('\n') : '(none)');
  process.exit(failures.length || errors.length ? 1 : 0);
})();
