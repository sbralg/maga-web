// Headless UI test for estoque.html and insumos.html — the pantry
// steppers, the zero floor and its retroactive-purchase dialog, the
// recount dialog, the catalogue search, the price graph and the insumo
// editor.
//
//   node test/stock.test.js             # exits non-zero on any failure
//   KEEP_SHOTS=1 node test/...          # also prints where screenshots went
//
// Same shape as shopping.test.js: it serves the repo root over http (which
// is what GitHub Pages does, and localStorage behaves differently on a
// file: origin) and answers maga-api from an in-memory fake, so it
// never touches Supabase and holds no passphrase.
//
// The fake keeps a REAL LEDGER rather than a balance number, and enforces
// the zero floor exactly the way the Edge Function does — refusing with
// ok:false + the shortfall instead of an error status. That rule is the
// whole reason this page has the dialog it has, so faking it away would
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
const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-test-'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
                '.css': 'text/css', '.png': 'image/png' };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(WEB_DIR, rel || 'estoque.html');
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

// Four insumos spanning what the pages have to cope with: a stocked one
// with a package size, a stocked one WITHOUT (so the "total" line has to
// stay absent), one at zero, and one with a price history long enough to
// draw a line from.
const INSUMOS = [
  { gtin: '7891000100103', name: 'Leite Condensado moça', brand: 'NESTLÉ',
    net_qty: 395, net_unit: 'g', image_url: null, source: 'off',
    ingredient: { id: 'I1', name: 'Leite condensado' } },
  { gtin: '7896004700236', name: 'Bolacha Maria', brand: 'Adria',
    net_qty: null, net_unit: null, image_url: null, source: 'off' },
  { gtin: '7891234567895', name: 'Manteiga com Sal', brand: 'AVIAÇÃO',
    net_qty: 200, net_unit: 'g', image_url: null, source: 'off' },
  { gtin: '7897001234564', name: 'Suco de Uva Aurora', brand: 'AURORA',
    net_qty: 1000, net_unit: 'ml', image_url: null, source: 'manual' },
  // The case the ingredient link exists for: a different BRAND of something
  // already in the catalogue. Nothing about the barcode, the name or the
  // size says these two are interchangeable — the ingredient does.
  { gtin: '7898215151999', name: 'Leite Condensado Piracanjuba', brand: 'Piracanjuba',
    net_qty: 395, net_unit: 'g', image_url: null, source: 'off' },
];

const PRICES = {
  '7891000100103': [
    { id: 'P1', price: 7.5, quantity: 1, store: null, captured_at: '2026-06-01T10:00:00Z' },
    { id: 'P2', price: 6.9, quantity: 1, store: null, captured_at: '2026-07-01T10:00:00Z' },
    { id: 'P3', price: 8.2, quantity: 1, store: null, captured_at: '2026-08-01T10:00:00Z' },
  ],
  // Exactly one price: not a history, so no chart should be drawn.
  '7891234567895': [
    { id: 'P4', price: 12.0, quantity: 1, store: null, captured_at: '2026-08-02T10:00:00Z' },
  ],
  '7896004700236': [],
  '7897001234564': [],
};

// The ingredient side. One already exists and is linked to the leite
// condensado, so the "same ingredient, different brand" case — the whole
// point of the two-level model — has something to be found by: the picker's
// "provável" suggestion has to offer it for the SECOND condensed milk.
const INGREDIENTS = [
  { id: 'I1', name: 'Leite condensado', base_unit: null },
];

const state = { movements: [], seq: 0, calls: [], ingSeq: 0 };

// Seed: 3 leite, 1 manteiga, 2 suco, 0 bolacha.
function seed(gtin, n) {
  state.movements.push({ id: 'M' + (++state.seq), gtin, delta: n, reason: 'purchase',
    unit_cost: null, note: null, source_item_id: null,
    occurred_at: '2026-08-05T10:00:00Z' });
}
function resetState() {
  state.movements = [];
  state.seq = 0;
  state.calls = [];
  seed('7891000100103', 3);
  seed('7891234567895', 1);
  seed('7897001234564', 2);
}

function balance(gtin) {
  return state.movements
    .filter(m => m.gtin === gtin)
    .reduce((acc, m) => acc + Number(m.delta), 0);
}
function lastPrice(gtin) {
  const list = PRICES[gtin] || [];
  return list.length ? list[list.length - 1].price : null;
}

function insumosResponse() {
  return {
    insumos: INSUMOS.map(p => ({
      ...p,
      qty: balance(p.gtin),
      last_movement_at: null,
      last_price: lastPrice(p.gtin),
      last_price_at: null,
    })),
    stock_error: null,
    price_error: null,
  };
}

