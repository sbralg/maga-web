// Headless UI test for notas.html — the cross-cutting notebook list +
// global note search. Object-backed notebook behavior (get-or-create by
// {kind, ref}, the add/edit/pin/delete note flow itself) is already
// covered per-object in clientes.test.js/eventos.test.js/produtos.test.js/
// receitas.test.js/fornecedores.test.js/ingredientes.test.js/stock.test.js
// (insumos.html) — this file covers what's unique to notas.html itself:
// the notebook list, user-created notebooks, the "Ver X →" link back to
// an object-backed notebook's own record, and the global search across
// every note's text. Env-gating (blocked on a non-default environment) is
// covered in env-scope.test.js, alongside Hoje/Tarefas.
//
//   node test/notas.test.js             # exits non-zero on any failure
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
const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), 'notas-test-'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
                '.css': 'text/css', '.png': 'image/png' };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(WEB_DIR, rel || 'notas.html');
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

const state = { notebooks: [], notes: [], seq: 0 };
const uid = (p) => p + (++state.seq);

function seedObjectNotebook(kind, ref, objLabel) {
  const nb = { id: uid('NB'), name: null, emoji: null, updated_at: new Date().toISOString() };
  nb[kind + '_id'] = ref;
  nb[kind] = { id: ref, name: objLabel };
  state.notebooks.push(nb);
  return nb;
}
function seedNote(notebookId, { title = null, body, pinned = false, createdAt } = {}) {
  const now = createdAt || new Date().toISOString();
  const note = { id: uid('N'), notebook_id: notebookId, title, body, pinned, created_at: now, updated_at: now };
  state.notes.push(note);
  return note;
}
function noteCountFor(notebookId) {
  return state.notes.filter(n => n.notebook_id === notebookId).length;
}

