// Headless UI test for eventos.html — the evento pipeline: clientes,
// the evento pipeline stages, line items, and the payment ledger that
// auto-posts into Financeiro.
//
//   node test/eventos.test.js             # exits non-zero on any failure
//   KEEP_SHOTS=1 node test/...           # also prints where screenshots went
//
// Same shape as compras.test.js/stock.test.js: serves the repo root over
// http and answers maga-api from an in-memory fake, so it never
// touches Supabase and never needs a real passphrase. The fake keeps REAL
// relational state (clientes/eventos/evento_itens/evento_pagamentos/
// financeiro_lancamentos) and computes totals/profit/margin and the
// payment -> ledger auto-post the same way the Edge Function does — that
// integration is the whole point of this module, so faking it away would
// leave the interesting half untested.
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
const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), 'eventos-test-'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
                '.css': 'text/css', '.png': 'image/png' };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(WEB_DIR, rel || 'eventos.html');
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

const state = {
  clientes: [],
  eventos: [],
  itens: [],
  pagamentos: [],
  lancamentos: [],
  seq: 0,
};
const uid = (p) => p + (++state.seq);

function eventoTotals(eventoId) {
  const items = state.itens.filter(i => i.evento_id === eventoId);
  const pays = state.pagamentos.filter(p => p.evento_id === eventoId);
  const total_cost = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_cost), 0);
  const total_price = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);
  const total_paid = pays.reduce((s, p) => s + Number(p.amount), 0);
  return { total_cost, total_price, total_paid };
}
function withTotals(v) {
  const t = eventoTotals(v.id);
  const profit = t.total_price - t.total_cost;
  return {
    ...v,
    total_cost: t.total_cost, total_price: t.total_price, total_paid: t.total_paid,
    balance_due: t.total_price - t.total_paid,
    profit, margin_pct: t.total_price > 0 ? (profit / t.total_price) * 100 : null,
  };
}
function clienteEmbed(id) {
  const c = state.clientes.find(x => x.id === id);
  return c ? { id: c.id, name: c.name, organization: c.organization, phone: c.phone, email: c.email } : null;
}

