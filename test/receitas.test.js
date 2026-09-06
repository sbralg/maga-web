// Headless UI test for receitas.html — a Receita costs itself from
// Insumos (via the abstract ingredient) and optionally other Receitas.
// Covers: create, add an ingredient line, the cost breakdown math (both
// the batch total AND each line's own unit/line cost), a nested
// sub-recipe line, an ingredient with no purchase history showing as
// "incomplete" rather than a wrong 0, batch-scaling display (ephemeral,
// never saved), the refusal-first delete when a recipe is in use, and the
// "Categoria" control that creates/removes a linked manufaturado Produto
// and renders its packaging/cost/margins panel inline (shared with
// produtos.html via shared-produto-panel.js).
//
//   node test/receitas.test.js          # exits non-zero on any failure
//   KEEP_SHOTS=1 node test/...          # also prints where screenshots went
//
// The fake keeps REAL relational math — receitaCostFor's exact formula is
// reimplemented here against the fake's own receita_itens/ingredient cost
// map, the same "don't fake away the interesting half" convention as
// eventos.test.js/stock.test.js.
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
const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), 'receitas-test-'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
                '.css': 'text/css', '.png': 'image/png' };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(WEB_DIR, rel || 'receitas.html');
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

const state = { receitas: [], itens: [], ingredients: [], produtos: [], fornecedores: [], seq: 0 };
const uid = (p) => p + (++state.seq);
function receitaOf(id) { return state.receitas.find(r => r.id === id); }
function ingredientOf(id) { return state.ingredients.find(i => i.id === id); }
function produtoOf(id) { return state.produtos.find(p => p.id === id); }
function linkedProdutoFor(receitaId) {
  return state.produtos.find(p => p.kind === 'manufaturado' && p.receita_id === receitaId) || null;
}

// Mirrors ingredientUnitCost() server-side: cost per base unit, or null
// (never 0) when the ingredient has no last_cost recorded.
function ingredientUnitCost(ing) {
  if (!ing || ing.last_cost == null || !ing.net_qty) return null;
  return ing.last_cost / ing.net_qty;
}

// Mirrors receitaCostFor() exactly — the household's real spreadsheet
// formula, ported. item_costs mirrors the per-line unit_cost/line_cost map
// the backend now returns alongside the batch total.
function computeReceitaCost(receitaId, visiting) {
  visiting = visiting || new Set();
  if (visiting.has(receitaId)) return { error: 'cyclic recipe reference' };
  visiting.add(receitaId);
  const r = receitaOf(receitaId);
  if (!r) return { error: 'unknown receita' };
  const itens = state.itens.filter(it => it.receita_id === receitaId);
  let batch_cost = 0;
  const incomplete = [];
  const item_costs = {};
  for (const it of itens) {
    if (it.kind === 'ingrediente') {
      const ing = ingredientOf(it.ingredient_id);
      const uc = ingredientUnitCost(ing);
      if (uc == null) { incomplete.push(ing ? ing.name : '?'); continue; }
      batch_cost += it.quantity * uc;
      item_costs[it.id] = { unit_cost: uc, line_cost: it.quantity * uc };
    } else {
      const sub = computeReceitaCost(it.sub_receita_id, visiting);
      const subR = receitaOf(it.sub_receita_id);
      if (sub.error) { incomplete.push((subR ? subR.name : '?') + ' (' + sub.error + ')'); continue; }
      incomplete.push(...sub.incomplete);
      batch_cost += it.quantity * sub.cost_per_yield_unit;
      item_costs[it.id] = { unit_cost: sub.cost_per_yield_unit, line_cost: it.quantity * sub.cost_per_yield_unit };
    }
  }
  visiting.delete(receitaId);
  const batch_cost_with_margin = batch_cost / (1 - Number(r.safety_margin_pct || 0));
  const prep_labor_cost = (r.prep_minutes && r.labor_rate_per_hour)
    ? (r.prep_minutes / 60) * r.labor_rate_per_hour : 0;
  const cost_per_yield_unit = (batch_cost_with_margin + prep_labor_cost) / r.yield_qty;
  return { cost_per_yield_unit, batch_cost, batch_cost_with_margin, prep_labor_cost, incomplete, item_costs };
}