(async () => {
  const failures = [];
  const server = await serve();
  const PAGE = 'http://127.0.0.1:' + server.address().port + '/notas.html';
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 414, height: 900 } });

  const errors = [];
  ctx.on('weberror', e => errors.push('pageerror: ' + e.error().message));

  await ctx.route('**/functions/v1/maga-api', async route => {
    const body = route.request().postDataJSON();
    let resp;
    if (body.action === 'notebooks') {
      // Only user-created notebooks, or object-backed ones with at least
      // one note, per maga-api's own `notebooks` handler — an empty
      // object-backed notebook is created lazily and shouldn't clutter
      // the list until it actually holds something.
      const rows = state.notebooks
        .filter(nb => !!nb.name || noteCountFor(nb.id) > 0)
        .map(nb => ({ ...nb, note_count: noteCountFor(nb.id) }))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      resp = { notebooks: rows };
    } else if (body.action === 'notebook_detail') {
      const nb = state.notebooks.find(n => n.id === body.id);
      if (!nb) { resp = { found: false }; }
      else {
        const notes = state.notes.filter(n => n.notebook_id === nb.id)
          .sort((a, b) => (b.pinned - a.pinned) || b.created_at.localeCompare(a.created_at));
        resp = { found: true, notebook: nb, notes };
      }
    } else if (body.action === 'notebook_create') {
      const nb = { id: uid('NB'), name: body.name, emoji: body.emoji || null,
        updated_at: new Date().toISOString() };
      state.notebooks.push(nb);
      resp = { ok: true, notebook: nb };
    } else if (body.action === 'notebook_rename') {
      const nb = state.notebooks.find(n => n.id === body.id);
      if (!nb) { resp = { error: 'unknown notebook' }; }
      else { nb.name = body.name; resp = { ok: true, notebook: nb }; }
    } else if (body.action === 'notebook_set_emoji') {
      const nb = state.notebooks.find(n => n.id === body.id);
      if (!nb) { resp = { error: 'unknown notebook' }; }
      else { nb.emoji = body.emoji || null; resp = { ok: true, notebook: nb }; }
    } else if (body.action === 'notebook_delete') {
      const nb = state.notebooks.find(n => n.id === body.id);
      const count = noteCountFor(body.id);
      if (!body.force && count > 0) {
        resp = { ok: false, reason: 'has_notes', id: body.id, notes: count };
      } else {
        state.notebooks = state.notebooks.filter(n => n.id !== body.id);
        state.notes = state.notes.filter(n => n.notebook_id !== body.id);
        resp = { ok: true, id: body.id, notes_deleted: count };
      }
    } else if (body.action === 'note_create') {
      const note = seedNote(body.notebook_id, { title: body.title || null, body: body.body });
      resp = { ok: true, note };
    } else if (body.action === 'note_update') {
      const n = state.notes.find(x => x.id === body.id);
      if (!n) { resp = { error: 'unknown note' }; }
      else {
        if ('title' in body) n.title = body.title;
        if ('body' in body) n.body = body.body;
        if ('pinned' in body) n.pinned = body.pinned;
        n.updated_at = new Date().toISOString();
        resp = { ok: true, note: n };
      }
    } else if (body.action === 'note_delete') {
      state.notes = state.notes.filter(n => n.id !== body.id);
      resp = { ok: true, id: body.id };
    } else if (body.action === 'notes_all') {
      resp = { notes: state.notes.map(n => ({
        ...n, notebook: state.notebooks.find(nb => nb.id === n.notebook_id),
      })) };
    } else {
      resp = { error: 'bad action' };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resp) });
  });

  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const check = (label, cond) => { if (!cond) failures.push('FAIL: ' + label); };

  await ctx.addInitScript(() => { try { localStorage.setItem('checklist_pass', 'x'); } catch (_) {} });

  // --- empty state ---
  await page.goto(PAGE);
  await page.waitForSelector('#add-notebook-btn', { timeout: 6000 });
  check('empty state message shown', (await page.textContent('#root')).includes('Nenhum caderno seu ainda'));

  // --- seed an object-backed notebook (a cliente) with one note, plus
  // an empty one (produto) — NEITHER should show in the default (no
  // search) list: object-backed notebooks live on their own object's
  // page, and cluttering this list with every one that's ever had a note
  // written against it is exactly what the default view now avoids ---
  const clienteNb = seedObjectNotebook('cliente', 'C1', 'Maria Silva');
  seedNote(clienteNb.id, { body: 'Prefere contato à tarde' });
  seedObjectNotebook('produto', 'P1', 'Bolo de Cenoura'); // no notes yet

  await page.reload();
  await page.waitForSelector('#add-notebook-btn', { timeout: 6000 });
  check('no object-backed notebooks in the default list, got: ' + await page.textContent('#root'),
    (await page.textContent('#root')).includes('Nenhum caderno seu ainda') &&
    !(await page.textContent('#root')).includes('Maria Silva') &&
    !(await page.textContent('#root')).includes('Bolo de Cenoura'));

  // --- opening an object-backed notebook directly (e.g. the ?id= a link
  // from its own detail page would use) still works even though it's not
  // in the default list, and shows a link back to the object, and no
  // rename/delete actions (those belong to the object's own page) ---
  await page.goto(PAGE + '?id=' + clienteNb.id);
  await page.waitForSelector('.notes-card', { timeout: 6000 });
  check('the object link points at clientes.html',
    (await page.getAttribute('.detail-actions a', 'href') || '').includes('clientes.html?id=C1'));
  check('no edit/delete controls for an object-backed notebook',
    (await page.$('#edit-nb')) === null && (await page.$('#del-nb')) === null);
  check('the existing note is shown', (await page.textContent('.notes-card')).includes('Prefere contato à tarde'));

  // --- the edit-note modal's textarea must actually be styled, not fall
  // back to the browser default (a real reported bug: an unstyled
  // textarea renders tiny/monospace instead of matching the title input
  // right above it — see shared-modal.css's `.modal-card textarea` rule) ---
  await page.click('.note-body-wrap');
  await page.waitForSelector('#note-edit-body', { timeout: 4000 });
  const widths = await page.evaluate(() => ({
    title: document.getElementById('note-edit-title').getBoundingClientRect().width,
    body: document.getElementById('note-edit-body').getBoundingClientRect().width,
  }));
  check('the note-edit textarea is as wide as the title field above it, got: ' + JSON.stringify(widths),
    Math.abs(widths.title - widths.body) < 1);
  await page.click('#note-edit-cancel');
  await page.waitForSelector('.notes-card', { timeout: 4000 });

  await page.click('#back');
  await page.waitForSelector('#add-notebook-btn', { timeout: 6000 });

  // --- creating (with a custom emoji), editing and deleting a
  // USER-CREATED notebook ---
  await page.fill('#new-notebook-emoji', '🎂');
  await page.fill('#new-notebook-name', 'Ideias para o cardápio de verão');
  await page.click('#add-notebook-btn');
  await page.waitForSelector('.notes-card', { timeout: 6000 });
  check('a user-created notebook has no object link',
    (await page.$('.detail-actions a')) === null);
  check('a user-created notebook DOES have edit/delete',
    (await page.$('#edit-nb')) !== null && (await page.$('#del-nb')) !== null);
  const userNbId = state.notebooks.find(nb => nb.name === 'Ideias para o cardápio de verão').id;
  check('the custom emoji was saved on create',
    state.notebooks.find(nb => nb.id === userNbId).emoji === '🎂');
  check('the custom emoji shows next to the notebook name in the header',
    (await page.textContent('.nb-title-wrap')).includes('🎂'));

  // --- unlike the object-backed notebooks above, a user-created one DOES
  // show up in the default list, right alongside its note count and its
  // custom emoji as the row icon ---
  await page.click('#back');
  await page.waitForSelector('#nb-card', { timeout: 6000 });
  check('the user-created notebook appears in the default list, got: ' + await page.textContent('#nb-card'),
    (await page.textContent('#nb-card')).includes('Ideias para o cardápio de verão'));
  check('its note count shows 0 notas', (await page.textContent('#nb-card')).includes('0 notas'));
  check('its custom emoji is the row icon',
    (await page.textContent('.row[data-id="' + userNbId + '"] .ic')).includes('🎂'));
  await page.click('.row[data-id="' + userNbId + '"]');
  await page.waitForSelector('.notes-card', { timeout: 6000 });

  // The edit modal renames AND changes the emoji in one save.
  await page.click('#edit-nb');
  await page.waitForSelector('.modal-card', { timeout: 4000 });
  await page.fill('#edit-nb-name', 'Cardápio de verão 2027');
  await page.fill('#edit-nb-emoji', '🍰');
  await page.click('#edit-nb-save');
  await page.waitForFunction(() => document.getElementById('nb-title').textContent.includes('2027'), null, { timeout: 6000 });
  check('the rename persisted', state.notebooks.find(nb => nb.id === userNbId).name === 'Cardápio de verão 2027');
  check('the emoji change persisted', state.notebooks.find(nb => nb.id === userNbId).emoji === '🍰');

  // Delete while empty needs only ONE confirm (no notes to lose).
  await page.click('#del-nb');
  await page.waitForSelector('#confirm-ok', { timeout: 4000 });
  await page.click('#confirm-ok');
  await page.waitForSelector('#add-notebook-btn', { timeout: 6000 });
  check('the empty user-created notebook was deleted with one confirm',
    !state.notebooks.some(nb => nb.id === userNbId));

  // Delete while it HAS notes needs the second, force confirm.
  await page.fill('#new-notebook-name', 'Lista de fornecedores para testar');
  await page.click('#add-notebook-btn');
  await page.waitForSelector('.notes-card', { timeout: 6000 });
  await page.click('.note-add-btn');
  await page.waitForSelector('#note-new-body', { timeout: 4000 });
  await page.fill('#note-new-body', 'Ligar para o novo fornecedor de farinha');
  await page.click('#note-new-save');
  await page.waitForSelector('.note-row', { timeout: 6000 });
  const nonEmptyNbId = state.notebooks.find(nb => nb.name === 'Lista de fornecedores para testar').id;
  await page.click('#del-nb');
  await page.waitForSelector('#confirm-ok', { timeout: 4000 });
  await page.click('#confirm-ok'); // first confirm -> refused, second dialog appears
  await page.waitForFunction(() => document.querySelectorAll('.modal-card').length > 0, null, { timeout: 6000 });
  check('a notebook with a note refuses on the first confirm and asks again',
    state.notebooks.some(nb => nb.id === nonEmptyNbId));
  await page.click('#confirm-ok'); // the force confirm
  await page.waitForSelector('#add-notebook-btn', { timeout: 6000 });
  check('the notebook and its note are both gone after the force confirm',
    !state.notebooks.some(nb => nb.id === nonEmptyNbId) &&
    !state.notes.some(n => n.notebook_id === nonEmptyNbId));

  // --- global search across every note's text, accent-insensitive like
  // every other search box in this app ---
  const fornNb = seedObjectNotebook('fornecedor', 'F1', 'Padaria Ceci');
  seedNote(fornNb.id, { title: 'Café especial', body: 'Vende grãos direto da fazenda' });
  seedNote(clienteNb.id, { body: 'Aniversário em setembro' });

  await page.reload();
  await page.waitForSelector('#search', { timeout: 6000 });
  await page.fill('#search', 'cafe'); // unaccented, must still match "Café"
  await page.waitForSelector('#hits-card', { timeout: 6000 });
  check('accent-insensitive search finds the "Café especial" note',
    (await page.textContent('#hits-card')).includes('Café especial'));
  check('the hit shows which notebook it belongs to',
    (await page.textContent('#hits-card')).includes('Padaria Ceci'));

  await page.fill('#search', 'aniversário');
  await page.waitForFunction(
    () => (document.getElementById('root').textContent || '').includes('Aniversário em setembro'),
    null, { timeout: 6000 });
  check('a body-only match (no title) is also found',
    (await page.textContent('#root')).includes('Aniversário em setembro'));

  await page.fill('#search', 'ninguem tem isso');
  await page.waitForFunction(
    () => (document.getElementById('root').textContent || '').includes('Nenhuma nota encontrada'),
    null, { timeout: 6000 });
  check('an unmatched search shows the empty state', true);

  // Clicking a search hit opens its notebook.
  await page.fill('#search', 'cafe');
  await page.waitForSelector('#hits-card', { timeout: 6000 });
  await page.click('#hits-card .row');
  await page.waitForSelector('.notes-card', { timeout: 6000 });
  check('clicking a search hit opens the right notebook',
    (await page.textContent('.notes-card')).includes('Vende grãos direto da fazenda'));

  await page.screenshot({ path: path.join(SHOTS, 'notas_lista.png'), fullPage: true });
  await browser.close();
  server.close();
  if (process.env.KEEP_SHOTS) console.log('screenshots: ' + SHOTS);

  console.log('--- JS errors ---');
  console.log(errors.length ? errors.join('\n') : '(none)');
  console.log('--- failures ---');
  console.log(failures.length ? failures.join('\n') : '(none)');
  process.exit(failures.length || errors.length ? 1 : 0);
})();
