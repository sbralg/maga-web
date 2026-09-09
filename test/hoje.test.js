// Headless smoke test for hoje.html — the daily-summary page.
//
//   node test/hoje.test.js               # exits non-zero on any failure
//   KEEP_SHOTS=1 node test/...           # also prints where screenshots went
//
// Added alongside the front-end refactor that moved this page onto the
// shared JS/CSS files (shared-api.js/shared-menu.js/shared-ui.js/
// shared-format.js): before that refactor this page had zero automated
// coverage, so a real behavior change (api()/handleAuthError() unification,
// the fmtDateTime reconciliation) could have shipped unnoticed. This does
// not try to be exhaustive — it exercises the passphrase gate, the menu,
// rendering a mock report payload (including the live action-status overlay
// and the highlight classes), and day navigation.
//
// Same shape as compras.test.js/stock.test.js: serves the repo root over
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
const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), 'hoje-test-'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
                '.css': 'text/css', '.png': 'image/png' };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(WEB_DIR, rel || 'hoje.html');
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

// Two consecutive days, so ‹ › navigation has somewhere real to go. The
// later day's report includes one action already marked done in
// public.actions (action_status), to exercise the "state is live even
// though the snapshot isn't" behavior, and one urgent/lead-highlighted
// entry to exercise classOf().
const REPORTS = {
  '2026-08-20': {
    report_date: '2026-08-20', generated_at: '2026-08-20T10:05:00Z',
    payload: {
      dia_semana: 'quinta-feira', data: '20/08/2026',
      janela_inicio: '19/08 10:00', janela_fim: '20/08 10:00',
      resumo_triagem: 'Dia tranquilo.',
      email: { total: 3, ruido: 1, acao: 2 },
      whatsapp: { total: 5, grupos_ativos: 1, diretas: 4, acao: 1 },
      acoes: [
        { action_id: 'a1', acao: 'Responder e-mail do banco', origem: 'email',
          motivo: 'pede confirmação', classe: 'urgent' },
        { action_id: 'a2', acao: 'Ligar para o Igor', origem: 'whatsapp', classe: 'lead' },
      ],
      agenda: [{ hora: '14:00', evento: 'Reunião', calendario: 'Trabalho' }],
      amanha: { data: '21/08', eventos: [] },
      instrucoes: [{ instrucao: 'lembrar de pagar a conta', resposta: 'ok, anotado' }],
      watchlist: [{ topico: 'Renovação do plano', descricao: 'vence dia 25' }],
    },
    action_status: { a1: { status: 'done', done_at: '2026-08-20T11:00:00Z' } },
  },
  '2026-08-19': {
    report_date: '2026-08-19', generated_at: '2026-08-19T10:03:00Z',
    payload: {
      dia_semana: 'quarta-feira', data: '19/08/2026',
      email: { total: 0 }, whatsapp: { total: 0 },
      acoes: [], agenda: [], amanha: { eventos: [] },
    },
    action_status: {},
  },
};