// Mirrors maga-api's stock_move, including the two things that matter:
// the zero floor answering 200 + ok:false (a business outcome, not a
// transport error), and an inbound movement with no unit_cost falling back
// to the last price paid.
function handleMove(body) {
  const current = balance(body.gtin);
  const delta = Number(body.delta);
  if (current + delta < 0) {
    return { ok: false, reason: 'insufficient_stock', gtin: body.gtin,
      available: current, requested: -delta, deficit: -(current + delta),
      last_price: lastPrice(body.gtin) };
  }
  let unitCost = null;
  if (body.reason === 'purchase' || body.reason === 'unaccounted_purchase') {
    unitCost = body.unit_cost === undefined ? lastPrice(body.gtin)
      : (body.unit_cost === null || body.unit_cost === '' ? null : Number(body.unit_cost));
  }
  const movement = { id: 'M' + (++state.seq), gtin: body.gtin, delta,
    reason: body.reason, unit_cost: unitCost, note: body.note ?? null,
    source_item_id: body.source_item_id ?? null,
    occurred_at: new Date().toISOString() };
  state.movements.push(movement);
  return { ok: true, qty: current + delta, movement };
}

(async () => {
  const failures = [];
  const check = (label, cond) => { if (!cond) failures.push('FAIL: ' + label); };

  resetState();
  const server = await serve();
  const BASE = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });

  const errors = [];
  ctx.on('weberror', e => errors.push('pageerror: ' + e.error().message));
  await ctx.addInitScript(() => {
    try { localStorage.setItem('checklist_pass', 'x'); } catch (_) {}
  });

  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.route('**/functions/v1/maga-api', async route => {
    const body = route.request().postDataJSON();
    state.calls.push({ ...body });
    let resp;
    if (body.action === 'insumos') {
      resp = insumosResponse();
    } else if (body.action === 'insumo_detail') {
      const p = INSUMOS.find(x => x.gtin === body.gtin);
      resp = p
        ? { found: true, gtin: p.gtin, insumo: { ...p }, qty: balance(p.gtin),
            prices: (PRICES[p.gtin] || []).map(x => ({ ...x })),
            movements: state.movements.filter(m => m.gtin === p.gtin)
              .slice().reverse().map(m => ({ ...m })) }
        : { found: false, gtin: body.gtin };
    } else if (body.action === 'stock_move') {
      resp = handleMove(body);
    } else if (body.action === 'stock_set') {
      const current = balance(body.gtin);
      const delta = Number(body.quantity) - current;
      if (delta === 0) resp = { ok: true, qty: current, unchanged: true };
      else {
        state.movements.push({ id: 'M' + (++state.seq), gtin: body.gtin, delta,
          reason: 'adjustment', unit_cost: null, note: null, source_item_id: null,
          occurred_at: new Date().toISOString() });
        resp = { ok: true, qty: Number(body.quantity) };
      }
    } else if (body.action === 'stock_movement_delete') {
      const i = state.movements.findIndex(m => m.id === body.id);
      const gtin = i >= 0 ? state.movements[i].gtin : null;
      if (i >= 0) state.movements.splice(i, 1);
      resp = { ok: true, qty: gtin ? balance(gtin) : null };
    } else if (body.action === 'ingredients') {
      resp = { ingredients: INGREDIENTS.map(i => ({ ...i,
        insumo_count: INSUMOS.filter(p => p.ingredient && p.ingredient.id === i.id).length })) };
    } else if (body.action === 'insumo_set_ingredient') {
      const p = INSUMOS.find(x => x.gtin === body.gtin);
      let ing = null;
      if (body.ingredient_id) {
        ing = INGREDIENTS.find(i => i.id === body.ingredient_id) || null;
      } else if (body.ingredient_name) {
        // Found-or-created, case-insensitively, exactly like the API's
        // unique index on lower(name).
        const want = String(body.ingredient_name).trim();
        ing = INGREDIENTS.find(i => i.name.toLowerCase() === want.toLowerCase());
        if (!ing) { ing = { id: 'I' + (++state.ingSeq + 100), name: want, base_unit: null };
          INGREDIENTS.push(ing); }
      }
      if (p) p.ingredient = ing ? { id: ing.id, name: ing.name } : null;
      resp = { ok: true, insumo: { ...p } };
    } else if (body.action === 'insumo_delete') {
      const p = INSUMOS.find(x => x.gtin === body.gtin);
      const movements = state.movements.filter(m => m.gtin === body.gtin).length;
      const prices = (PRICES[body.gtin] || []).length;
      const qty = balance(body.gtin);
      // The refusal-first rule: anything to lose means the first call comes
      // back as a 200 with ok:false carrying the numbers, and only a second
      // call with force goes through.
      if (!body.force && (qty !== 0 || movements > 0 || prices > 0)) {
        resp = { ok: false, reason: 'has_history', gtin: body.gtin, name: p && p.name,
          qty, movements, prices, items: 0 };
      } else {
        const i = INSUMOS.findIndex(x => x.gtin === body.gtin);
        if (i >= 0) INSUMOS.splice(i, 1);
        // Both foreign keys cascade in the real schema.
        state.movements = state.movements.filter(m => m.gtin !== body.gtin);
        delete PRICES[body.gtin];
        resp = { ok: true, gtin: body.gtin, name: p && p.name,
          movements_removed: movements, prices_removed: prices, items_unlinked: 0 };
      }
    } else if (body.action === 'insumo_upsert') {
      const p = INSUMOS.find(x => x.gtin === body.gtin);
      if (p) {
        p.name = body.name;
        if ('brand' in body) p.brand = body.brand || null;
        if ('net_qty' in body) p.net_qty = body.net_qty;
        if ('net_unit' in body) p.net_unit = body.net_unit;
      }
      resp = { insumo: { ...p } };
    } else {
      resp = { error: 'bad action' };
    }
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(resp) });
  });

  const rowSel = g => '.row[data-gtin="' + g + '"]';
  const qtyText = g => page.textContent(rowSel(g) + ' [data-qty]');
  const step = (g, dir) => page.click(rowSel(g) + ' .step-btn[data-step="' + dir + '"]');
  // Every mutation round-trips, so waiting for the number to settle is the
  // honest way to sequence the assertions.
  const waitQty = (g, want) => page.waitForFunction(
    ([sel, w]) => document.querySelector(sel + ' [data-qty]')?.textContent === w,
    [rowSel(g), want], { timeout: 6000 });

  // ================= estoque.html =================
  await page.goto(BASE + 'estoque.html');
  await page.waitForSelector('#in-card', { timeout: 8000 });

  check('the pantry lists what is in stock',
    (await page.$$('#in-card .row')).length === 3);

  // Lowest first: the point of a pantry list is what is about to run out.
  const order = await page.$$eval('#in-card .row', rows => rows.map(r => r.dataset.gtin));
  check('sorted lowest first, got: ' + order.join(','),
    order[0] === '7891234567895' && order[1] === '7897001234564' &&
    order[2] === '7891000100103');

  check('out-of-stock insumos are behind a collapsed section',
    (await page.$('#toggle-empty')) !== null &&
    await page.locator('#out-card').evaluate(el => el.classList.contains('hidden')));
  check('the collapsed section holds the insumo at zero',
    (await page.$$('#out-card .row')).length === 2 &&
    (await page.$('#out-card ' + rowSel('7896004700236'))) !== null);

  // Open it and leave it open for the rest of the run: a row that runs out
  // MOVES into this section, so from here on the interesting rows live
  // here, and a user taking two of something they are out of has to open it
  // the same way.
  await page.click('#toggle-empty');
  await page.waitForFunction(
    () => !document.getElementById('out-card').classList.contains('hidden'),
    null, { timeout: 4000 });

  // The count times the package size, which is what the whole net_qty
  // apparatus exists to make possible.
  check('the real amount is shown, got: ' + await page.textContent(rowSel('7891000100103') + ' [data-meta]'),
    (await page.textContent(rowSel('7891000100103') + ' [data-meta]')).includes('total 1,185 kg'));
  check('an insumo with no package size shows no total, got: ' +
      await page.textContent(rowSel('7896004700236') + ' [data-meta]'),
    !(await page.textContent(rowSel('7896004700236') + ' [data-meta]')).includes('total'));

  // --- putting one away ---
  await step('7891000100103', '1');
  await waitQty('7891000100103', '4');
  check('+ books a purchase',
    state.calls.some(c => c.action === 'stock_move' && c.delta === 1 && c.reason === 'purchase'));
  check('the purchase carries the last price paid, so finance has a number',
    state.movements.filter(m => m.reason === 'purchase' && m.unit_cost === 8.2).length === 1);

  // --- taking one out ---
  await step('7891000100103', '-1');
  await waitQty('7891000100103', '3');
  check('− books a consumption',
    state.calls.some(c => c.action === 'stock_move' && c.delta === -1 && c.reason === 'consumption'));
  check('a consumption carries no cost — what a drawdown is worth is the ' +
      'finance module\'s call, not this table\'s',
    state.movements.filter(m => m.reason === 'consumption').every(m => m.unit_cost === null));

  // --- crossing zero moves the row into the other half ---
  await step('7891234567895', '-1');
  await waitQty('7891234567895', '0');
  check('a row that runs out moves to the out-of-stock section',
    (await page.$('#out-card ' + rowSel('7891234567895'))) !== null);

  // --- THE zero floor, cancelled ---
  const movesBefore = state.movements.length;
  await step('7891234567895', '-1');
  await page.waitForSelector('.modal-card', { timeout: 6000 });
  check('using something with no stock asks instead of going negative',
    (await page.textContent('.modal-card h3')).includes('Não tem isso em estoque'));
  check('the dialog prefills the last price paid, got: ' + await page.inputValue('#sf-price'),
    (await page.inputValue('#sf-price')) === '12,00');
  await page.screenshot({ path: path.join(SHOTS, 'shortfall.png') });
  check('and how many are missing, got: ' + await page.inputValue('#sf-qty'),
    (await page.inputValue('#sf-qty')) === '1');
  await page.click('#sf-cancel');
  await page.waitForSelector('.modal-card', { state: 'detached', timeout: 6000 });
  check('declining writes absolutely nothing', state.movements.length === movesBefore);
  check('and leaves the count alone', (await qtyText('7891234567895')) === '0');

  // --- THE zero floor, resolved as a retroactive purchase ---
  await step('7891234567895', '-1');
  await page.waitForSelector('#sf-price', { timeout: 6000 });
  await page.fill('#sf-qty', '2');
  await page.fill('#sf-price', '1350');
  check('the price field is cents-first, got: ' + await page.inputValue('#sf-price'),
    (await page.inputValue('#sf-price')) === '13,50');
  await page.click('#sf-ok');
  await waitQty('7891234567895', '1');

  const retro = state.movements.filter(m => m.reason === 'unaccounted_purchase');
  check('the missing purchase is recorded, not swallowed', retro.length === 1);
  check('with the quantity actually bought, got: ' + (retro[0] && retro[0].delta),
    retro[0] && retro[0].delta === 2);
  check('and the cost, so the finance module can find it later, got: ' +
      (retro[0] && retro[0].unit_cost),
    retro[0] && retro[0].unit_cost === 13.5);
  check('the consumption then goes through', balance('7891234567895') === 1);
  check('the row is back in the in-stock section',
    (await page.$('#in-card ' + rowSel('7891234567895'))) !== null);

  // The floor is the invariant the whole page is built around.
  check('no balance ever went below zero',
    INSUMOS.every(p => balance(p.gtin) >= 0));

  // --- buying fewer than are missing is refused up front, rather than
  // letting the retry fail ---
  await step('7896004700236', '-1');
  await page.waitForSelector('#sf-qty', { timeout: 6000 });
  page.once('dialog', d => d.dismiss());
  await page.fill('#sf-qty', '0');
  await page.click('#sf-ok');
  check('a quantity that would not cover the shortfall keeps the dialog open',
    (await page.$('#sf-qty')) !== null);
  await page.click('#sf-cancel');
  await page.waitForSelector('.modal-card', { state: 'detached', timeout: 6000 });

  // --- recounting the shelf ---
  await page.click(rowSel('7891000100103') + ' [data-qty]');
  await page.waitForSelector('#ct-qty', { timeout: 6000 });
  check('the recount dialog opens on the current count, got: ' + await page.inputValue('#ct-qty'),
    (await page.inputValue('#ct-qty')) === '3');
  await page.fill('#ct-qty', '5');
  await page.click('#ct-ok');
  await waitQty('7891000100103', '5');
  check('a recount is an adjustment, not a purchase',
    state.movements.some(m => m.reason === 'adjustment' && m.delta === 2));

  // Zero is a legitimate recount — "there are none left" — even though the
  // steppers can never reach it by consuming what isn't there.
  await page.click(rowSel('7891000100103') + ' [data-qty]');
  await page.waitForSelector('#ct-qty', { timeout: 6000 });
  await page.fill('#ct-qty', '0');
  await page.click('#ct-ok');
  await waitQty('7891000100103', '0');
  check('a shelf can be counted down to zero', balance('7891000100103') === 0);
  await page.click(rowSel('7891000100103') + ' [data-qty]');
  await page.waitForSelector('#ct-qty', { timeout: 6000 });
  await page.fill('#ct-qty', '3');
  await page.click('#ct-ok');
  await waitQty('7891000100103', '3');

  // --- a double tap must not outrun the floor ---
  // Two −1 taps at a balance of 1: fired together they would both read a
  // balance of 1 server-side and both pass, landing at −1. The per-insumo
  // queue is what stops that.
  await page.click(rowSel('7891234567895') + ' .step-btn[data-step="-1"]');
  await page.click(rowSel('7891234567895') + ' .step-btn[data-step="-1"]');
  await page.waitForSelector('#sf-qty', { timeout: 6000 });
  check('the second tap is queued behind the first and hits the floor, not −1',
    balance('7891234567895') === 0);
  await page.click('#sf-cancel');
  await page.waitForSelector('.modal-card', { state: 'detached', timeout: 6000 });

  // --- search ---
  await page.fill('#search', 'manteiga');
  await page.waitForFunction(
    () => document.querySelectorAll('.row[data-gtin]').length === 1, null, { timeout: 6000 });
  check('search matches the name', (await page.$(rowSel('7891234567895'))) !== null);
  await page.fill('#search', '7896004700236');
  await page.waitForFunction(
    () => document.querySelectorAll('.row[data-gtin]').length === 1, null, { timeout: 6000 });
  check('search matches the barcode', (await page.$(rowSel('7896004700236'))) !== null);
  await page.fill('#search', 'aviação');
  await page.waitForFunction(
    () => document.querySelectorAll('.row[data-gtin]').length === 1, null, { timeout: 6000 });
  check('search matches the brand', (await page.$(rowSel('7891234567895'))) !== null);
  // Regression test for a real reported gap: typing the SAME brand WITHOUT
  // its accents (no keyboard shortcut for ã/ç, say) must still find it.
  await page.fill('#search', 'aviacao');
  await page.waitForFunction(
    () => document.querySelectorAll('.row[data-gtin]').length === 1, null, { timeout: 6000 });
  check('search is accent-insensitive: "aviacao" still finds "AVIAÇÃO"',
    (await page.$(rowSel('7891234567895'))) !== null);
  await page.fill('#search', '');
  await page.waitForFunction(
    () => document.querySelectorAll('.row[data-gtin]').length === 5, null, { timeout: 6000 });

  check('the menu offers both new pages', await page.evaluate(() => {
    document.getElementById('menu-btn').click();
    const labels = [...document.querySelectorAll('.menu-item')].map(e => e.textContent);
    document.querySelector('.menu-backdrop').remove();
    return labels.some(l => l.includes('Estoque')) && labels.some(l => l.includes('Insumos'));
  }));

  // --- categorising from the pantry ---
  //
  // The chip is inside the tap target that opens the insumo sheet, so the
  // first thing worth proving is that setting an ingredient does NOT
  // navigate away.
  check('an uncategorised row says so, muted rather than alarming, got: ' +
      await page.textContent(rowSel('7897001234564') + ' [data-ing]'),
    (await page.textContent(rowSel('7897001234564') + ' [data-ing]')) === 'sem ingrediente');
  check('and a categorised one names its ingredient, got: ' +
      await page.textContent(rowSel('7891000100103') + ' [data-ing]'),
    (await page.textContent(rowSel('7891000100103') + ' [data-ing]')) === 'Leite condensado');

  await page.click(rowSel('7897001234564') + ' [data-ing]');
  await page.waitForSelector('#ing-list', { timeout: 6000 });
  check('the picker opens on the pantry page instead of navigating away',
    (await page.evaluate(() => location.pathname)).endsWith('estoque.html'));
  check('it lists the ingredients that already exist',
    (await page.$$('#ing-list [data-pick]')).length === 1);
  // One field doing both jobs: filter what exists, name what does not.
  await page.fill('#ing-q', 'Suco de uva');
  await page.waitForSelector('#ing-list [data-create]', { timeout: 4000 });
  check('a name that matches nothing offers to create it',
    (await page.textContent('#ing-list [data-create]')).includes('Suco de uva'));
  await page.click('#ing-list [data-create]');
  await page.waitForFunction(
    (sel) => document.querySelector(sel + ' [data-ing]')?.textContent === 'Suco de uva',
    rowSel('7897001234564'), { timeout: 6000 });
  check('the chip redraws in place, with no page reload',
    (await page.textContent(rowSel('7897001234564') + ' [data-ing]')) === 'Suco de uva');
  const setCall = state.calls.filter(c => c.action === 'insumo_set_ingredient').pop();
  check('a new ingredient is sent by NAME, for the API to find-or-create',
    setCall && setCall.ingredient_name === 'Suco de uva' &&
    setCall.ingredient_id === undefined);

  // THE case the whole two-level model exists for: a second brand of
  // something already categorised should find the existing ingredient
  // rather than inventing a parallel one.
  // This row has never been in stock, so it lives in the collapsed half.
  // Open it only if a re-render has closed it since.
  if (await page.locator('#out-card').evaluate(el => el.classList.contains('hidden'))) {
    await page.click('#toggle-empty');
    await page.waitForFunction(
      () => !document.getElementById('out-card').classList.contains('hidden'),
      null, { timeout: 4000 });
  }
  await page.click(rowSel('7898215151999') + ' [data-ing]');
  await page.waitForSelector('#ing-list', { timeout: 6000 });
  await page.screenshot({ path: path.join(SHOTS, 'ingrediente.png'), animations: 'disabled' });
  const firstOpt = await page.textContent('#ing-list .ing-opt .nm');
  check('the likely ingredient is ranked first for another brand of it, got: ' + firstOpt,
    firstOpt.includes('Leite condensado'));
  check('and marked as a suggestion rather than chosen for you',
    (await page.$('#ing-list .ing-opt .hintbadge')) !== null);
  await page.click('#ing-list [data-pick="I1"]');
  await page.waitForFunction(
    (sel) => document.querySelector(sel + ' [data-ing]')?.textContent === 'Leite condensado',
    rowSel('7898215151999'), { timeout: 6000 });
  const pickCall = state.calls.filter(c => c.action === 'insumo_set_ingredient').pop();
  check('picking an existing one sends its id, so two brands share ONE ingredient',
    pickCall && pickCall.ingredient_id === 'I1');
  check('which is what makes both brands answer the same question',
    INSUMOS.filter(p => p.ingredient && p.ingredient.id === 'I1').length === 2);

  await page.screenshot({ path: path.join(SHOTS, 'estoque.png'), fullPage: true });

  // ================= insumos.html =================
  await page.goto(BASE + 'insumos.html');
  await page.waitForSelector('#cat-card', { timeout: 8000 });

  check('the catalogue lists every insumo',
    (await page.$$('#cat-card .row')).length === 5);
  await page.screenshot({ path: path.join(SHOTS, 'insumos.png'), fullPage: true });
  check('each row carries its pantry count, got: ' +
      await page.textContent(rowSel('7891000100103') + ' .stock-badge'),
    (await page.textContent(rowSel('7891000100103') + ' .stock-badge')).trim() === '3 un');
  check('a shouted brand is tidied at render, got: ' +
      await page.textContent(rowSel('7891000100103') + ' .meta'),
    (await page.textContent(rowSel('7891000100103') + ' .meta')).includes('Nestlé'));

  await page.fill('#search', 'bolacha');
  await page.waitForFunction(
    () => document.querySelectorAll('.row[data-gtin]').length === 1, null, { timeout: 6000 });
  check('the catalogue searches too', (await page.$(rowSel('7896004700236'))) !== null);
  await page.fill('#search', '');
  await page.waitForFunction(
    () => document.querySelectorAll('.row[data-gtin]').length === 5, null, { timeout: 6000 });

  // Same accent-insensitive rule on Insumos: NESTLÉ's own brand, typed
  // without the accent.
  await page.fill('#search', 'nestle');
  await page.waitForFunction(
    () => document.querySelectorAll('.row[data-gtin]').length === 1, null, { timeout: 6000 });
  check('Insumos search is accent-insensitive: "nestle" still finds "NESTLÉ"',
    (await page.$(rowSel('7891000100103'))) !== null);
  await page.fill('#search', '');
  await page.waitForFunction(
    () => document.querySelectorAll('.row[data-gtin]').length === 5, null, { timeout: 6000 });

  // --- detail sheet ---
  await page.click(rowSel('7891000100103') + ' .body');
  await page.waitForSelector('.ins-head', { timeout: 6000 });
  check('the detail sheet shows the pantry count',
    (await page.textContent('.stock-line .big')) === '3');
  check('and what it adds up to, got: ' + await page.textContent('.stock-line'),
    (await page.textContent('.stock-line')).includes('1,185 kg'));

  check('a price series is drawn as a chart', (await page.$('svg.chart')) !== null);
  check('one dot per price point, got: ' + (await page.$$('svg.chart .dot')).length,
    (await page.$$('svg.chart .dot')).length === 3);
  check('the cheapest and dearest are labelled, and nothing else is',
    (await page.$$eval('svg.chart .lbl.val', els => els.map(e => e.textContent)))
      .join('|').replace(/ /g, ' ') === 'R$ 8,20|R$ 6,90');
  check('the same numbers are readable as text, not only as a picture',
    (await page.$$('.plist .prow')).length === 3);
  // An SVG chart that cannot be interrogated is decoration.
  await page.click('svg.chart .hit[data-i="0"]');
  await page.waitForSelector('.chart-tip.show', { timeout: 4000 });
  check('a point can be tapped for its date and price, got: ' +
      await page.textContent('.chart-tip'),
    (await page.textContent('.chart-tip')).includes('01/06/2026'));

  check('the movement ledger is listed', (await page.$$('#mov-card .mov')).length > 0);
  await page.screenshot({ path: path.join(SHOTS, 'insumo_detalhe.png'), fullPage: true });

  // --- editing catalogue metadata: the whole reason this page exists ---
  await page.click('#edit-insumo');
  await page.waitForSelector('#pe-name', { timeout: 6000 });
  check('the editor prefills the stored size as the packaging reads it, got: ' +
      await page.inputValue('#pe-net-qty') + await page.inputValue('#pe-net-unit'),
    (await page.inputValue('#pe-net-qty')) === '395' &&
    (await page.inputValue('#pe-net-unit')) === 'g');
  await page.fill('#pe-name', 'Leite Condensado Moça');
  await page.fill('#pe-net-qty', '1,5');
  await page.selectOption('#pe-net-unit', 'kg');
  await page.click('#pe-ok');
  // .ins-head is already on the page from before this edit (the modal is
  // an overlay, not a replacement of the sheet underneath), so waiting on
  // its mere presence can resolve before insumo_upsert even returns —
  // this raced under real network latency (a slow insumo_upsert) even
  // though it never did against this fake's near-instant responses. Wait
  // for the redrawn name itself, the same "wait for the state to settle"
  // rule as waitQty()/the movement-delete fix above.
  await page.waitForFunction(
    () => document.querySelector('.ins-title .name')?.textContent === 'Leite Condensado Moça',
    null, { timeout: 6000 });

  const upsert = state.calls.filter(c => c.action === 'insumo_upsert').pop();
  check('the edit reaches the catalogue', !!upsert);
  check('the size is normalized to the stored pair, got: ' +
      (upsert && upsert.net_qty + upsert.net_unit),
    upsert && upsert.net_qty === 1500 && upsert.net_unit === 'g');
  check('the name is saved', upsert && upsert.name === 'Leite Condensado Moça');
  check('and the sheet redraws with it, got: ' + await page.textContent('.ins-title .name'),
    (await page.textContent('.ins-title .name')) === 'Leite Condensado Moça');

  // An amount with no unit is refused rather than defaulted to grams —
  // reading 1,5 as 1,5 g when the box says 1,5 kg corrupts exactly the
  // number recipes will add up.
  await page.click('#edit-insumo');
  await page.waitForSelector('#pe-net-qty', { timeout: 6000 });
  await page.selectOption('#pe-net-unit', '');
  const upsertsBefore = state.calls.filter(c => c.action === 'insumo_upsert').length;
  page.once('dialog', d => d.dismiss());
  await page.click('#pe-ok');
  check('an amount with no unit is refused', (await page.$('#pe-net-qty')) !== null &&
    state.calls.filter(c => c.action === 'insumo_upsert').length === upsertsBefore);
  await page.click('#pe-cancel');

  // --- an insumo with a single price has no shape to draw ---
  await page.click('#back');
  await page.waitForSelector('#cat-card', { timeout: 6000 });
  await page.click(rowSel('7891234567895') + ' .body');
  await page.waitForSelector('.ins-head', { timeout: 6000 });
  check('one price is not a history, so no chart is drawn',
    (await page.$('svg.chart')) === null && (await page.$$('.plist .prow')).length === 1);

  // --- removing a mis-tapped ledger entry ---
  const movsBefore = (await page.$$('#mov-card .mov')).length;
  const ledgerBefore = state.movements.length;
  await page.click('#mov-card .mov [data-del-mov]');
  // An in-page modal, not a native confirm() — the convention across every
  // page here is that a decision gets a real dialog.
  await page.waitForSelector('#confirm-ok', { timeout: 6000 });
  await page.click('#confirm-ok');
  await page.waitForFunction(
    (n) => document.querySelectorAll('#mov-card .mov').length === n - 1,
    movsBefore, { timeout: 6000 });
  // Re-reading the DOM here was flaky: deleting a movement also kicks a
  // full detail reload, and a $$ landing inside that reload's
  // "Carregando…" window counted 0 rows even though the waitForFunction
  // above had already proved the delete rendered. Assert the fake's own
  // ledger instead — the row count is what waitForFunction just settled.
  check('a movement can be removed when it was a mis-tap',
    state.movements.length === ledgerBefore - 1);

  // --- the ingredient, from the catalogue side ---
  await page.click('#back');
  await page.waitForSelector('#cat-card', { timeout: 6000 });
  check('every catalogue row shows its ingredient, blanks included',
    (await page.$$('#cat-card .ing-tag')).length === 5 &&
    (await page.$$('#cat-card .ing-tag.none')).length === 2);
  await page.click(rowSel('7896004700236') + ' .body');
  await page.waitForSelector('.ing-line', { timeout: 6000 });
  check('the detail sheet says when nothing is set, got: ' +
      await page.textContent('.ing-line .val'),
    (await page.textContent('.ing-line .val')) === 'não definido');
  await page.click('#set-ing');
  await page.waitForSelector('#ing-list', { timeout: 6000 });
  // Deliberately a word that appears NOWHERE in this insumo's name or
  // brand, so the search assertion below can only pass via the ingredient.
  await page.fill('#ing-q', 'Biscoito');
  await page.click('#ing-list [data-create]');
  // `.ing-line` is present BEFORE the ingredient is set too, so waiting on
  // it resolves against the stale render — wait for the link that only
  // exists once one is actually assigned.
  await page.waitForSelector('.ing-line .ing-link', { timeout: 6000 });
  check('and shows the ingredient once it is set, got: ' +
      await page.textContent('.ing-line .val'),
    (await page.textContent('.ing-line .val')).trim().replace(/\s*→$/, '') === 'Biscoito');
  // …and links through to Ingredientes, which owns rename/remove and the
  // combined pantry total across every brand of the same thing.
  check('the ingredient links through to the Ingredientes page',
    /^ingredientes\.html\?id=/.test(await page.getAttribute('.ing-line .ing-link', 'href') || ''));

  // Searching by ingredient is the payoff: what a thing IS, not what the
  // package happens to be called.
  await page.click('#back');
  await page.waitForSelector('#cat-card', { timeout: 6000 });
  await page.fill('#search', 'biscoito');
  await page.waitForFunction(
    () => document.querySelectorAll('.row[data-gtin]').length === 1, null, { timeout: 6000 });
  check('an insumo is findable by an ingredient its own name never mentions',
    (await page.$(rowSel('7896004700236'))) !== null);
  await page.fill('#search', '');
  await page.waitForFunction(
    () => document.querySelectorAll('.row[data-gtin]').length === 5, null, { timeout: 6000 });

  // Clearing has to be reachable, or a mis-tap is permanent.
  await page.click(rowSel('7896004700236') + ' .body');
  await page.waitForSelector('#set-ing', { timeout: 6000 });
  await page.click('#set-ing');
  await page.waitForSelector('#ing-list [data-clear]', { timeout: 6000 });
  await page.click('#ing-list [data-clear]');
  await page.waitForFunction(
    () => document.querySelector('.ing-line .val')?.textContent === 'não definido',
    null, { timeout: 6000 });
  check('the link can be cleared again',
    (await page.textContent('.ing-line .val')) === 'não definido');
  const clearCall = state.calls.filter(c => c.action === 'insumo_set_ingredient').pop();
  check('clearing sends an explicit null, never an omitted field',
    clearCall && clearCall.ingredient_id === null);

  // --- removing an insumo from the catalogue ---
  //
  // The refusal-first rule matters here: this insumo has a price history,
  // so the first attempt must come back refused and the user must be told
  // what deleting it would destroy BEFORE it happens.
  await page.click('#back');
  await page.waitForSelector('#cat-card', { timeout: 6000 });
  await page.click(rowSel('7897001234564') + ' .body');
  await page.waitForSelector('#del-insumo', { timeout: 6000 });
  await page.click('#del-insumo');
  await page.waitForSelector('#confirm-ok', { timeout: 6000 });
  await page.click('#confirm-cancel');
  await page.waitForSelector('.modal-card', { state: 'detached', timeout: 6000 });
  check('backing out of the first confirmation writes nothing',
    state.calls.filter(c => c.action === 'insumo_delete').length === 0 &&
    INSUMOS.some(p => p.gtin === '7897001234564'));

  await page.click('#del-insumo');
  await page.waitForSelector('#confirm-ok', { timeout: 6000 });
  await page.click('#confirm-ok');
  // Second dialog: the API refused, and this one is built from ITS numbers.
  await page.waitForFunction(
    () => document.querySelector('#confirm-ok')?.textContent === 'Remover mesmo assim',
    null, { timeout: 6000 });
  await page.screenshot({ path: path.join(SHOTS, 'remover.png'), animations: 'disabled' });
  const warning = await page.textContent('.modal-card p');
  check('the warning names the stock that would go, got: ' + warning,
    warning.includes('2 pacotes'));
  check('and the ledger entries that would go with it', warning.includes('movimenta'));
  const firstDelete = state.calls.filter(c => c.action === 'insumo_delete').pop();
  check('the first call carries no force — it asks, it does not delete',
    firstDelete && !firstDelete.force);
  check('and nothing is deleted while the second dialog is still open',
    INSUMOS.some(p => p.gtin === '7897001234564'));

  await page.click('#confirm-cancel');
  await page.waitForSelector('.modal-card', { state: 'detached', timeout: 6000 });
  check('declining the second dialog also writes nothing',
    INSUMOS.some(p => p.gtin === '7897001234564'));

  await page.click('#del-insumo');
  await page.waitForSelector('#confirm-ok', { timeout: 6000 });
  await page.click('#confirm-ok');
  await page.waitForFunction(
    () => document.querySelector('#confirm-ok')?.textContent === 'Remover mesmo assim',
    null, { timeout: 6000 });
  await page.click('#confirm-ok');
  await page.waitForSelector('#cat-card', { timeout: 6000 });
  const forced = state.calls.filter(c => c.action === 'insumo_delete').pop();
  check('confirming twice is what actually deletes, and it says so', forced && forced.force === true);
  check('the insumo is gone from the catalogue',
    !INSUMOS.some(p => p.gtin === '7897001234564') &&
    (await page.$(rowSel('7897001234564'))) === null);
  check('and the page returns to the catalogue rather than a dead sheet',
    (await page.$$('#cat-card .row')).length === 4);

  // An insumo with nothing to lose is deleted on the first confirmation —
  // the second dialog exists for history, not as a ritual.
  await page.click(rowSel('7898215151999') + ' .body');
  await page.waitForSelector('#del-insumo', { timeout: 6000 });
  await page.click('#del-insumo');
  await page.waitForSelector('#confirm-ok', { timeout: 6000 });
  await page.click('#confirm-ok');
  await page.waitForSelector('#cat-card', { timeout: 6000 });
  check('a barcode scanned by mistake goes in one step',
    !INSUMOS.some(p => p.gtin === '7898215151999') &&
    (await page.$$('#cat-card .row')).length === 3);

  // --- the deep link between the two pages ---
  await page.goto(BASE + 'insumos.html?gtin=7896004700236');
  await page.waitForSelector('.ins-head', { timeout: 8000 });
  check('a deep link opens straight on the insumo, got: ' +
      await page.textContent('.ins-title .name'),
    (await page.textContent('.ins-title .name')) === 'Bolacha Maria');
  check('and the url is cleaned up so a reload is not stuck on it',
    !(await page.evaluate(() => location.search)));

  // This one has never been in stock, so it also proves the pantry link
  // opens the collapsed half rather than scrolling to a hidden row.
  await page.goto(BASE + 'estoque.html?gtin=7896004700236');
  await page.waitForSelector('#in-card', { timeout: 8000 });
  await page.waitForSelector(rowSel('7896004700236') + '.flash', { timeout: 4000 });
  check('and the pantry link points at the right row',
    (await page.$(rowSel('7896004700236') + '.flash')) !== null);

  await page.screenshot({ path: path.join(SHOTS, 'deeplink.png'), fullPage: true });
  await browser.close();
  server.close();
  if (process.env.KEEP_SHOTS) console.log('screenshots: ' + SHOTS);

  console.log('--- JS errors ---');
  console.log(errors.length ? errors.join('\n') : '(none)');
  console.log('--- failures ---');
  console.log(failures.length ? failures.join('\n') : '(none)');
  process.exit(failures.length || errors.length ? 1 : 0);
})();
