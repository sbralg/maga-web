// Headless smoke test for tarefas.html — the daily-task checklist (renamed
// from index.html when the dashboard took over that filename).
//
//   node test/tarefas.test.js            # exits non-zero on any failure
//   KEEP_SHOTS=1 node test/...           # also prints where screenshots went
//
// Added alongside the front-end refactor that moved this page onto the
// shared JS/CSS files: before that refactor this page had zero automated
// coverage, so a real behavior change (api()/handleAuthError()
// unification, the fmtDateTime reconciliation) could have shipped
// unnoticed. Covers the passphrase gate, the menu, the core create/edit/
// delete/done/undo flows, the done-tasks section, and (2026-09-01) the
// due-date + important redesign: the star toggle, the add-row calendar
// icon, the edit modal's date field + Remover button, and overdue styling.
//
// Same shape as compras.test.js/hoje.test.js: serves the repo root over
// http and answers maga-api from an in-memory fake, so it never
// touches Supabase and never needs a real passphrase.
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
const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), 'tarefas-test-'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
                '.css': 'text/css', '.png': 'image/png' };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(WEB_DIR, rel || 'tarefas.html');
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

// LOCAL date parts, matching tarefas.html's own parseDateOnly()/startOfToday()
// — using toISOString() (UTC) here would drift a day off theirs near midnight
// in any non-UTC timezone, which is exactly the bug those functions exist to
// avoid on the page side.
function isoDateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mm + '-' + dd;
}

function sortActions(list) {
  return list.slice().sort((a, b) => {
    const ai = a.important ? 1 : 0, bi = b.important ? 1 : 0;
    if (ai !== bi) return bi - ai;
    const ad = a.due_date, bd = b.due_date;
    if (ad !== bd) {
      if (ad == null) return 1;
      if (bd == null) return -1;
      return ad < bd ? -1 : 1;
    }
    return (a.first_seen || '').localeCompare(b.first_seen || '');
  });
}

const state = {
  actions: [
    { id: 'A1', text: 'Responder e-mail do banco', source: 'email',
      status: 'pending', due_date: null, important: false, first_seen: '2026-08-19T10:00:00Z' },
    { id: 'A2', text: 'Ligar para o Igor', source: 'whatsapp',
      status: 'pending', due_date: null, important: false, first_seen: '2026-08-19T11:00:00Z' },
  ],
  seq: 2,
};