(async () => {
  const failures = [];
  const server = await serve();
  const PAGE = 'http://127.0.0.1:' + server.address().port + '/hoje.html';
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });

  const errors = [];
  ctx.on('weberror', e => errors.push('pageerror: ' + e.error().message));

  // Push notifications need a fake serviceWorker/PushManager/Notification —
  // headless Chromium can register a real service worker fine (harmless,
  // matches every other page here), but a real pushManager.subscribe()
  // would try to reach an actual push service over the network, which has
  // no place in a hermetic test. Same "stub only what hardware/platform
  // APIs demand" convention as compras.test.js's camera/BarcodeDetector
  // stubs. window.__pushCalls records what the opt-in flow actually did,
  // separate from the network assertions below (which confirm the RIGHT
  // request shape reached maga-api, not just that some call happened).
  await ctx.addInitScript(() => {
    window.__pushCalls = { subscribe: 0, unsubscribe: 0 };
    let subscribed = null;
    const fakeSubscription = {
      endpoint: 'https://fake.push.example/ep1',
      toJSON(){ return { endpoint: this.endpoint, keys: { p256dh: 'fake-p256dh', auth: 'fake-auth' } }; },
      unsubscribe: async () => { window.__pushCalls.unsubscribe++; subscribed = null; return true; },
    };
    const fakeRegistration = {
      pushManager: {
        getSubscription: async () => subscribed,
        subscribe: async () => { window.__pushCalls.subscribe++; subscribed = fakeSubscription; return fakeSubscription; },
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve(fakeRegistration), register: async () => fakeRegistration, addEventListener(){} },
    });
    window.PushManager = function(){};
    window.Notification = { permission: 'default', requestPermission: async () => 'granted' };
  });

  let passphraseSet = false;
  const pushActionCalls = [];
  await ctx.route('**/functions/v1/maga-api', async route => {
    const req = route.request();
    const headerPass = req.headers()['x-checklist-pass'];
    const body = req.postDataJSON();
    if (!passphraseSet && headerPass !== 'x') {
      await route.fulfill({ status: 401, contentType: 'application/json',
        body: JSON.stringify({ error: 'unauthorized' }) });
      return;
    }
    let resp;
    if (body.action === 'daily_report') {
      const dates = Object.keys(REPORTS).sort();
      const date = body.date || dates[dates.length - 1];
      const report = REPORTS[date];
      const i = dates.indexOf(date);
      resp = report
        ? { report, prev_date: i > 0 ? dates[i - 1] : null,
            next_date: i < dates.length - 1 ? dates[i + 1] : null,
            action_status: report.action_status }
        : { report: null, prev_date: null, next_date: null };
    } else if (body.action === 'push_subscribe' || body.action === 'push_unsubscribe') {
      pushActionCalls.push(body);
      resp = { ok: true };
    } else {
      resp = { error: 'bad action' };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resp) });
  });

  const page = await ctx.newPage();
  // Chromium logs the deliberately-wrong-password 401 as a console error in
  // its own right (a failed resource load), which is the expected shape of
  // that scenario rather than a bug — filtered out here so it doesn't read
  // as a JS error.
  page.on('console', m => {
    if (m.type() === 'error' && !/401 \(Unauthorized\)/.test(m.text())) {
      errors.push('console: ' + m.text());
    }
  });

  const check = (label, cond) => { if (!cond) failures.push('FAIL: ' + label); };

  // --- the passphrase gate, with no stored password yet ---
  await page.goto(PAGE);
  await page.waitForSelector('.login', { timeout: 6000 });
  check('login screen names the page', (await page.textContent('.login h2')) === 'Resumo do dia');
  await page.click('.login-adv summary'); // reveal the collapsed "Entrar com senha" section
  await page.fill('#pw', 'wrong');
  await page.click('#enter');
  await page.waitForSelector('.loginerr:not(:empty)', { timeout: 6000 });
  check('a wrong passphrase is refused with its own message, got: ' +
      await page.textContent('.loginerr'),
    (await page.textContent('.loginerr')).includes('incorreta'));

  // A second attempt, this time correct — matches what the fake route
  // above treats as authorized.
  passphraseSet = true;
  await page.click('.login-adv summary'); // login re-rendered after the refusal, details closed again
  await page.fill('#pw', 'x');
  await page.click('#enter');
  await page.waitForSelector('.datebar', { timeout: 6000 });

  // --- the report itself ---
  check('the day label renders, got: ' + await page.textContent('.datebar .day'),
    (await page.textContent('.datebar .day')).includes('20/08/2026'));
  check('the pill counts render', (await page.textContent('.pills')).includes('3 e-mails'));
  check('a done action shows a checkmark and strikethrough, not its number',
    (await page.locator('.entry.done .num').first().textContent()) === '✓');
  check('a done action carries its "concluída em" stamp',
    (await page.locator('.entry.done .meta').first().textContent()).includes('concluída'));
  check('an urgent-classed action gets the highlight class',
    (await page.$('.entry.urgent')) !== null);
  check('the header pill counts completed items too',
    (await page.textContent('.pills')).includes('1 feita'));
  check('agenda renders', (await page.textContent('.sect')).length > 0);
  check('a self_instruction row renders its resposta',
    (await page.textContent('#root')).includes('lembrar de pagar a conta'));
  check('watchlist renders', (await page.textContent('#root')).includes('Renovação do plano'));

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
  check('the current page (Hoje) renders as an inert label, not a link',
    menuLinks.some(m => m.tag === 'SPAN' && m.text === '☀️ Hoje'));
  check('Tarefas is reachable as a real link (not the old index.html name)',
    menuLinks.some(m => m.tag === 'A' && m.href === 'tarefas.html'));
  check('the dashboard is reachable as Home, via the landing-page bypass link',
    menuLinks.some(m => m.tag === 'A' && m.href === 'index.html?dash=1' && m.text.includes('Home')));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.menu-backdrop'), null, { timeout: 6000 });

  // --- day navigation ---
  check('‹ is enabled (there is an older report)', await page.locator('#prev-day').isEnabled());
  check('› is disabled (this is the newest report)', !(await page.locator('#next-day').isEnabled()));
  await page.click('#prev-day');
  await page.waitForFunction(
    () => (document.querySelector('.datebar .day') || {}).textContent?.includes('19/08/2026'),
    null, { timeout: 6000 });
  check('navigating back shows the older day, got: ' + await page.textContent('.datebar .day'),
    (await page.textContent('.datebar .day')).includes('19/08/2026'));
  check('an empty report degrades to "nothing pending" rather than breaking',
    (await page.textContent('#root')).includes('Nenhuma ação para hoje'));
  check('› is enabled again, now that a newer day exists',
    await page.locator('#next-day').isEnabled());
  check('‹ is disabled — this is the oldest report',
    !(await page.locator('#prev-day').isEnabled()));

  // --- push notification opt-in ---
  check('the opt-in card renders, not-yet-subscribed state, got: ' +
      await page.textContent('#push-optin-msg'),
    (await page.textContent('#push-optin-msg')).includes('Clique aqui para ser notificado'));
  check('the button offers to activate, not deactivate',
    (await page.textContent('#push-optin-btn')).trim() === 'Ativar notificações');

  await page.click('#push-optin-btn');
  await page.waitForFunction(
    () => (document.getElementById('push-optin-btn') || {}).textContent?.trim() === 'Desativar',
    null, { timeout: 6000 });
  check('subscribing actually called pushManager.subscribe() once',
    (await page.evaluate(() => window.__pushCalls.subscribe)) === 1);
  check('subscribing posted push_subscribe to maga-api with the endpoint+keys shape',
    pushActionCalls.some(c => c.action === 'push_subscribe' &&
      c.endpoint === 'https://fake.push.example/ep1' &&
      c.keys && c.keys.p256dh === 'fake-p256dh' && c.keys.auth === 'fake-auth'));
  check('the card now shows the activated state, got: ' +
      await page.textContent('#push-optin-msg'),
    (await page.textContent('#push-optin-msg')).includes('ativadas'));

  await page.click('#push-optin-btn');
  await page.waitForFunction(
    () => (document.getElementById('push-optin-btn') || {}).textContent?.trim() === 'Ativar notificações',
    null, { timeout: 6000 });
  check('unsubscribing actually called subscription.unsubscribe() once',
    (await page.evaluate(() => window.__pushCalls.unsubscribe)) === 1);
  check('unsubscribing posted push_unsubscribe with the same endpoint',
    pushActionCalls.some(c => c.action === 'push_unsubscribe' && c.endpoint === 'https://fake.push.example/ep1'));
  check('the card reverts to the not-yet-subscribed message',
    (await page.textContent('#push-optin-msg')).includes('Clique aqui para ser notificado'));

  await page.screenshot({ path: path.join(SHOTS, 'hoje.png'), fullPage: true });
  await browser.close();
  server.close();
  if (process.env.KEEP_SHOTS) console.log('screenshots: ' + SHOTS);

  console.log('--- JS errors ---');
  console.log(errors.length ? errors.join('\n') : '(none)');
  console.log('--- failures ---');
  console.log(failures.length ? failures.join('\n') : '(none)');
  process.exit(failures.length || errors.length ? 1 : 0);
})();
