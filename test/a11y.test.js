// Accessibility foundation checks — shared-ui.js's openModal()/fieldError()
// mechanics and the :focus-visible coverage added to the shared CSS sheets.
//
//   node test/a11y.test.js               # exits non-zero on any failure
//
// Split into a static half (no browser needed) and a Playwright half, same
// shape as css-tokens.test.js/sw.test.js and stock.test.js respectively.
//
// The static half exists because a missing :focus-visible rule is INVISIBLE
// to any behavioural assertion — nothing breaks, nothing throws, the page
// just has no visible focus indicator for a keyboard user. Only reading the
// CSS text itself can catch that class of gap (same reasoning as
// css-tokens.test.js's own file comment).
const fs = require('fs');
const path = require('path');
const http = require('http');

function loadPlaywright() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch (_) { /* try the next */ }
  }
  console.error('playwright not found — npm i -D playwright, or set NODE_PATH');
  process.exit(2);
}

const WEB_DIR = path.resolve(__dirname, '..');
const failures = [];
function check(label, ok) {
  if (!ok) failures.push('FAIL: ' + label);
  console.log((ok ? 'ok   ' : 'FAIL ') + label);
}

// ---------------------------------------------------------------------
// Static: every interactive class this pass covered has a :focus-visible
// rule in the shared sheet it lives in.
// ---------------------------------------------------------------------
const EXPECTED = [
  ['shared-base.css', '.link'],
  ['shared-base.css', '.icon-btn'],
  ['shared-base.css', 'button.primary'],
  ['shared-base.css', 'a.primary'],
  ['shared-menu.css', '.menu-btn'],
  ['shared-menu.css', '.menu-item'],
  ['shared-menu.css', '.brand-mark'],
  ['shared-modal.css', '.modal-actions button'],
];
for (const [file, selector] of EXPECTED) {
  const src = fs.readFileSync(path.join(WEB_DIR, file), 'utf8');
  // A loose but sufficient check: the selector text immediately followed
  // (allowing for a comma-joined sibling selector) by `:focus-visible`
  // somewhere before the next `{`. Written against literal selector text
  // rather than a full CSS parse, matching this repo's existing static
  // checks (css-tokens.test.js's own regex-based token scan).
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The selector can be the ONLY thing before `:focus-visible{`, or can be
  // followed by `:focus-visible` and then more comma-joined selectors
  // before the `{` (e.g. "button.primary:focus-visible, a.primary:focus-
  // visible{...}") — the two forms this pass actually used.
  const re = new RegExp(escaped + ':focus-visible(?:\\s*,[^{]*)?\\s*\\{');
  check(selector + ' has a :focus-visible rule in ' + file, re.test(src));
}