(async () => {
  const failures = [];
  const server = await serve();
  const PAGE = 'http://127.0.0.1:' + server.address().port + '/eventos.html';
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
      const c = { id: uid('C'), name: body.name, organization: null, phone: null, email: null, notes: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.clientes.push(c);
      resp = { ok: true, cliente: c };
    } else if (body.action === 'cliente_delete') {
      const linked = state.eventos.filter(v => v.cliente_id === body.id);
      linked.forEach(v => { v.cliente_id = null; });
      state.clientes = state.clientes.filter(c => c.id !== body.id);
      resp = { ok: true, eventos_unlinked: linked.length };
    } else if (body.action === 'eventos') {
      resp = { eventos: state.eventos.map(v => ({ ...withTotals(v), cliente: clienteEmbed(v.cliente_id) })),
        cost_error: null, paid_error: null };
    } else if (body.action === 'evento_detail') {
      const v = state.eventos.find(x => x.id === body.id);
      if (!v) { resp = { found: false, id: body.id }; }
      else {
        const t = withTotals(v);
        resp = {
          found: true,
          evento: { ...v, cliente: clienteEmbed(v.cliente_id) },
          itens: state.itens.filter(i => i.evento_id === v.id),
          pagamentos: state.pagamentos.filter(p => p.evento_id === v.id)
            .slice().sort((a, b) => b.received_at.localeCompare(a.received_at)),
          total_cost: t.total_cost, total_price: t.total_price, total_paid: t.total_paid,
          balance_due: t.balance_due, profit: t.profit, margin_pct: t.margin_pct,
        };
      }
    } else if (body.action === 'evento_create') {
      const v = {
        id: uid('V'), cliente_id: body.cliente_id, name: body.name,
        status: body.status || 'confirmado', event_date: body.event_date || null,
        source: 'manual', source_ref: null, notes: body.notes || null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      state.eventos.push(v);
      resp = { ok: true, evento: { ...v, cliente: clienteEmbed(v.cliente_id) } };
    } else if (body.action === 'evento_update') {
      const v = state.eventos.find(x => x.id === body.id);
      if (!v) { resp = { error: 'unknown evento' }; }
      else {
        ['name', 'status', 'event_date', 'cliente_id', 'notes'].forEach(k => {
          if (k in body) v[k] = body[k];
        });
        v.updated_at = new Date().toISOString();
        resp = { ok: true, evento: { ...v, cliente: clienteEmbed(v.cliente_id) } };
      }
    } else if (body.action === 'evento_delete') {
      const v = state.eventos.find(x => x.id === body.id);
      const items = state.itens.filter(i => i.evento_id === body.id);
      const pays = state.pagamentos.filter(p => p.evento_id === body.id);
      const t = withTotals(v);
      if (!body.force && (items.length > 0 || pays.length > 0)) {
        resp = { ok: false, reason: 'has_content', id: body.id, name: v.name,
          items: items.length, payments: pays.length, total_paid: t.total_paid };
      } else {
        state.itens = state.itens.filter(i => i.evento_id !== body.id);
        state.pagamentos = state.pagamentos.filter(p => p.evento_id !== body.id);
        state.lancamentos.forEach(l => {
          if (l.evento_id === body.id) l.evento_id = null;
        });
        state.eventos = state.eventos.filter(x => x.id !== body.id);
        resp = { ok: true, id: body.id, items_removed: items.length, payments_removed: pays.length };
      }
    } else if (body.action === 'evento_item_add') {
      const it = {
        id: uid('I'), evento_id: body.evento_id, tipo: body.tipo, description: body.description,
        quantity: body.quantity, unit_cost: body.unit_cost || 0, unit_price: body.unit_price || 0,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      state.itens.push(it);
      resp = { ok: true, item: it };
    } else if (body.action === 'evento_item_update') {
      const it = state.itens.find(x => x.id === body.id);
      ['tipo', 'description', 'quantity', 'unit_cost', 'unit_price'].forEach(k => {
        if (k in body) it[k] = body[k];
      });
      resp = { ok: true, item: it };
    } else if (body.action === 'evento_item_delete') {
      const it = state.itens.find(x => x.id === body.id);
      state.itens = state.itens.filter(x => x.id !== body.id);
      resp = { ok: true, id: body.id, evento_id: it ? it.evento_id : null };
    } else if (body.action === 'evento_payment_confirm') {
      const v = state.eventos.find(x => x.id === body.evento_id);
      const pay = {
        id: uid('P'), evento_id: body.evento_id, amount: body.amount,
        method: body.method || null, received_at: body.received_at || new Date().toISOString(),
        note: body.note || null, created_at: new Date().toISOString(),
      };
      state.pagamentos.push(pay);
      const lanc = {
        id: uid('L'), tipo: 'receita', amount: body.amount, categoria: 'evento',
        description: 'Pagamento — ' + v.name, occurred_at: pay.received_at,
        evento_id: body.evento_id, evento_pagamento_id: pay.id, stock_movement_id: null,
        source: 'evento_payment', note: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      state.lancamentos.push(lanc);
      const t = withTotals(v);
      resp = { ok: true, payment: pay, lancamento: lanc, total_paid: t.total_paid, balance_due: t.balance_due };
    } else if (body.action === 'evento_payment_update') {
      const pay = state.pagamentos.find(x => x.id === body.id);
      let changed = false;
      ['amount', 'method', 'received_at', 'note'].forEach(k => {
        if (k in body) { pay[k] = body[k]; if (k === 'amount' || k === 'received_at') changed = true; }
      });
      let lancamento_updated = false;
      if (changed) {
        const lanc = state.lancamentos.find(l => l.evento_pagamento_id === pay.id);
        if (lanc) {
          if ('amount' in body) lanc.amount = body.amount;
          if ('received_at' in body) lanc.occurred_at = body.received_at;
          lancamento_updated = true;
        }
      }
      const v = state.eventos.find(x => x.id === pay.evento_id);
      const t = withTotals(v);
      resp = { ok: true, payment: pay, lancamento_updated, total_paid: t.total_paid, balance_due: t.balance_due };
    } else if (body.action === 'evento_payment_delete') {
      const pay = state.pagamentos.find(x => x.id === body.id);
      const eventoId = pay.evento_id;
      state.pagamentos = state.pagamentos.filter(x => x.id !== body.id);
      state.lancamentos.forEach(l => {
        if (l.evento_pagamento_id === body.id) l.evento_pagamento_id = null;
      });
      const v = state.eventos.find(x => x.id === eventoId);
      const t = v ? withTotals(v) : { total_paid: 0, balance_due: 0 };
      resp = { ok: true, id: body.id, evento_id: eventoId, total_paid: t.total_paid, balance_due: t.balance_due };
    } else if (body.action === 'financeiro_lancamentos') {
      resp = { lancamentos: state.lancamentos.slice(), total_receitas: 0, total_despesas: 0, saldo: 0 };
    } else {
      resp = { error: 'bad action' };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resp) });
  });

  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const check = (label, cond) => { if (!cond) failures.push('FAIL: ' + label); };
  // Intl's pt-BR currency formatter uses a NBSP between "R$" and the
  // number; normalize it so plain-space string checks below aren't fooled
  // by an invisible character mismatch.
  const norm = (s) => s.replace(/\u00A0/g, ' ');

  await ctx.addInitScript(() => { try { localStorage.setItem('checklist_pass', 'x'); } catch (_) {} });
  await page.goto(PAGE);
  await page.waitForSelector('#new-evento', { timeout: 6000 });
  check('empty state shows the create button', (await page.$('#new-evento')) !== null);

  // --- create a cliente inline via the picker, then an evento ---
  await page.click('#new-evento');
  await page.waitForSelector('#nv-cliente-btn', { timeout: 6000 });
  await page.click('#nv-cliente-btn');
  await page.waitForSelector('#cli-q', { timeout: 6000 });
  await page.fill('#cli-q', 'Maria Silva');
  await page.click('#cli-list [data-create]');
  await page.waitForFunction(
    () => document.getElementById('nv-cliente-btn').textContent.includes('Maria Silva'),
    null, { timeout: 6000 });
  check('the newly created cliente fills the picker button',
    (await page.textContent('#nv-cliente-btn')).includes('Maria Silva'));

  await page.fill('#nv-name', 'Bolo de aniversário');
  await page.selectOption('#nv-status', 'lead');
  await page.click('#nv-ok');
  await page.waitForSelector('.evento-head', { timeout: 6000 });
  check('an evento created at lead stage renders lead', (await page.textContent('.pill')).includes('Lead'));
  check('one cliente exists', state.clientes.length === 1);
  check('one evento exists', state.eventos.length === 1);

  // --- walk the pipeline through every stage ---
  for (const [from, to] of [['lead', 'orcamento'], ['orcamento', 'confirmado']]) {
    await page.click('#change-status');
    await page.waitForSelector('.status-list', { timeout: 6000 });
    await page.click('.status-opt[data-status="' + to + '"]');
    await page.waitForFunction(
      (label) => document.querySelector('.evento-head .pill')?.textContent === label,
      to === 'orcamento' ? 'Orçamento' : 'Confirmado', { timeout: 6000 });
  }
  check('status reached confirmado', state.eventos[0].status === 'confirmado');

  // --- two line items ---
  await page.click('#add-item');
  await page.waitForSelector('#it-desc', { timeout: 6000 });
  await page.fill('#it-desc', 'Bolo de chocolate');
  await page.fill('#it-qty', '2');
  await page.fill('#it-cost', '1550');
  await page.fill('#it-price', '4000');
  await page.click('#it-ok');
  await page.waitForFunction(() => document.querySelectorAll('.item-row').length === 1, null, { timeout: 6000 });

  await page.click('#add-item');
  await page.waitForSelector('#it-desc', { timeout: 6000 });
  await page.selectOption('#it-tipo', 'servico');
  await page.fill('#it-desc', 'Entrega');
  await page.fill('#it-qty', '1');
  await page.fill('#it-cost', '1000');
  await page.fill('#it-price', '2000');
  await page.click('#it-ok');
  await page.waitForFunction(() => document.querySelectorAll('.item-row').length === 2, null, { timeout: 6000 });

  check('total cost matches 2×15,50 + 1×10, got: ' + await page.textContent('.totals-grid'),
    norm(await page.textContent('.totals-grid')).includes('R$ 41,00'));
  check('total price matches 2×40 + 1×20',
    norm(await page.textContent('.totals-grid')).includes('R$ 100,00'));
  check('profit is price minus cost (59)',
    norm(await page.textContent('.totals-grid')).includes('R$ 59,00'));
  check('margin is 59,0%', norm(await page.textContent('.totals-grid')).includes('59,0%'));

  const eventoId = state.eventos[0].id;

  // --- a partial payment, then a second reaching full balance ---
  await page.click('#confirm-pay');
  await page.waitForSelector('#pay-amount', { timeout: 6000 });
  check('the amount is prefilled with the outstanding balance',
    (await page.inputValue('#pay-amount')) === '100,00');
  await page.fill('#pay-amount', '4000');
  await page.click('#pay-ok');
  await page.waitForFunction(() => document.querySelectorAll('.pay-row').length === 1, null, { timeout: 6000 });
  check('exactly one linked lançamento exists after the first payment',
    state.lancamentos.filter(l => l.evento_id === eventoId).length === 1);
  check('total paid shows 40,00', norm(await page.textContent('.totals-grid')).includes('R$ 40,00'));
  check('balance due shows 60,00', norm(await page.textContent('.totals-grid')).includes('R$ 60,00'));

  await page.click('#confirm-pay');
  await page.waitForSelector('#pay-amount', { timeout: 6000 });
  check('the second payment prefills the REMAINING balance, got: ' + await page.inputValue('#pay-amount'),
    (await page.inputValue('#pay-amount')) === '60,00');
  await page.click('#pay-ok');
  await page.waitForFunction(() => document.querySelectorAll('.pay-row').length === 2, null, { timeout: 6000 });
  check('two payments reach the full 100,00 balance',
    norm(await page.textContent('.totals-grid')).includes('R$ 100,00') &&
    eventoTotals(eventoId).total_paid === 100);
  check('payment status pill reads Pago', (await page.textContent('#root')).includes('Pago'));

  // --- edit a payment's amount, confirm the linked ledger row follows ---
  // Looked up by id from the fake's own state rather than by row text: the
  // row's text is mid-transition around a re-render, and matching on it
  // raced the DOM update on a fast machine.
  const firstPayId = state.pagamentos.find(p => p.amount === 40).id;
  await page.click(`.pay-row[data-pay="${firstPayId}"] [data-edit-pay]`);
  await page.waitForSelector('#pe-amount', { timeout: 6000 });
  await page.fill('#pe-amount', '4500');
  await page.click('#pe-ok');
  // `.evento-head` is NOT a usable signal that the re-render finished — it
  // is present before the edit too, so waitForSelector resolved instantly
  // while #root still held the "Carregando…" placeholder, and the pay-row
  // count captured a moment later read 0. Wait for the edited amount to
  // actually be on screen instead.
  await page.waitForFunction(
    () => document.querySelectorAll('.pay-row').length === 2 &&
      /R\$\s*45,00/.test(document.querySelector('.pay-row').textContent.replace(/\u00A0/g, ' ')),
    null, { timeout: 6000 });
  const editedLanc = state.lancamentos.find(l => l.amount === 45 && l.evento_id === eventoId);
  check('the linked lançamento amount followed the edited payment', !!editedLanc);

  // --- delete that payment; the ledger row survives with its link nulled ---
  const payRowsBefore = await page.$$('.pay-row');
  await page.click(`.pay-row[data-pay="${firstPayId}"] [data-del-pay]`);
  await page.waitForSelector('#confirm-ok', { timeout: 6000 });
  await page.click('#confirm-ok');
  await page.waitForFunction(
    (n) => document.querySelectorAll('.pay-row').length === n, payRowsBefore.length - 1, { timeout: 6000 });
  check('the payment is gone', state.pagamentos.find(p => p.amount === 45) === undefined);
  check('the linked ledger row survives with evento_pagamento_id nulled',
    editedLanc.evento_pagamento_id === null && editedLanc.amount === 45);

  // --- edit an item, confirm totals recompute ---
  const bolinhoId = state.itens.find(i => i.description === 'Bolo de chocolate').id;
  await page.click(`.item-row[data-item="${bolinhoId}"] [data-edit-item]`);
  await page.waitForSelector('#it-desc', { timeout: 6000 });
  await page.fill('#it-qty', '3');
  await page.click('#it-ok');
  await page.waitForFunction(
    () => (document.querySelector('.totals-grid') || {}).textContent?.includes('140,00'),
    null, { timeout: 6000 });
  check('raising quantity to 3 recomputes total price to 140,00 (3×40 + 20)',
    norm(await page.textContent('.totals-grid')).includes('R$ 140,00'));

  // --- refusal-first delete, then force ---
  await page.click('#del-evento');
  await page.waitForSelector('#confirm-ok', { timeout: 6000 });
  await page.click('#confirm-ok');
  await page.waitForSelector('#confirm-ok', { timeout: 6000 }); // the has_content follow-up dialog
  check('the follow-up dialog is shown because the evento has content',
    (await page.textContent('.modal-card p')).includes('itens') ||
    (await page.textContent('.modal-card p')).includes('pagamento'));
  await page.click('#confirm-ok');
  await page.waitForFunction(() => document.getElementById('new-evento') !== null, null, { timeout: 6000 });
  check('the evento is gone from state', state.eventos.length === 0);
  check('both remaining ledger rows survive with evento_id nulled',
    state.lancamentos.every(l => l.evento_id === null) && state.lancamentos.length === 2);

  // --- deep link opens the right evento ---
  // Recreate an evento directly through the UI for the deep-link check.
  await page.click('#new-evento');
  await page.waitForSelector('#nv-cliente-btn', { timeout: 6000 });
  await page.click('#nv-cliente-btn');
  await page.waitForSelector('#cli-q', { timeout: 6000 });
  await page.fill('#cli-q', 'Maria Silva');
  await page.click('.cli-opt:not(.create)');
  await page.fill('#nv-name', 'Evento para deep link');
  await page.click('#nv-ok');
  await page.waitForSelector('.evento-head', { timeout: 6000 });
  const deepId = state.eventos[0].id;
  await page.click('#back');
  await page.waitForSelector('#new-evento', { timeout: 6000 });
  await page.goto(PAGE + '?id=' + deepId);
  await page.waitForSelector('.evento-head', { timeout: 6000 });
  check('the deep link opens the right evento directly',
    (await page.textContent('#evento-name')).includes('Evento para deep link'));

  // --- cliente delete unlinks without breaking the detail sheet ---
  await page.click('#back');
  await page.waitForSelector('#new-evento', { timeout: 6000 });
  const clienteId = state.clientes[0].id;
  // Delete the cliente via a direct API call (no cliente-management UI on
  // this page — clientes are managed inline through the picker), then
  // confirm the evento's OWN detail sheet still opens cleanly.
  await page.evaluate(async (id) => {
    await window.api('cliente_delete', { id });
  }, clienteId);
  await page.click(`.row[data-id="${deepId}"]`);
  await page.waitForSelector('.evento-head', { timeout: 6000 });
  check('the evento renders "Sem cliente" after its cliente is deleted, no crash',
    (await page.textContent('.cli-block')).includes('Sem cliente'));

  // --- accent-insensitive search (foldSearchText): an unaccented typed
  // term matches a cliente/evento name stored WITH accents, and a
  // genuinely different term still doesn't match (no over-matching) ---
  await page.click('#back');
  await page.waitForSelector('#new-evento', { timeout: 6000 });
  await page.click('#new-evento');
  await page.waitForSelector('#nv-cliente-btn', { timeout: 6000 });
  await page.click('#nv-cliente-btn');
  await page.waitForSelector('#cli-q', { timeout: 6000 });
  await page.fill('#cli-q', 'José Ramírez');
  await page.click('#cli-list [data-create]');
  await page.waitForFunction(
    () => document.getElementById('nv-cliente-btn').textContent.includes('José Ramírez'),
    null, { timeout: 6000 });
  await page.fill('#nv-name', 'Aniversário do Zé');
  await page.click('#nv-ok');
  await page.waitForSelector('.evento-head', { timeout: 6000 });
  await page.click('#back');
  await page.waitForSelector('#search', { timeout: 6000 });

  await page.fill('#search', 'jose ramirez');
  await page.waitForFunction(
    () => (document.getElementById('root').textContent || '').includes('Aniversário do Zé'),
    null, { timeout: 6000 });
  check('unaccented search "jose ramirez" matches the accented cliente name "José Ramírez", got: ' +
    await page.textContent('#root'),
    (await page.textContent('#root')).includes('Aniversário do Zé'));

  await page.fill('#search', 'zzzznotfound');
  await page.waitForFunction(() => document.getElementById('no-match') !== null, null, { timeout: 6000 });
  check('an unrelated search term does not match the accented evento (no over-matching)',
    !(await page.textContent('#root')).includes('Aniversário do Zé'));

  await page.screenshot({ path: path.join(SHOTS, 'evento_detalhe.png'), fullPage: true });
  await browser.close();
  server.close();
  if (process.env.KEEP_SHOTS) console.log('screenshots: ' + SHOTS);

  console.log('--- JS errors ---');
  console.log(errors.length ? errors.join('\n') : '(none)');
  console.log('--- failures ---');
  console.log(failures.length ? failures.join('\n') : '(none)');
  process.exit(failures.length || errors.length ? 1 : 0);
})();