// Mirrors produtoCostFor()'s manufaturado branch — the only kind this
// suite's Categoria section ever creates.
function computeProdutoCost(id) {
  const p = produtoOf(id);
  const incomplete = [];
  let cost_per_yield_unit = null;
  const rc = computeReceitaCost(p.receita_id);
  if (rc.error) incomplete.push(rc.error);
  else { cost_per_yield_unit = rc.cost_per_yield_unit; incomplete.push(...rc.incomplete); }
  const custo_ingredientes_pacote = cost_per_yield_unit == null ? null : cost_per_yield_unit * p.items_per_package;
  const custo_total_por_unidade = custo_ingredientes_pacote; // no embalagens in this suite
  let preco_atacado = null, lucro_atacado = null, preco_distribuidor = null, lucro_distribuidor = null, preco_varejo_sugerido = null;
  if (custo_total_por_unidade != null) {
    preco_atacado = custo_total_por_unidade / (1 - p.margin_atacado);
    lucro_atacado = preco_atacado - custo_total_por_unidade;
    preco_distribuidor = preco_atacado * (1 - p.margin_distribuidor);
    lucro_distribuidor = preco_distribuidor - custo_total_por_unidade;
    preco_varejo_sugerido = preco_atacado / (1 - p.margin_varejo);
  }
  return {
    cost_per_yield_unit, custo_ingredientes_pacote, custo_embalagem: 0, custo_total_embalagem: 0,
    custo_total_por_unidade, preco_atacado, lucro_atacado, preco_distribuidor, lucro_distribuidor,
    preco_varejo_sugerido, incomplete, custo_embalagens: {},
  };
}