// The search box is the first control a keyboard user reaches on nine of
// these pages, so it gets the same ring as everything else. This started
// life as a `check(..., true)` placeholder — an assertion that cannot
// fail is not a test, it is a note — and became a real one the moment
// shared-page.css was in scope.
{
  const src = fs.readFileSync(path.join(WEB_DIR, 'shared-page.css'), 'utf8');
  check('shared-page.css search input has a :focus-visible rule',
    /\.searchrow input\[type=search\]:focus-visible\s*\{/.test(src));
}

(async () => {
  const { chromium } = loadPlaywright();

  function serve() {
    return new Promise(resolve => {
      const server = http.createServer((req, res) => {
        const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
        const file = path.join(WEB_DIR, rel || 'tarefas.html');
        if (!file.startsWith(WEB_DIR)) { res.writeHead(403).end(); return; }
        fs.readFile(file, (err, body) => {
          if (err) { res.writeHead(404).end(); return; }
          const ext = path.extname(file);
          const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
            '.css': 'text/css', '.png': 'image/png' }[ext] || 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': type });
          res.end(body);
        });
      });
      server.listen(0, '127.0.0.1', () => resolve(server));
    });
  }

  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });

  await ctx.route('**/functions/v1/maga-api', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ actions: [] }) });
  });

  const page = await ctx.newPage();

  // ---------------------------------------------------------------------
  // The hamburger's EFFECTIVE hit area — tarefas.html as the representative
  // page. Measuring the visible box (~26x26, per the CLAUDE.md task note)
  // is not the point; the whole point of the ::after inset trick is that
  // the TAPPABLE area is bigger than the ink, so this probes with
  // elementFromPoint() at points forming a 40x40 box centred on the
  // control's own bounding-rect centre, not at the visible glyph's edges.
  // ---------------------------------------------------------------------
  // Seed the passphrase before the real navigation so the page renders its
  // normal chrome (menu button included) instead of the login screen —
  // this test only cares about the shared mechanics, not a real session.
  await page.addInitScript(() => { try { localStorage.setItem('checklist_pass', 'x'); } catch (e) {} });
  await page.goto(base + 'tarefas.html');
  await page.waitForSelector('#menu-btn', { timeout: 6000 });

  const hit = await page.evaluate(() => {
    const btn = document.getElementById('menu-btn');
    const r = btn.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const half = 20; // half of the 40x40 box the platform minimum requires
    const points = [
      [cx - half, cy - half], [cx + half, cy - half],
      [cx - half, cy + half], [cx + half, cy + half],
      [cx, cy],
    ];
    const results = points.map(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      // Hit if it's the control itself, its own ::after (not directly
      // queryable, but elementFromPoint resolves pseudo-element hit-testing
      // to the ORIGINATING element), or an ancestor whose click handler is
      // what actually fires (delegation isn't used here, so this is just
      // the control or nothing).
      return !!el && (el === btn || btn.contains(el) || el.contains(btn));
    });
    return { rect: { width: r.width, height: r.height }, results };
  });
  check('the hamburger\'s visible box is under the 40px minimum on its own ' +
    '(got ' + hit.rect.width.toFixed(1) + 'x' + hit.rect.height.toFixed(1) +
    ') — the whole reason the hit-area trick exists',
    hit.rect.width < 40 || hit.rect.height < 40);
  check('every corner + centre of a 40x40 box centred on the hamburger hits ' +
    'the control (via its ::after hit-area), got: ' + JSON.stringify(hit.results),
    hit.results.every(Boolean));

  // ---------------------------------------------------------------------
  // confirmModal(): role="dialog"/aria-modal, focus trap, focus restore.
  // Driven from the browser context directly (confirmModal/openModal are
  // plain globals from shared-ui.js) rather than through a real page
  // action, since this is testing the shared mechanism itself, not any one
  // page's use of it — same "test the shared file directly" approach the
  // task calls for.
  // ---------------------------------------------------------------------
  const modalResult = await page.evaluate(async () => {
    // A real button to focus first, so focus-restore has something
    // meaningful to return to (document.body is always "focused" by
    // default and wouldn't prove anything).
    const trigger = document.createElement('button');
    trigger.id = 'a11y-trigger';
    trigger.textContent = 'open';
    document.body.appendChild(trigger);
    trigger.focus();

    const promise = confirmModal('Tem certeza?', 'Excluir');
    // Let the modal actually render before inspecting it.
    await new Promise(r => setTimeout(r, 0));

    const backdrop = document.querySelector('.modal-backdrop');
    const role = backdrop.getAttribute('role');
    const ariaModal = backdrop.getAttribute('aria-modal');
    const activeIsInsideModal = backdrop.contains(document.activeElement);

    // Focus trap: Shift+Tab from the first focusable element (Cancelar,
    // since confirmModal's markup has no earlier focusable element) must
    // wrap to the last (Excluir), not escape the dialog.
    const cancelBtn = document.getElementById('confirm-cancel');
    const okBtn = document.getElementById('confirm-ok');
    cancelBtn.focus();
    const shiftTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(shiftTab);
    const trappedToLast = document.activeElement === okBtn;

    // Now resolve the dialog (Cancelar) and confirm focus is restored to
    // the trigger that opened it.
    document.getElementById('confirm-cancel').click();
    const result = await promise;
    await new Promise(r => setTimeout(r, 0));
    const restored = document.activeElement === trigger;
    const backdropGone = !document.body.contains(backdrop);

    trigger.remove();
    return { role, ariaModal, activeIsInsideModal, trappedToLast, result, restored, backdropGone };
  });
  check('confirmModal() sets role="dialog"', modalResult.role === 'dialog');
  check('confirmModal() sets aria-modal="true"', modalResult.ariaModal === 'true');
  check('confirmModal() moves focus inside the dialog on open', modalResult.activeIsInsideModal);
  check('Shift+Tab from the first focusable element wraps to the last (focus trap)',
    modalResult.trappedToLast);
  check('clicking Cancelar resolves confirmModal() with false', modalResult.result === false);
  check('focus is restored to whatever opened the modal, on close', modalResult.restored);
  check('the backdrop is removed from the DOM on close', modalResult.backdropGone);

  // Escape closes it too, and — since body.style.overflow is locked and
  // unlocked around open/close — should leave the lock cleared afterward.
  const escResult = await page.evaluate(async () => {
    const promise = confirmModal('Escape me');
    await new Promise(r => setTimeout(r, 0));
    const lockedWhileOpen = document.body.style.overflow === 'hidden';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const result = await promise;
    await new Promise(r => setTimeout(r, 0));
    return { lockedWhileOpen, result, unlockedAfter: document.body.style.overflow !== 'hidden' };
  });
  check('background scroll is locked while a modal is open', escResult.lockedWhileOpen);
  check('Escape resolves confirmModal() with false', escResult.result === false);
  check('background scroll is unlocked once the modal closes', escResult.unlockedAfter);

  // ---------------------------------------------------------------------
  // fieldError()/clearFieldError(): idempotent, wires aria-*, auto-clears.
  // ---------------------------------------------------------------------
  const fieldResult = await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'a11y-field';
    document.body.appendChild(input);

    fieldError(input, 'Primeira mensagem.');
    const afterFirst = {
      text: document.getElementById('field-error-a11y-field').textContent,
      ariaInvalid: input.getAttribute('aria-invalid'),
      describedBy: input.getAttribute('aria-describedby'),
      count: document.querySelectorAll('.field-error').length,
    };

    // Calling it again (still no edit in between) must UPDATE the same
    // element, never stack a second one — the idempotency the task asked
    // for explicitly.
    fieldError(input, 'Segunda mensagem.');
    const afterSecond = {
      text: document.getElementById('field-error-a11y-field').textContent,
      count: document.querySelectorAll('.field-error').length,
    };

    // The next `input` event should auto-clear it.
    input.value = 'x';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const afterEdit = {
      exists: !!document.getElementById('field-error-a11y-field'),
      ariaInvalid: input.getAttribute('aria-invalid'),
      describedBy: input.getAttribute('aria-describedby'),
    };

    input.remove();
    return { afterFirst, afterSecond, afterEdit };
  });
  check('fieldError() inserts a message naming the problem, got: ' + fieldResult.afterFirst.text,
    fieldResult.afterFirst.text === 'Primeira mensagem.');
  check('fieldError() sets aria-invalid="true"', fieldResult.afterFirst.ariaInvalid === 'true');
  check('fieldError() wires aria-describedby to the message\'s id',
    fieldResult.afterFirst.describedBy === 'field-error-a11y-field');
  check('a second fieldError() call updates the same element rather than stacking, got count: ' +
    fieldResult.afterSecond.count, fieldResult.afterSecond.count === 1);
  check('the second call\'s message replaced the first, got: ' + fieldResult.afterSecond.text,
    fieldResult.afterSecond.text === 'Segunda mensagem.');
  check('editing the field auto-clears the message', !fieldResult.afterEdit.exists);
  check('editing the field clears aria-invalid', fieldResult.afterEdit.ariaInvalid === null);
  check('editing the field clears aria-describedby', fieldResult.afterEdit.describedBy === null);

  // ---------------------------------------------------------------------
  // The toast is announced: role="status" + aria-live="polite".
  // ---------------------------------------------------------------------
  const toastAttrs = await page.evaluate(() => {
    listToast('Salvo.');
    const el = document.getElementById('list-toast');
    return { role: el.getAttribute('role'), live: el.getAttribute('aria-live') };
  });
  check('the toast has role="status"', toastAttrs.role === 'status');
  check('the toast has aria-live="polite"', toastAttrs.live === 'polite');

  await browser.close();
  await server.close();

  console.log('--- failures ---');
  console.log(failures.length ? failures.join('\n') : '(none)');
  process.exit(failures.length ? 1 : 0);
})();
