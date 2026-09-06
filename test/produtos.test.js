// Headless UI test for produtos.html — a sellable item, either
// manufactured via a Receita or "comprado" (priced directly by hand, with
// an optional Fornecedor attached purely as reference metadata — NOT
// routed through the ingredient/stock pipeline, since real usage showed
// fornecedor-sourced items are almost never consumed by a recipe and are
// bought on demand per event, not stocked; see maga-api's module
// comment above produtoCostFor). Covers: a manufaturado produto's full
// pricing breakdown (custo -> atacado -> distribuidor -> varejo), a
// comprado produto priced directly with a fornecedor attached, an
// embalagem line (with its own per-line cost), the reverse "I want to
// sell at this retail price" calculator (pure client-side arithmetic),
// and the incomplete-cost warning for both an unset comprado cost and a
// never-stocked embalagem ingredient.
//
//   node test/produtos.test.js          # exits non-zero on any failure
//   KEEP_SHOTS=1 node test/...          # also prints where screenshots went
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
const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), 'produtos-test-'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
                '.css': 'text/css', '.png': 'image/png' };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(WEB_DIR, rel || 'produtos.html');
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

const state = { produtos: [], embalagens: [], receitas: [], ingredients: [], fornecedores: [], seq: 0 };
const uid = (p) => p + (++state.seq);
function produtoOf(id) { return state.produtos.find(p => p.id === id); }
function ingredientOf(id) { return state.ingredients.find(i => i.id === id); }
function receitaOf(id) { return state.receitas.find(r => r.id === id); }
function fornecedorOf(id) { return state.fornecedores.find(f => f.id === id); }
function ingredientUnitCost(ing) {
  if (!ing || ing.last_cost == null || !ing.net_qty) return null;
  return ing.last_cost / ing.net_qty;
}
function produtoRef(p) {
  return {
    ...p,
    receita: p.receita_id ? { id: p.receita_id, name: receitaOf(p.receita_id).name } : null,
    fornecedor: p.fornecedor_id ? { id: p.fornecedor_id, name: fornecedorOf(p.fornecedor_id).name } : null,
  };
}

// Mirrors produtoCostFor() exactly — one function, one incomplete signal,
// whether manufaturado (via a Receita) or comprado (a direct `cost` field,
// no ingredient/stock pipeline).
function computeProdutoCost(id) {
  const p = produtoOf(id);
  const incomplete = [];
  let cost_per_yield_unit = null;
  if (p.kind === 'manufaturado') {
    // Test recipes here are single-ingredient, no nesting — enough to
    // exercise the produto side without re-deriving receitaCostFor.
    const r = receitaOf(p.receita_id);
    cost_per_yield_unit = r.cost_per_yield_unit;
    if (cost_per_yield_unit == null) incomplete.push('receita sem custo');
  } else {
    cost_per_yield_unit = p.cost ?? null;
    if (cost_per_yield_unit == null) incomplete.push('custo não informado');
  }
  const embs = state.embalagens.filter(e => e.produto_id === id);
  let custo_embalagem = 0;
  const custo_embalagens = {};
  for (const e of embs) {
    const ing = ingredientOf(e.ingredient_id);
    const uc = ingredientUnitCost(ing);
    if (uc == null) { incomplete.push(ing ? ing.name : '?'); continue; }
    const lineCost = e.quantity * uc;
    custo_embalagem += lineCost;
    custo_embalagens[e.id] = lineCost;
  }
  const custo_total_embalagem = custo_embalagem;
  const custo_ingredientes_pacote = cost_per_yield_unit == null ? null : cost_per_yield_unit * p.items_per_package;
  const custo_total_por_unidade = custo_ingredientes_pacote == null ? null : custo_ingredientes_pacote + custo_total_embalagem;
  let preco_atacado = null, lucro_atacado = null, preco_distribuidor = null, lucro_distribuidor = null, preco_varejo_sugerido = null;
  if (custo_total_por_unidade != null) {
    preco_atacado = custo_total_por_unidade / (1 - p.margin_atacado);
    lucro_atacado = preco_atacado - custo_total_por_unidade;
    preco_distribuidor = preco_atacado * (1 - p.margin_distribuidor);
    lucro_distribuidor = preco_distribuidor - custo_total_por_unidade;
    preco_varejo_sugerido = preco_atacado / (1 - p.margin_varejo);
  }
  return {
    cost_per_yield_unit, custo_ingredientes_pacote, custo_embalagem, custo_total_embalagem,
    custo_total_por_unidade, preco_atacado, lucro_atacado, preco_distribuidor, lucro_distribuidor,
    preco_varejo_sugerido, incomplete, custo_embalagens,
  };
}