(async () => {
  const failures = [];
  const server = await serve();
  const PAGE = 'http://127.0.0.1:' + server.address().port + '/receitas.html';
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 414, height: 900 } });

  const errors = [];
  ctx.on('weberror', e => errors.push('pageerror: ' + e.error().message));

  await ctx.route('**/functions/v1/maga-api', async route => {
    const body = route.request().postDataJSON();
    let resp;
    if (body.action === 'ingredients') {
      resp = { ingredients: state.ingredients.map(i => ({
        id: i.id, name: i.name, base_unit: i.base_unit, kind: i.kind, insumo_count: 1,
      })) };
    } else if (body.action === 'receitas') {
      resp = { receitas: state.receitas.map(r => ({
        ...r, item_count: state.itens.filter(it => it.receita_id === r.id).length,
      })) };
    } else if (body.action === 'receita_create') {
      const r = {
        id: uid('R'), name: body.name, yield_qty: body.yield_qty, yield_unit: body.yield_unit,
        safety_margin_pct: body.safety_margin_pct || 0, prep_minutes: body.prep_minutes ?? null,
        labor_rate_per_hour: body.labor_rate_per_hour ?? null, notes: body.notes ?? null,
      };
      state.receitas.push(r);
      resp = { ok: true, receita: r };
    } else if (body.action === 'receita_update') {
      const r = receitaOf(body.id);
      ['name', 'yield_qty', 'yield_unit', 'safety_margin_pct', 'prep_minutes',
        'labor_rate_per_hour', 'notes'].forEach(k => { if (k in body) r[k] = body[k]; });
      resp = { ok: true, receita: r };
    } else if (body.action === 'receita_delete') {
      const r = receitaOf(body.id);
      const usedByReceitas = state.itens
        .filter(it => it.kind === 'receita' && it.sub_receita_id === body.id)
        .map(it => receitaOf(it.receita_id).name);
      if (usedByReceitas.length > 0) {
        resp = { error: 'receita is in use', name: r.name, used_by_receitas: usedByReceitas, used_by_produtos: [] };
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify(resp) });
        return;
      }
      state.receitas = state.receitas.filter(x => x.id !== body.id);
      state.itens = state.itens.filter(it => it.receita_id !== body.id);
      resp = { ok: true, id: body.id, name: r.name };
    } else if (body.action === 'receita_item_add') {
      const it = {
        id: uid('RI'), receita_id: body.receita_id, kind: body.kind,
        ingredient_id: body.ingredient_id ?? null, sub_receita_id: body.sub_receita_id ?? null,
        quantity: body.quantity,
      };
      state.itens.push(it);
      resp = { ok: true, item: it };
    } else if (body.action === 'receita_item_update') {
      const it = state.itens.find(x => x.id === body.id);
      it.quantity = body.quantity;
      resp = { ok: true, item: it };
    } else if (body.action === 'receita_item_delete') {
      const it = state.itens.find(x => x.id === body.id);
      state.itens = state.itens.filter(x => x.id !== body.id);
      resp = { ok: true, id: body.id, receita_id: it ? it.receita_id : null };
    } else if (body.action === 'receita_detail') {
      const r = receitaOf(body.id);
      if (!r) { resp = { found: false, id: body.id }; }
      else {
        const itens = state.itens.filter(it => it.receita_id === r.id).map(it => ({
          ...it,
          ingredient: it.ingredient_id ? (({ id, name, base_unit, kind }) => ({ id, name, base_unit, kind }))(ingredientOf(it.ingredient_id)) : null,
          sub_receita: it.sub_receita_id ? (({ id, name, yield_qty, yield_unit }) => ({ id, name, yield_qty, yield_unit }))(receitaOf(it.sub_receita_id)) : null,
        }));
        const cost = computeReceitaCost(r.id);
        resp = {
          found: true, receita: r, itens,
          linked_produto: linkedProdutoFor(r.id),
          cost: cost.error ? null : cost,
          incomplete: cost.error ? [cost.error] : cost.incomplete,
        };
      }
    } else if (body.action === 'fornecedores') {
      resp = { fornecedores: state.fornecedores.slice() };
    } else if (body.action === 'produto_create') {
      const p = {
        id: uid('P'), name: body.name, kind: body.kind,
        receita_id: body.receita_id ?? null, cost: body.cost ?? null, fornecedor_id: body.fornecedor_id ?? null,
        items_per_package: body.items_per_package, packing_minutes: body.packing_minutes ?? null,
        packing_labor_rate_per_hour: body.packing_labor_rate_per_hour ?? null,
        margin_atacado: body.margin_atacado ?? 0.65, margin_distribuidor: body.margin_distribuidor ?? 0.3,
        margin_varejo: body.margin_varejo ?? 0.4, notes: body.notes ?? null,
      };
      state.produtos.push(p);
      resp = { ok: true, produto: p };
    } else if (body.action === 'produto_delete') {
      state.produtos = state.produtos.filter(p => p.id !== body.id);
      resp = { ok: true, id: body.id };
    } else if (body.action === 'produto_detail') {
      const p = produtoOf(body.id);
      if (!p) { resp = { found: false, id: body.id }; }
      else {
        const cost = computeProdutoCost(p.id);
        resp = {
          found: true,
          produto: { ...p, receita: { id: p.receita_id, name: receitaOf(p.receita_id).name }, fornecedor: null },
          embalagens: [], cost, incomplete: cost.incomplete,
        };
      }
    } else {
      resp = { error: 'bad action' };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resp) });
  });

  const page = await ctx.newPage();
  // Chromium logs its own "Failed to load resource" console error for ANY
  // non-2xx fetch response — including the receita_delete 400 this suite
  // deliberately triggers below to cover the refusal-first delete. That's
  // expected network noise, not an app bug, so it's excluded here the same
  // way a real JS error (thrown from app code) would not be.
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
      errors.push('console: ' + m.text());
    }
  });

  const check = (label, cond) => { if (!cond) failures.push('FAIL: ' + label); };
  const norm = (s) => s.replace(/\u00A0/g, ' ');

  await ctx.addInitScript(() => { try { localStorage.setItem('checklist_pass', 'x'); } catch (_) {} });

  // Two ingredients: one with a known cost, one never stocked.
  state.ingredients.push(
    { id: uid('I'), name: 'Farinha de Trigo', base_unit: 'g', kind: 'ingrediente', net_qty: 1000, last_cost: 2.79 },
    { id: uid('I'), name: 'Fermento Mágico', base_unit: 'g', kind: 'ingrediente', net_qty: 100, last_cost: null },
  );

  await page.goto(PAGE);
  await page.waitForSelector('#new-receita', { timeout: 6000 });
  check('empty state shows the create button', (await page.$('#new-receita')) !== null);

  // --- create a recipe: 1000 g batch yielding 1 unidade, 5% safety margin ---
  await page.click('#new-receita');
  await page.waitForSelector('#rec-name-i', { timeout: 6000 });
  await page.fill('#rec-name-i', 'Bolo de Cacau');
  await page.fill('#rec-yield', '1');
  await page.selectOption('#rec-unit', 'un');
  await page.fill('#rec-margin', '5');
  await page.click('#rec-ok');
  await page.waitForSelector('#rec-name', { timeout: 6000 });
  check('one receita exists', state.receitas.length === 1);
  check('detail shows the name', (await page.textContent('#rec-name')).includes('Bolo de Cacau'));

  const receitaId = state.receitas[0].id;

  // --- add an ingredient line: 450 g farinha ---
  await page.click('#add-item');
  await page.waitForSelector('.kind-tab[data-kind="ingrediente"]', { timeout: 6000 });
  await page.click('.pick-opt:has-text("Farinha de Trigo")');
  await page.waitForSelector('#pick-qty', { timeout: 6000 });
  await page.fill('#pick-qty', '450');
  await page.click('#qty-ok');
  await page.waitForSelector('.item-row', { timeout: 6000 });
  check('one item exists', state.itens.length === 1);
  check('item row shows the ingredient name', (await page.textContent('.item-row')).includes('Farinha de Trigo'));

  // batch_cost = 450 * (2.79/1000) = 1.2555
  // batch_cost_with_margin = 1.2555 / 0.95 = 1.321578...
  // cost_per_yield_unit = that / 1 (yield_qty=1) = same
  const totalsText = norm(await page.textContent('.totals-card'));
  check('cost breakdown shows the batch cost, got: ' + totalsText, totalsText.includes('R$ 1,26') || totalsText.includes('R$ 1,25'));
  check('no incomplete warning yet (only one, complete, line)', (await page.$('.warn-card')) === null);

  // --- the item row itself shows its own line cost (the spreadsheet's
  // "Custo do Ingrediente" column), not just the aggregate total ---
  const itemRowText = norm(await page.textContent('.item-row'));
  check('item row shows its own line cost (1,26), got: ' + itemRowText, itemRowText.includes('R$ 1,26'));

  // --- add an ingredient with NO purchase history: incomplete, not 0 ---
  await page.click('#add-item');
  await page.waitForSelector('.kind-tab[data-kind="ingrediente"]', { timeout: 6000 });
  await page.click('.pick-opt:has-text("Fermento Mágico")');
  await page.waitForSelector('#pick-qty', { timeout: 6000 });
  await page.fill('#pick-qty', '10');
  await page.click('#qty-ok');
  await page.waitForSelector('.warn-card', { timeout: 6000 });
  check('incomplete warning names the ingredient with no history',
    (await page.textContent('.warn-card')).includes('Fermento Mágico'));

  // --- batch scaling display: ephemeral, never saved ---
  await page.fill('#scale-yield', '3');
  await page.waitForSelector('.scaled', { timeout: 6000 });
  check('scaled quantity shows 3x the original (450 -> 1350), got: ' +
    norm(await page.textContent('.item-row')),
    norm(await page.textContent('#itens-card')).includes('1350'));
  check('scaling never touches the persisted quantity',
    state.itens.find(it => it.ingredient_id).quantity === 450);

  // --- nested recipe: a second receita using the first as a sub-recipe ---
  await page.click('#back');
  await page.waitForSelector('#new-receita', { timeout: 6000 });
  await page.click('#new-receita');
  await page.waitForSelector('#rec-name-i', { timeout: 6000 });
  await page.fill('#rec-name-i', 'Bolo Decorado');
  await page.fill('#rec-yield', '1');
  await page.selectOption('#rec-unit', 'un');
  await page.click('#rec-ok');
  await page.waitForSelector('#rec-name', { timeout: 6000 });
  const outerId = state.receitas.find(r => r.name === 'Bolo Decorado').id;

  await page.click('#add-item');
  await page.waitForSelector('.kind-tabs', { timeout: 6000 });
  await page.click('.kind-tab[data-kind="receita"]');
  await page.waitForSelector('.pick-opt:has-text("Bolo de Cacau")', { timeout: 6000 });
  await page.click('.pick-opt:has-text("Bolo de Cacau")');
  await page.waitForSelector('#pick-qty', { timeout: 6000 });
  await page.fill('#pick-qty', '1');
  await page.click('#qty-ok');
  await page.waitForSelector('.item-row', { timeout: 6000 });
  check('nested recipe line shows the sub-recipe name',
    (await page.textContent('.item-row')).includes('Bolo de Cacau'));
  check('nested line uses the book badge', (await page.textContent('.item-row')).includes('📖'));

  // --- delete blocked: Bolo de Cacau is now used by Bolo Decorado ---
  await page.goto(PAGE + '?id=' + receitaId);
  await page.waitForSelector('#del-receita', { timeout: 6000 });
  await page.click('#del-receita');
  await page.waitForSelector('#confirm-ok', { timeout: 6000 });
  await page.click('#confirm-ok');
  // The refusal opens its own dialog (the confirm is replaced by it), so
  // wait for THAT rather than a fixed pause.
  await page.waitForFunction(
    () => /est\u00e1 em uso por/.test(document.body.textContent || ''), null, { timeout: 6000 });
  check('the receita still exists — delete was refused', receitaOf(receitaId) !== undefined);
  // Used to assert only that #root had SOME text, which nothing could fail.
  // The API names what blocks the delete, so the page must too — that name
  // is the only thing telling you where to go next.
  check('the refusal NAMES what still uses it',
    (await page.textContent('.modal-card')).includes('Bolo Decorado'));
  await page.click('#confirm-ok');

  // --- Categoria: no linked Produto yet -> only "Ingrediente" active ---
  await page.goto(PAGE + '?id=' + outerId);
  await page.waitForSelector('#rec-categoria', { timeout: 6000 });
  await page.waitForSelector('#cat-produto-final', { timeout: 6000 });
  check('starts categorized as Ingrediente, no linked produto',
    linkedProdutoFor(outerId) === null);
  check('no "editar em Produtos" link yet', (await page.$('#rec-categoria a')) === null);

  // --- marking "Produto Final" creates a manufaturado Produto pointing
  // back at this receita, and its packaging/cost/margins panel renders
  // INLINE on the receita page — the spreadsheet's single-tab layout ---
  await page.click('#cat-produto-final');
  await page.waitForSelector('#cat-ingrediente', { timeout: 6000 });
  const lp = linkedProdutoFor(outerId);
  check('a manufaturado produto was created for this receita', lp !== null);
  check('the produto is named after the receita', lp && lp.name === 'Bolo Decorado');
  await page.waitForSelector('#rec-produto-panel .totals-card', { timeout: 6000 });
  const panelText = norm(await page.textContent('#rec-produto-panel'));
  // Bolo Decorado's own cost = 1x Bolo de Cacau's cost_per_yield_unit —
  // same batch_cost_with_margin computed earlier (Fermento Mágico's
  // incomplete-cost warning propagates through the nested recipe too).
  check('the inline panel shows a real cost, got: ' + panelText, panelText.includes('R$'));
  check('the incomplete warning propagates through the nested recipe into the produto panel',
    (await page.textContent('#rec-produto-panel')).includes('Fermento Mágico'));
  check('a link to edit packaging/margins in Produtos is offered',
    (await page.textContent('#rec-categoria')).includes('Produtos'));

  // --- reverting to "Ingrediente" removes the linked Produto ---
  await page.click('#cat-ingrediente');
  await page.waitForSelector('#confirm-ok', { timeout: 6000 });
  await page.click('#confirm-ok');
  await page.waitForSelector('#cat-produto-final', { timeout: 6000 });
  check('the linked produto was removed', linkedProdutoFor(outerId) === null);
  check('the receita itself still exists', receitaOf(outerId) !== undefined);

  // --- accent-insensitive search (foldSearchText): an unaccented typed
  // term matches a receita name stored WITH accents, and a genuinely
  // different term still doesn't match (no over-matching) ---
  await page.click('#back');
  await page.waitForSelector('#new-receita', { timeout: 6000 });
  await page.click('#new-receita');
  await page.waitForSelector('#rec-name-i', { timeout: 6000 });
  await page.fill('#rec-name-i', 'Café da Manhã');
  await page.fill('#rec-yield', '1');
  await page.selectOption('#rec-unit', 'un');
  await page.click('#rec-ok');
  await page.waitForSelector('#rec-name', { timeout: 6000 });
  check('the accented receita was created', state.receitas.some(r => r.name === 'Café da Manhã'));
  await page.click('#back');
  await page.waitForSelector('#search', { timeout: 6000 });

  await page.fill('#search', 'cafe da manha');
  await page.waitForFunction(
    () => (document.getElementById('root').textContent || '').includes('Café da Manhã'),
    null, { timeout: 6000 });
  check('unaccented search "cafe da manha" matches the accented receita name "Café da Manhã", got: ' +
    await page.textContent('#root'),
    (await page.textContent('#root')).includes('Café da Manhã'));

  await page.fill('#search', 'zzzznotfound');
  await page.waitForFunction(() => document.getElementById('no-match') !== null, null, { timeout: 6000 });
  check('an unrelated search term does not match the accented receita (no over-matching)',
    !(await page.textContent('#root')).includes('Café da Manhã'));

  await page.screenshot({ path: path.join(SHOTS, 'receita_detalhe.png'), fullPage: true });
  await browser.close();
  server.close();
  if (process.env.KEEP_SHOTS) console.log('screenshots: ' + SHOTS);

  console.log('--- JS errors ---');
  console.log(errors.length ? errors.join('\n') : '(none)');
  console.log('--- failures ---');
  console.log(failures.length ? failures.join('\n') : '(none)');
  process.exit(failures.length || errors.length ? 1 : 0);
})();
