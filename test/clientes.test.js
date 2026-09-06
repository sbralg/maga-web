// Headless UI test for clientes.html — the contact record behind an evento:
// full-field create/edit/delete, the eventos + pagamentos rollup read
// through `cliente_detail`, and the wa.me WhatsApp compose link.
//
//   node test/clientes.test.js          # exits non-zero on any failure
//   KEEP_SHOTS=1 node test/...          # also prints where screenshots went
//
// Same shape as eventos.test.js/financeiro.test.js: serves the repo root
// over http and answers maga-api from an in-memory fake, so it never
// touches Supabase and never needs a real passphrase. The fake keeps
// relational state (clientes/eventos/pagamentos) but, unlike eventos.test.js,
// stores each evento's totals directly rather than deriving them from line
// items — this page only ever DISPLAYS those numbers (they come from
// cliente_detail already computed), so re-deriving them here would just be
// testing the fake against itself.
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
const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), 'clientes-test-'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
                '.css': 'text/css', '.png': 'image/png' };

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

const state = { clientes: [], eventos: [], pagamentos: [], seq: 0 };
const uid = (p) => p + (++state.seq);

function clienteOf(id) { return state.clientes.find(c => c.id === id); }

(async () => {
  const failures = [];
  const server = await serve();
  const PAGE = 'http://127.0.0.1:' + server.address().port + '/clientes.html';
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 414, height: 900 } });

  const errors = [];
  ctx.on('weberror', e => errors.push('pageerror: ' + e.error().message));

  await ctx.route('**/functions/v1/maga-api', async route => {
    const body = route.request().postDataJSON();
    let resp;
    if (body.action === 'clientes') {
      resp = { clientes: state.clientes.slice() };
    } else if (body.action === 'cliente_create') {
      const c = {
        id: uid('C'), name: body.name,
        organization: body.organization ?? null, phone: body.phone ?? null,
        email: body.email ?? null, notes: body.notes ?? null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      state.clientes.push(c);
      resp = { ok: true, cliente: c };
    } else if (body.action === 'cliente_update') {
      const c = clienteOf(body.id);
      if (!c) { resp = { error: 'unknown cliente' }; }
      else {
        ['name', 'organization', 'phone', 'email', 'notes'].forEach(k => {
          if (k in body) c[k] = body[k];
        });
        c.updated_at = new Date().toISOString();
        resp = { ok: true, cliente: c };
      }
    } else if (body.action === 'cliente_delete') {
      const linked = state.eventos.filter(v => v.cliente_id === body.id);
      linked.forEach(v => { v.cliente_id = null; });
      state.clientes = state.clientes.filter(c => c.id !== body.id);
      resp = { ok: true, eventos_unlinked: linked.length };
    } else if (body.action === 'cliente_detail') {
      const c = clienteOf(body.id);
      if (!c) { resp = { found: false, id: body.id }; }
      else {
        const eventos = state.eventos.filter(v => v.cliente_id === c.id);
        const eventoIds = eventos.map(v => v.id);
        const pagamentos = state.pagamentos
          .filter(p => eventoIds.includes(p.evento_id))
          .map(p => ({ ...p, evento: { name: state.eventos.find(v => v.id === p.evento_id).name } }))
          .sort((a, b) => b.received_at.localeCompare(a.received_at));
        const total_price_all = eventos.reduce((s, v) => s + v.total_price, 0);
        const total_paid_all = eventos.reduce((s, v) => s + v.total_paid, 0);
        resp = {
          found: true, cliente: c, eventos, pagamentos,
          total_price_all, total_paid_all,
          balance_due_all: total_price_all - total_paid_all,
        };
      }
    } else {
      resp = { error: 'bad action' };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resp) });
  });

  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const check = (label, cond) => { if (!cond) failures.push('FAIL: ' + label); };
  const norm = (s) => s.replace(/ /g, ' ');

  await ctx.addInitScript(() => { try { localStorage.setItem('checklist_pass', 'x'); } catch (_) {} });
  await page.goto(PAGE);
  await page.waitForSelector('#new-cliente', { timeout: 6000 });
  check('empty state shows the create button', (await page.$('#new-cliente')) !== null);
  check('empty state message shown', (await page.textContent('#root')).includes('Nenhum cliente ainda'));

  // --- create a full-field cliente ---
  await page.click('#new-cliente');
  await page.waitForSelector('#cli-name', { timeout: 6000 });
  await page.fill('#cli-name', 'Maria Silva');
  await page.fill('#cli-org', 'Doces da Maria');
  await page.fill('#cli-phone', '11994452426');
  await page.fill('#cli-email', 'maria@example.com');
  await page.fill('#cli-notes', 'Prefere contato à tarde');
  await page.click('#cli-ok');
  await page.waitForSelector('#cliente-name', { timeout: 6000 });
  check('one cliente exists', state.clientes.length === 1);
  check('detail shows the name', (await page.textContent('#cliente-name')).includes('Maria Silva'));
  check('detail shows the organization', (await page.textContent('#root')).includes('Doces da Maria'));
  check('detail shows the phone', (await page.textContent('#root')).includes('11994452426'));
  check('detail shows the email', (await page.textContent('#root')).includes('maria@example.com'));
  check('detail shows the notes', (await page.textContent('#root')).includes('Prefere contato à tarde'));
  check('no eventos yet', (await page.textContent('#root')).includes('Nenhum evento ainda'));
  check('no pagamentos yet', (await page.textContent('#root')).includes('Nenhum pagamento registrado ainda'));
  check('no totals card without eventos', (await page.$('.totals-card')) === null);

  const clienteId = state.clientes[0].id;

  // --- WhatsApp compose: a Brazilian 11-digit local number gets 55 prepended ---
  await page.waitForSelector('#wa-text', { timeout: 6000 });
  // With no message typed the link is NOT disabled — it opens the contact
  // directly (the user's own call, commit d2df750); typing a message
  // switches it to the send-with-text form.
  check('with no message the link opens the contact directly',
    (await page.getAttribute('#wa-send', 'href') || '') === 'https://wa.me/5511994452426');
  check('and says so', (await page.textContent('#wa-send')).includes('Abrir contato'));
  await page.fill('#wa-text', 'Olá Maria, seu bolo está pronto!');
  await page.waitForFunction(() =>
    /\?text=/.test(document.getElementById('wa-send').getAttribute('href') || ''));
  check('typing a message switches the label to sending',
    (await page.textContent('#wa-send')).includes('Enviar'));
  const waHref = await page.getAttribute('#wa-send', 'href');
  check('wa.me href carries the 55-prefixed number, got: ' + waHref,
    waHref.startsWith('https://wa.me/5511994452426?text='));
  check('wa.me href carries the encoded message',
    decodeURIComponent(waHref.split('text=')[1]) === 'Olá Maria, seu bolo está pronto!');

  // --- edit: clearing the phone removes the compose box, shows the hint ---
  await page.click('#edit-cliente');
  await page.waitForSelector('#cli-phone', { timeout: 6000 });
  check('edit modal prefills the existing name', (await page.inputValue('#cli-name')) === 'Maria Silva');
  await page.fill('#cli-phone', '');
  await page.click('#cli-ok');
  // #cliente-name survives this transition (it's re-created, not removed),
  // so waiting on IT is not a reliable signal that the re-render finished —
  // wait on the .wa-hint element itself, which only exists once a phone-less
  // cliente has actually rendered.
  await page.waitForSelector('.wa-hint', { timeout: 6000 });
  check('no phone means no WhatsApp compose box', (await page.$('#wa-text')) === null);
  check('a hint explains why', (await page.textContent('#root')).includes('Adicione um telefone'));

  // Put the phone back (already-prefixed number should NOT be double-prefixed).
  await page.click('#edit-cliente');
  await page.waitForSelector('#cli-phone', { timeout: 6000 });
  await page.fill('#cli-phone', '+55 11 99445-2426');
  await page.click('#cli-ok');
  await page.waitForSelector('#wa-text', { timeout: 6000 });
  await page.fill('#wa-text', 'oi');
  await page.waitForFunction(() => !document.getElementById('wa-send').classList.contains('disabled'));
  const waHref2 = await page.getAttribute('#wa-send', 'href');
  check('an already-prefixed number is not double-prefixed, got: ' + waHref2,
    waHref2.startsWith('https://wa.me/5511994452426?text='));

  // --- eventos + pagamentos rollup, and totals ---
  const eventoA = {
    id: uid('V'), cliente_id: clienteId, name: 'Bolo de aniversário', status: 'entregue',
    event_date: '2026-09-01', total_cost: 40, total_price: 100, total_paid: 100, balance_due: 0,
    profit: 60, margin_pct: 60,
  };
  const eventoB = {
    id: uid('V'), cliente_id: clienteId, name: 'Docinhos para festa', status: 'confirmado',
    event_date: null, total_cost: 20, total_price: 60, total_paid: 30, balance_due: 30,
    profit: 40, margin_pct: 66.7,
  };
  state.eventos.push(eventoA, eventoB);
  state.pagamentos.push(
    { id: uid('P'), evento_id: eventoA.id, amount: 100, method: 'Pix', received_at: '2026-09-01T15:00:00Z', note: null },
    { id: uid('P'), evento_id: eventoB.id, amount: 30, method: 'Dinheiro', received_at: '2026-08-28T12:00:00Z', note: null },
  );

  await page.goto(PAGE + '?id=' + clienteId);
  await page.waitForSelector('#cliente-name', { timeout: 6000 });
  check('deep link opens the right cliente directly',
    (await page.textContent('#cliente-name')).includes('Maria Silva'));
  check('both eventos are listed', (await page.$$('.evento-row')).length === 2);
  check('both pagamentos are listed', (await page.$$('.pay-row')).length === 2);
  check('evento A shows its status pill', (await page.textContent('#eventos-card')).includes('Entregue'));
  check('evento B shows its status pill', (await page.textContent('#eventos-card')).includes('Confirmado'));
  check('totals card sums total vendido (160,00), got: ' + norm(await page.textContent('.totals-card')),
    norm(await page.textContent('.totals-card')).includes('R$ 160,00'));
  check('totals card sums total pago (130,00)',
    norm(await page.textContent('.totals-card')).includes('R$ 130,00'));
  check('totals card shows saldo devedor (30,00)',
    norm(await page.textContent('.totals-card')).includes('R$ 30,00'));
  check('the payment row shows which evento it belongs to',
    (await page.textContent('.pay-row')).includes('Docinhos para festa') ||
    (await page.textContent('#pays-card')).includes('Docinhos para festa'));
  const eventoRow = await page.$('.evento-row[data-id="' + eventoA.id + '"]');
  check('the evento row carries the deep-link id', eventoRow !== null);
  const payRow = await page.$('.pay-row[data-evento="' + eventoB.id + '"]');
  check('the pagamento row carries its evento id for the deep link', payRow !== null);

  // --- search on the list screen ---
  const cliente2 = await page.evaluate(async () => {
    return (await window.api('cliente_create', { name: 'Clube Helvetia', organization: 'Associação' })).cliente;
  });
  await page.click('#back');
  await page.waitForSelector('#new-cliente', { timeout: 6000 });
  check('both clientes show in the list', (await page.$$('.row[data-id]')).length === 2);
  await page.fill('#search', 'helvetia');
  await page.waitForFunction(
    () => document.querySelectorAll('.row[data-id]').length === 1, null, { timeout: 6000 });
  check('search narrows to the matching cliente',
    (await page.textContent('#list-card')).includes('Clube Helvetia'));
  await page.fill('#search', 'doces');
  await page.waitForFunction(
    () => document.querySelectorAll('.row[data-id]').length === 1, null, { timeout: 6000 });
  check('search also matches on organization',
    (await page.textContent('#list-card')).includes('Maria Silva'));
  // Regression test for a real reported gap: a name typed WITHOUT its
  // accent (or on a keyboard that can't produce one) must still find the
  // real cliente — "associacao" must find "Associação".
  await page.fill('#search', 'associacao');
  await page.waitForFunction(
    () => document.querySelectorAll('.row[data-id]').length === 1, null, { timeout: 6000 });
  check('search is accent-insensitive: "associacao" still finds "Associação"',
    (await page.textContent('#list-card')).includes('Clube Helvetia'));
  await page.fill('#search', 'ninguém tem esse nome');
  await page.waitForSelector('#no-match', { timeout: 6000 });
  check('an unmatched search shows the empty-match message', true);
  await page.fill('#search', '');
  await page.waitForFunction(
    () => document.querySelectorAll('.row[data-id]').length === 2, null, { timeout: 6000 });

  // --- delete: a cliente with linked eventos reports how many were unlinked ---
  await page.click('.row[data-id="' + clienteId + '"]');
  await page.waitForSelector('#del-cliente', { timeout: 6000 });
  await page.click('#del-cliente');
  await page.waitForSelector('#confirm-ok', { timeout: 6000 });
  await page.click('#confirm-ok');
  await page.waitForSelector('#new-cliente', { timeout: 6000 });
  check('the cliente is gone from state', state.clientes.length === 1);
  check('both eventos survive with cliente_id nulled',
    state.eventos.every(v => v.cliente_id === null));
  check('only the remaining cliente shows in the list',
    (await page.textContent('#list-card')).includes('Clube Helvetia') &&
    !(await page.textContent('#list-card')).includes('Maria Silva'));

  await page.screenshot({ path: path.join(SHOTS, 'cliente_detalhe.png'), fullPage: true });
  await browser.close();
  server.close();
  if (process.env.KEEP_SHOTS) console.log('screenshots: ' + SHOTS);

  console.log('--- JS errors ---');
  console.log(errors.length ? errors.join('\n') : '(none)');
  console.log('--- failures ---');
  console.log(failures.length ? failures.join('\n') : '(none)');
  process.exit(failures.length || errors.length ? 1 : 0);
})();