(async () => {
  const failures = [];
  const server = await serve();
  const PAGE = 'http://127.0.0.1:' + server.address().port + '/produtos.html';
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
      resp = { receitas: state.receitas.slice() };
    } else if (body.action === 'fornecedores') {
      resp = { fornecedores: state.fornecedores.slice() };
    } else if (body.action === 'produtos') {
      resp = { produtos: state.produtos.map(produtoRef) };
    } else if (body.action === 'produto_create') {
      const p = {
        id: uid('P'), name: body.name, kind: body.kind,
        receita_id: body.receita_id ?? null,
        cost: body.cost ?? null, fornecedor_id: body.fornecedor_id ?? null,
        items_per_package: body.items_per_package, packing_minutes: body.packing_minutes ?? null,
        packing_labor_rate_per_hour: body.packing_labor_rate_per_hour ?? null,
        margin_atacado: body.margin_atacado, margin_distribuidor: body.margin_distribuidor,
        margin_varejo: body.margin_varejo, notes: body.notes ?? null,
      };
      state.produtos.push(p);
      resp = { ok: true, produto: produtoRef(p) };
    } else if (body.action === 'produto_update') {
      const p = produtoOf(body.id);
      Object.assign(p, body);
      resp = { ok: true, produto: produtoRef(p) };
    } else if (body.action === 'produto_delete') {
      state.produtos = state.produtos.filter(p => p.id !== body.id);
      state.embalagens = state.embalagens.filter(e => e.produto_id !== body.id);
      resp = { ok: true, id: body.id };
    } else if (body.action === 'produto_embalagem_add') {
      const e = { id: uid('PE'), produto_id: body.produto_id, ingredient_id: body.ingredient_id, quantity: body.quantity };
      state.embalagens.push(e);
      resp = { ok: true, embalagem: e };
    } else if (body.action === 'produto_embalagem_delete') {
      state.embalagens = state.embalagens.filter(e => e.id !== body.id);
      resp = { ok: true, id: body.id };
    } else if (body.action === 'produto_detail') {
      const p = produtoOf(body.id);
      if (!p) { resp = { found: false, id: body.id }; }
      else {
        const embalagens = state.embalagens.filter(e => e.produto_id === p.id).map(e => ({
          ...e, ingredient: (({ id, name, base_unit, kind }) => ({ id, name, base_unit, kind }))(ingredientOf(e.ingredient_id)),
        }));
        const cost = computeProdutoCost(p.id);
        resp = {
          found: true,
          produto: produtoRef(p),
          embalagens, cost, incomplete: cost.incomplete,
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

  state.receitas.push({ id: uid('R'), name: 'Bolo de Cacau', yield_qty: 1, yield_unit: 'un', cost_per_yield_unit: 20 });
  state.ingredients.push(
    { id: uid('I'), name: 'Caixinha', base_unit: 'un', kind: 'embalagem', net_qty: 1, last_cost: 0.05 },
    { id: uid('I'), name: 'Fita Sem Estoque', base_unit: 'cm', kind: 'embalagem', net_qty: null, last_cost: null },
  );
  state.fornecedores.push({ id: uid('F'), name: 'Padaria Ceci' });

  await page.goto(PAGE);
  await page.waitForSelector('#new-produto', { timeout: 6000 });

  // --- manufaturado produto: costs itself via the recipe ---
  await page.click('#new-produto');
  await page.waitForSelector('#pr-name-i', { timeout: 6000 });
  await page.fill('#pr-name-i', 'Bolo de Cacau (venda)');
  await page.click('#pr-source');
  await page.waitForSelector('.pick-opt:has-text("Bolo de Cacau")', { timeout: 6000 });
  await page.click('.pick-opt:has-text("Bolo de Cacau")');
  await page.waitForSelector('#pr-source:has-text("Bolo de Cacau")', { timeout: 6000 });
  await page.fill('#pr-m-atacado', '65');
  await page.click('#pr-ok');
  await page.waitForSelector('#prod-name', { timeout: 6000 });
  check('one produto exists', state.produtos.length === 1);
  check('kind badge shows manufaturado', (await page.textContent('#root')).includes('Manufaturado'));

  // custo_total_por_unidade = 20 (1 item per package, no embalagem yet)
  // preco_atacado = 20 / (1-0.65) = 57.142857...
  let totalsText = norm(await page.textContent('.totals-card'));
  check('cost total shows R$ 20,00, got: ' + totalsText, totalsText.includes('R$ 20,00'));
  check('preço atacado shows R$ 57,14', totalsText.includes('R$ 57,14'));

  const manufId = state.produtos[0].id;

  // --- add an embalagem line ---
  await page.click('#pp-add-emb');
  await page.waitForSelector('.pick-opt:has-text("Caixinha")', { timeout: 6000 });
  await page.click('.pick-opt:has-text("Caixinha")');
  await page.waitForSelector('#emb-qty', { timeout: 6000 });
  await page.fill('#emb-qty', '1');
  await page.click('#emb-ok');
  await page.waitForSelector('.item-row', { timeout: 6000 });
  check('one embalagem line exists', state.embalagens.length === 1);
  // custo_total_por_unidade = 20 + 0.05 = 20.05
  totalsText = norm(await page.textContent('.totals-card'));
  check('cost total now includes the embalagem, got: ' + totalsText, totalsText.includes('R$ 20,05'));
  // the embalagem ROW itself shows its own line cost (R$ 0,05)
  const embRowText = norm(await page.textContent('.item-row'));
  check('embalagem row shows its own line cost, got: ' + embRowText, embRowText.includes('R$ 0,05'));

  // --- reverse calculator: pure client-side, no round trip ---
  await page.waitForSelector('#pp-rev-varejo', { timeout: 6000 });
  await page.fill('#pp-rev-varejo', '10000'); // cents-first: R$ 100,00
  await page.waitForSelector('#pp-rev-out p', { timeout: 6000 });
  const revText = norm(await page.textContent('#pp-rev-out'));
  // margin_varejo defaults to 40%: atacado = 100 * (1-0.4) = 60
  // custo = 60 * (1 - 0.65) = 21
  check('reverse calc derives the required atacado price, got: ' + revText, revText.includes('R$ 60,00'));
  check('reverse calc derives the required cost', revText.includes('R$ 21,00'));

  // --- comprado produto: priced directly, with a fornecedor attached —
  // no ingredient picker at all ---
  await page.click('#back');
  await page.waitForSelector('#new-produto', { timeout: 6000 });
  await page.click('#new-produto');
  await page.waitForSelector('#pr-name-i', { timeout: 6000 });
  await page.fill('#pr-name-i', 'Croissant avulso');
  await page.selectOption('#pr-kind', 'comprado');
  await page.waitForSelector('#pr-cost', { timeout: 6000 });
  check('no ingredient picker for comprado', (await page.$('#pr-source')) === null);
  await page.fill('#pr-cost', '250'); // cents-first: R$ 2,50
  await page.click('#pr-fornecedor');
  await page.waitForSelector('.pick-opt:has-text("Padaria Ceci")', { timeout: 6000 });
  await page.click('.pick-opt:has-text("Padaria Ceci")');
  await page.waitForSelector('#pr-fornecedor:has-text("Padaria Ceci")', { timeout: 6000 });
  await page.click('#pr-ok');
  await page.waitForSelector('#prod-name', { timeout: 6000 });
  check('kind badge shows comprado', (await page.textContent('#root')).includes('Comprado'));
  check('fornecedor is shown on the detail page', (await page.textContent('#root')).includes('Padaria Ceci'));
  totalsText = norm(await page.textContent('.totals-card'));
  check('comprado cost equals the entered cost (2,50), got: ' + totalsText,
    totalsText.includes('R$ 2,50'));

  // --- an embalagem line with no purchase history: the total stays
  // defined (understated by that line's missing contribution — the base
  // cost is still known) but the warning names it, so the gap is visible
  // rather than silently absorbed into a wrong number ---
  await page.click('#pp-add-emb');
  await page.waitForSelector('.pick-opt:has-text("Fita Sem Estoque")', { timeout: 6000 });
  await page.click('.pick-opt:has-text("Fita Sem Estoque")');
  await page.waitForSelector('#emb-qty', { timeout: 6000 });
  await page.fill('#emb-qty', '20');
  await page.click('#emb-ok');
  await page.waitForSelector('.warn-card', { timeout: 6000 });
  check('incomplete warning names the never-stocked ingredient',
    (await page.textContent('.warn-card')).includes('Fita Sem Estoque'));
  check('the total still renders (understated, not hidden)', (await page.$('.totals-card')) !== null);

  // --- a comprado produto with NO cost entered: no total at all, never a
  // silent 0 ---
  await page.goto(PAGE);
  await page.waitForSelector('#new-produto', { timeout: 6000 });
  await page.click('#new-produto');
  await page.waitForSelector('#pr-name-i', { timeout: 6000 });
  await page.fill('#pr-name-i', 'Bombom avulso');
  await page.selectOption('#pr-kind', 'comprado');
  await page.waitForSelector('#pr-cost', { timeout: 6000 });
  await page.click('#pr-ok');
  await page.waitForSelector('.warn-card', { timeout: 6000 });
  check('no totals card when a comprado produto has no cost entered',
    (await page.$('.totals-card')) === null);
  check('the warning explains why', (await page.textContent('.warn-card')).includes('custo não informado'));

  // --- accent-insensitive search (foldSearchText): an unaccented typed
  // term matches a produto name stored WITH accents, and a genuinely
  // different term still doesn't match (no over-matching) ---
  await page.click('#back');
  await page.waitForSelector('#search', { timeout: 6000 });
  await page.click('#new-produto');
  await page.waitForSelector('#pr-name-i', { timeout: 6000 });
  await page.fill('#pr-name-i', 'Café Especial');
  await page.selectOption('#pr-kind', 'comprado');
  await page.waitForSelector('#pr-cost', { timeout: 6000 });
  await page.click('#pr-ok');
  await page.waitForSelector('#prod-name', { timeout: 6000 });
  check('the accented produto was created', state.produtos.some(p => p.name === 'Café Especial'));
  await page.click('#back');
  await page.waitForSelector('#search', { timeout: 6000 });

  await page.fill('#search', 'cafe especial');
  await page.waitForFunction(
    () => (document.getElementById('root').textContent || '').includes('Café Especial'),
    null, { timeout: 6000 });
  check('unaccented search "cafe especial" matches the accented produto name "Café Especial", got: ' +
    await page.textContent('#root'),
    (await page.textContent('#root')).includes('Café Especial'));

  await page.fill('#search', 'zzzznotfound');
  await page.waitForFunction(() => document.getElementById('no-match') !== null, null, { timeout: 6000 });
  check('an unrelated search term does not match the accented produto (no over-matching)',
    !(await page.textContent('#root')).includes('Café Especial'));

  await page.screenshot({ path: path.join(SHOTS, 'produto_detalhe.png'), fullPage: true });
  await browser.close();
  server.close();
  if (process.env.KEEP_SHOTS) console.log('screenshots: ' + SHOTS);

  console.log('--- JS errors ---');
  console.log(errors.length ? errors.join('\n') : '(none)');
  console.log('--- failures ---');
  console.log(failures.length ? failures.join('\n') : '(none)');
  process.exit(failures.length || errors.length ? 1 : 0);
})();