(async () => {
  const failures = [];
  const server = await serve();
  const PAGE = 'http://127.0.0.1:' + server.address().port + '/tarefas.html';
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });

  const errors = [];
  ctx.on('weberror', e => errors.push('pageerror: ' + e.error().message));

  let listCalls = 0;
  await ctx.route('**/functions/v1/maga-api', async route => {
    const body = route.request().postDataJSON();
    let resp;
    if (body.action === 'list') {
      listCalls++;
      resp = { actions: sortActions(state.actions.filter(a => a.status === 'pending')) };
    } else if (body.action === 'action_create') {
      const a = { id: 'A' + (++state.seq), text: body.text, source: 'manual', status: 'pending',
        due_date: 'due_date' in body ? body.due_date : null, important: !!body.important,
        first_seen: new Date().toISOString() };
      state.actions.push(a);
      resp = { action: a };
    } else if (body.action === 'action_edit') {
      const a = state.actions.find(x => x.id === body.id);
      if (a) {
        if ('text' in body) a.text = body.text;
        if ('source' in body) a.source = body.source;
        if ('due_date' in body) a.due_date = body.due_date;
        if ('important' in body) a.important = body.important;
      }
      resp = { ok: true, action: a };
    } else if (body.action === 'action_delete') {
      state.actions.forEach(a => { if (body.ids.includes(a.id)) a.status = 'deleted'; });
      resp = { ok: true };
    } else if (body.action === 'done') {
      state.actions.forEach(a => {
        if (body.ids.includes(a.id)) { a.status = 'done'; a.done_at = new Date().toISOString(); }
      });
      resp = { ok: true };
    } else if (body.action === 'undo_done') {
      state.actions.forEach(a => {
        if (body.ids.includes(a.id)) { a.status = 'pending'; a.done_at = null; }
      });
      resp = { ok: true };
    } else if (body.action === 'list_done') {
      const done = state.actions.filter(a => a.status === 'done')
        .sort((a, b) => (b.done_at || '').localeCompare(a.done_at || ''));
      const offset = body.offset || 0, limit = body.limit || 5;
      const page = done.slice(offset, offset + limit);
      resp = { actions: page, has_more: offset + page.length < done.length };
    } else {
      resp = { error: 'bad action' };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resp) });
  });

  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const check = (label, cond) => { if (!cond) failures.push('FAIL: ' + label); };
  const rowByText = (text) => page.$('.row:has-text("' + text + '")');

  // --- passphrase gate ---
  await page.goto(PAGE);
  await page.waitForSelector('.login', { timeout: 6000 });
  check('login screen names the page', (await page.textContent('.login h2')) === 'Tarefas pendentes');
  // Env radios only exist once a device has an actual cached environment
  // list from a prior login (see shared-api.js's ENV_CACHE_KEY comment) -
  // this fresh test context has none, so the picker is absent by design.
  check('login screen offers OAuth, no env picker on a device with no login history', (await page.$('#oauth')) !== null && (await page.$$('input[name="env"]')).length === 0);
  await page.click('.login-adv summary'); // reveal the collapsed "Entrar com senha" section
  await page.fill('#pw', 'x');
  await page.click('#enter');
  await page.waitForSelector('.row', { timeout: 6000 });

  // --- pending list renders ---
  check('both seeded tasks render', (await page.$$('.row')).length === 2);
  check('the source badge/meta line renders, got: ' + await page.textContent('.row .meta'),
    (await page.textContent('.row .meta')).includes('E-mail'));
  check('no due-date badge on an undated task', !(await page.textContent('.row .meta')).includes('📅'));

  // --- the hamburger menu lists every module, current page inert ---
  await page.click('#menu-btn');
  await page.waitForSelector('.menu-panel.open', { timeout: 6000 });
  const menuLinks = await page.$$eval('.menu-item', els =>
    els.map(e => ({ tag: e.tagName, text: e.textContent.trim(), href: e.getAttribute('href') })));
  // Derived from shared-menu.js rather than hard-coded, so adding a page
  // stops silently failing this assertion the way it did from the Receitas/
  // Produtos/Fornecedores additions onward.
  const menuCount = await page.evaluate(() => MENU_ITEMS.length);
  check('the menu lists every destination plus logout, got ' + menuLinks.length +
    ' for ' + menuCount + ' modules', menuLinks.length === menuCount + 1);
  check('the current page (Tarefas) renders as an inert label, not a link',
    menuLinks.some(m => m.tag === 'SPAN' && m.text === '✓ Tarefas'));
  check('Compras is reachable under its renamed href (not the old shopping.html)',
    menuLinks.some(m => m.tag === 'A' && m.href === 'compras.html'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.menu-backdrop'), null, { timeout: 6000 });

  // --- create, with a due date set via the add-row calendar icon ---
  check('the add-row calendar icon starts gray (unset)',
    !(await page.$eval('#new-due-btn', el => el.classList.contains('set'))));
  // 📅 is a full-color emoji glyph, so CSS `color` alone (what the .set
  // class toggle used to rely on) never actually recolors it -- a real bug
  // reported live, where the icon looked identically colored regardless of
  // state. `filter` is what actually reaches a color emoji, so assert on
  // that computed style directly rather than only the class, the same
  // "check values could not have caught this" discipline this repo already
  // applies to other CSS-only bugs (see CLAUDE.md's icon-btn hit-target and
  // scan-dialog price-field entries).
  check('the unset calendar icon is desaturated via filter, not just colored',
    (await page.$eval('#new-due-btn', el => getComputedStyle(el).filter)).includes('grayscale'));
  await page.fill('#new-text', 'Comprar pilhas');
  // The native date picker itself isn't drivable headlessly (same class of
  // limitation as compras.html's camera/barcode tests) -- setting the
  // underlying hidden input and firing 'change' exercises the exact same
  // page-side handler a real picker selection would.
  await page.evaluate((v) => {
    const el = document.getElementById('new-due-input');
    el.value = v; el.dispatchEvent(new Event('change'));
  }, isoDateOffset(1));
  check('the calendar icon turns colored once a date is chosen',
    await page.$eval('#new-due-btn', el => el.classList.contains('set')));
  // The grayscale->none filter change is CSS-transitioned, so read it after
  // the transition settles rather than mid-interpolation.
  await page.waitForFunction(
    () => getComputedStyle(document.getElementById('new-due-btn')).filter === 'none', null, { timeout: 6000 });
  check('the filter is cleared once set, so the emoji shows full color',
    (await page.$eval('#new-due-btn', el => getComputedStyle(el).filter)) === 'none');
  await page.click('#add-btn');
  await page.waitForFunction(() => document.querySelectorAll('.row').length === 3, null, { timeout: 6000 });
  check('a manually-created task appears', (await page.$$('.row')).length === 3);
  check('it carries the manual badge', (await page.textContent('#root')).includes('Manual'));
  const newRow = await rowByText('Comprar pilhas');
  check('its due date renders as "Amanhã"', (await newRow.textContent()).includes('📅 Amanhã'));
  check('the add-row calendar icon resets to gray after adding',
    !(await page.$eval('#new-due-btn', el => el.classList.contains('set'))));

  // --- no big per-row badge icon; only the small source icon in the meta line ---
  check('no .badge element on pending rows', (await page.$$('#pending-card .badge')).length === 0);

  // --- star toggle bumps a task to the top, without opening the edit modal,
  // and WITHOUT a full reload (no extra 'list' fetch -- the card is
  // redrawn in place from the already-loaded rows) ---
  const listCallsBeforeStar = listCalls;
  const igorStar = await page.$('.row:has-text("Ligar para o Igor") [data-star-id]');
  check('the star starts as the outline glyph', (await igorStar.textContent()) === '☆');
  await igorStar.click();
  await page.waitForFunction(() => {
    const first = document.querySelector('#root > .card > .row');
    return first && first.textContent.includes('Ligar para o Igor');
  }, null, { timeout: 6000 });
  check('the starred task is now first in the list',
    (await page.textContent('#root > .card > .row:first-child')).includes('Ligar para o Igor'));
  check('the star button shows as important', await page.$eval(
    '.row:has-text("Ligar para o Igor") [data-star-id]', el => el.classList.contains('important')));
  check('the star glyph switches to filled once important', (await page.textContent(
    '.row:has-text("Ligar para o Igor") [data-star-id]')) === '⭐');
  check('toggling the star did not trigger a full reload (no extra list fetch)',
    listCalls === listCallsBeforeStar);
  check('clicking the star did not open the edit modal', (await page.$$('.modal-backdrop')).length === 0);
  check('clicking the checkbox does not open the edit modal either', await (async () => {
    // Checking a box only enables the bulk "Concluir" bar -- it fires no
    // API call by itself -- but re-unchecking it keeps this row's selection
    // state clean for the steps that follow.
    await page.click('.row:has-text("Comprar pilhas") input[type=checkbox]');
    const opened = (await page.$$('.modal-backdrop')).length > 0;
    await page.click('.row:has-text("Comprar pilhas") input[type=checkbox]');
    return !opened;
  })());

  // --- edit modal: text + category (row body click opens it now, not a
  // dedicated ✎ button) ---
  await page.click('.row:has-text("Comprar pilhas") .rowbody');
  await page.waitForSelector('#edit-text-input', { timeout: 6000 });
  await page.fill('#edit-text-input', 'Comprar pilhas AA');
  await page.selectOption('#edit-cat-select', 'work');
  await page.click('#edit-save');
  await page.waitForFunction(
    () => document.body.textContent.includes('Comprar pilhas AA'), null, { timeout: 6000 });
  check('the edited text is shown', (await page.textContent('#root')).includes('Comprar pilhas AA'));
  check('the edited category is reflected in the meta line',
    (await page.textContent('#root')).includes('Trabalho'));

  // --- empty-text validation on the edit modal uses fieldError() (an
  // inline .field-error under the input), not a native alert() -- a
  // regression guard for the alert()->fieldError() conversion. A `dialog`
  // listener acts as a trap: if this ever regresses back to alert(), the
  // dialog fires and the check below catches it. ---
  let editDialogFired = false;
  page.once('dialog', async d => { editDialogFired = true; await d.dismiss(); });
  await page.click('.row:has-text("Comprar pilhas AA") .rowbody');
  await page.waitForSelector('#edit-text-input', { timeout: 6000 });
  await page.fill('#edit-text-input', '');
  await page.click('#edit-save');
  await page.waitForSelector('.field-error', { timeout: 6000 });
  check('empty text shows an inline field error under the input, got: ' +
    await page.textContent('.field-error'),
    (await page.textContent('.field-error')) === 'O texto não pode ficar vazio.');
  check('no native dialog fired for the empty-text validation', !editDialogFired);
  check('the modal stays open (same as the old alert() behavior) so the person can fix it',
    (await page.$('.modal-backdrop')) !== null);
  await page.click('#edit-cancel');
  await page.waitForFunction(() => !document.querySelector('.modal-backdrop'), null, { timeout: 6000 });

  // --- edit modal: setting a past due date renders the overdue (red) badge ---
  await page.click('.row:has-text("Comprar pilhas AA") .rowbody');
  await page.waitForSelector('#edit-due-input', { timeout: 6000 });
  await page.fill('#edit-due-input', isoDateOffset(-1));
  await page.click('#edit-save');
  await page.waitForFunction(
    () => { const r = [...document.querySelectorAll('.row')].find(r => r.textContent.includes('Comprar pilhas AA'));
      return r && r.querySelector('.due.overdue'); }, null, { timeout: 6000 });
  const overdueRow = await rowByText('Comprar pilhas AA');
  check('the overdue task keeps its 📅 badge (not hidden)', (await overdueRow.textContent()).includes('📅'));
  check('the overdue badge carries the overdue class',
    await overdueRow.$eval('.due', el => el.classList.contains('overdue')));

  // --- edit modal: "Limpar" clears the due date ---
  await page.click('.row:has-text("Comprar pilhas AA") .rowbody');
  await page.waitForSelector('#edit-due-clear', { timeout: 6000 });
  check('the due input is prefilled from the stored value',
    (await page.inputValue('#edit-due-input')) === isoDateOffset(-1));
  await page.click('#edit-due-clear');
  check('Limpar empties the date field', (await page.inputValue('#edit-due-input')) === '');
  await page.click('#edit-save');
  await page.waitForFunction(
    () => { const r = [...document.querySelectorAll('.row')].find(r => r.textContent.includes('Comprar pilhas AA'));
      return r && !r.textContent.includes('📅'); }, null, { timeout: 6000 });
  check('clearing the due date removes the badge',
    !(await (await rowByText('Comprar pilhas AA')).textContent()).includes('📅'));

  // --- delete now happens from inside the edit modal (Remover), not a
  // per-row 🗑 button ---
  const beforeDelete = (await page.$$('.row')).length;
  await page.click('.row:has-text("Comprar pilhas AA") .rowbody');
  await page.waitForSelector('#edit-delete', { timeout: 6000 });
  await page.click('#edit-delete');
  await page.waitForSelector('#confirm-ok', { timeout: 6000 });
  await page.click('#confirm-ok');
  await page.waitForFunction(
    (n) => document.querySelectorAll('.row').length === n, beforeDelete - 1, { timeout: 6000 });
  check('the deleted task is gone', !(await page.textContent('#root')).includes('Comprar pilhas AA'));

  // --- done + the collapsible done-tasks section + undo ---
  const remainingRows = await page.$$('.row');
  await remainingRows[0].$eval('input[type=checkbox]', el => el.click());
  await page.waitForSelector('#done-btn:not(:disabled)', { timeout: 6000 });
  await page.click('#done-btn');
  await page.waitForFunction(
    (n) => document.querySelectorAll('.row').length === n, remainingRows.length - 1, { timeout: 6000 });
  check('a completed task drops off the pending list',
    (await page.$$('.row')).length === remainingRows.length - 1);

  await page.click('#toggle-done');
  await page.waitForSelector('.done-card .row', { timeout: 6000 });
  check('the done section shows the completed task',
    (await page.$$('.done-card .row')).length === 1);

  // '.row' alone matches both the pending list AND the (currently expanded)
  // done section — scope to the pending card specifically, or undo (which
  // moves a row from one to the other without changing the total) would
  // never be observed as a change.
  const pendingRows = () => page.$$eval('#root > .card > .row', els => els.length);
  const pendingBeforeUndo = await pendingRows();
  await page.click('.done-card [data-undo-id]');
  await page.waitForFunction(
    (n) => document.querySelectorAll('#root > .card > .row').length > n,
    pendingBeforeUndo, { timeout: 6000 });
  check('undoing brings the task back to the pending list',
    (await pendingRows()) === pendingBeforeUndo + 1);

  await page.screenshot({ path: path.join(SHOTS, 'tarefas.png'), fullPage: true });
  await browser.close();
  server.close();
  if (process.env.KEEP_SHOTS) console.log('screenshots: ' + SHOTS);

  console.log('--- JS errors ---');
  console.log(errors.length ? errors.join('\n') : '(none)');
  console.log('--- failures ---');
  console.log(failures.length ? failures.join('\n') : '(none)');
  process.exit(failures.length || errors.length ? 1 : 0);
})();
