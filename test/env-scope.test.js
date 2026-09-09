// Headless test for the "Dia a dia" (Hoje, Tarefas) personal-data scoping:
// those two pages/menu entries only show up while the signed-in account is
// on ITS OWN default environment (see isDefaultEnv() in shared-api.js and
// visibleMenuItems() in shared-menu.js). Motivation: maga-infra's
// people.json lets an account switch to a NON-default environment (e.g.
// Bia opening "dev", which is Alexandre's real household data reused as
// dev data) — without this, her session would show his personal daily
// triage/tasks.
//
//   node test/env-scope.test.js
const http = require('http');
const fs = require('fs');
const path = require('path');

function loadPlaywright() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch (_) { /* next */ }
  }
  console.error('playwright not found — npm i -D playwright, or set NODE_PATH');
  process.exit(2);
}
const { chromium } = loadPlaywright();

const WEB_DIR = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(WEB_DIR, rel || 'index.html');
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

// Seeds localStorage the way a completed OAuth login would (see
// completeOAuth() in shared-api.js) — env id + the cached account env list
// it's compared against — without actually running the OAuth flow.
// `menuHidden` (optional, {dev:[...], prod:[...]}) seeds each cached
// environment's own Aplicativo preference (phase 3) - the same shape
// /web-config now returns per environment, see shared-api.js's
// currentEnvPrefs().
async function seedEnv(page, { envId, defaultEnv, menuHidden } = {}) {
  await page.evaluate(({ envId, defaultEnv, menuHidden }) => {
    localStorage.setItem('checklist_pass', 'x');
    if (envId) localStorage.setItem('checklist_env', envId);
    localStorage.setItem('checklist_envs_cache', JSON.stringify({
      defaultEnv,
      environments: [
        { id: 'dev', label: 'Dev', menuHidden: (menuHidden && menuHidden.dev) || [] },
        { id: 'prod', label: 'Prod', menuHidden: (menuHidden && menuHidden.prod) || [] },
      ],
    }));
  }, { envId, defaultEnv, menuHidden });
}

(async () => {
  const failures = [];
  const check = (label, cond) => { if (!cond) failures.push('FAIL: ' + label); };
  const server = await serve();
  const ORIGIN = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  async function withApiFake(ctx) {
    const calls = [];
    await ctx.route('**/functions/v1/maga-api', async route => {
      const body = JSON.parse(route.request().postData() || '{}');
      calls.push(body.action);
      if (body.action === 'list') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ actions: [] }) });
      } else if (body.action === 'daily_report') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ report: null }) });
      } else {
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'bad action' }) });
      }
    });
    return calls;
  }

  // --- on a NON-default environment: tarefas.html blocks instead of
  // loading personal data, and never even calls maga-api -----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const calls = await withApiFake(ctx);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/tarefas.html');
    await seedEnv(page, { envId: 'dev', defaultEnv: 'prod' });
    await page.reload();
    await page.waitForSelector('.msg', { timeout: 6000 });
    const text = await page.textContent('#root');
    check('tarefas.html shows the blocked message on a non-default env', /não está disponível para esta conta neste ambiente/.test(text));
    check('the header/menu button is still shown so the user can navigate away', await page.$('#menu-btn') !== null);
    check('tarefas.html never called maga-api at all while blocked', calls.length === 0);
    await ctx.close();
  }

  // --- same for hoje.html ------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const calls = await withApiFake(ctx);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/hoje.html');
    await seedEnv(page, { envId: 'dev', defaultEnv: 'prod' });
    await page.reload();
    await page.waitForSelector('.msg', { timeout: 6000 });
    const text = await page.textContent('#root');
    check('hoje.html shows the blocked message on a non-default env', /não está disponível para esta conta neste ambiente/.test(text));
    check('hoje.html never called maga-api at all while blocked', calls.length === 0);
    await ctx.close();
  }

  // --- on the account's OWN default environment: both pages load
  // normally, exactly as before this change --------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const calls = await withApiFake(ctx);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/tarefas.html');
    await seedEnv(page, { envId: 'prod', defaultEnv: 'prod' });
    await page.reload();
    await page.waitForSelector('.msg', { timeout: 6000 });
    check('tarefas.html loads normally on the default env', calls.includes('list'));
    const text = await page.textContent('#root');
    check('no blocked message on the default env', !/não está disponível/.test(text));
    await ctx.close();
  }

  // --- no resolved env at all (the manual-passphrase path never sets one)
  // reads as default - the household's own primary login must not be
  // treated as "some other account's environment" ------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const calls = await withApiFake(ctx);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/tarefas.html');
    await page.evaluate(() => localStorage.setItem('checklist_pass', 'x'));
    await page.reload();
    await page.waitForSelector('.msg', { timeout: 6000 });
    check('with no env id at all, tarefas.html still loads (manual-passphrase path)', calls.includes('list'));
    await ctx.close();
  }

  // --- the hamburger menu drops Hoje/Tarefas on a non-default env, and
  // the dashboard's tiles do the same ---------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    await withApiFake(ctx);
    const page = await ctx.newPage();
    // tarefas.html itself blocks on a non-default env (covered above), but
    // its header/menu-btn still render (see load()'s blocked branch) - good
    // enough to open the drawer from without faking a whole other page's
    // own load sequence.
    await page.goto(ORIGIN + '/tarefas.html');
    await seedEnv(page, { envId: 'dev', defaultEnv: 'prod' });
    await page.reload();
    await page.waitForSelector('#menu-btn', { timeout: 6000 });
    await page.click('#menu-btn');
    await page.waitForSelector('.menu-panel', { timeout: 4000 });
    const labels = await page.$$eval('.menu-item', els => els.map(el => el.textContent));
    check('Hoje is not in the drawer on a non-default env, got: ' + JSON.stringify(labels), !labels.some(l => l.includes('Hoje')));
    check('Tarefas is not in the drawer on a non-default env, got: ' + JSON.stringify(labels), !labels.some(l => l.includes('Tarefas')));
    check('Insumos (a non-personal page) is still in the drawer, got: ' + JSON.stringify(labels), labels.some(l => l.includes('Insumos')));

    await page.goto(ORIGIN + '/index.html');
    await page.waitForSelector('.tile', { timeout: 6000 });
    const tiles = await page.$$eval('.tile .label', els => els.map(el => el.textContent));
    check('Hoje is not a dashboard tile on a non-default env, got: ' + JSON.stringify(tiles), !tiles.includes('Hoje'));
    check('Tarefas is not a dashboard tile on a non-default env, got: ' + JSON.stringify(tiles), !tiles.includes('Tarefas'));
    check('Produção-group tiles are unaffected, got: ' + JSON.stringify(tiles), tiles.includes('Insumos'));
    await ctx.close();
  }

  // --- on the default env, the menu/dashboard show Hoje/Tarefas as
  // before (regression guard) ------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    await withApiFake(ctx);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/index.html');
    await seedEnv(page, { envId: 'dev', defaultEnv: 'dev' });
    await page.reload();
    await page.waitForSelector('.tile', { timeout: 6000 });
    const tiles = await page.$$eval('.tile .label', els => els.map(el => el.textContent));
    check('Hoje IS a dashboard tile on the default env, got: ' + JSON.stringify(tiles), tiles.includes('Hoje'));
    check('Tarefas IS a dashboard tile on the default env, got: ' + JSON.stringify(tiles), tiles.includes('Tarefas'));
    await ctx.close();
  }

  // --- an environment's own menuHidden (Aplicativo, phase 3) drops that
  // page from BOTH the drawer and the dashboard tiles, on the DEFAULT env
  // (the "dia" group rule above is a separate, additional filter — this one
  // must work even when isDefaultEnv() is true) --------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    await withApiFake(ctx);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/tarefas.html');
    await seedEnv(page, { envId: 'dev', defaultEnv: 'dev', menuHidden: { dev: ['fornecedores'] } });
    await page.reload();
    await page.waitForSelector('#menu-btn', { timeout: 6000 });
    await page.click('#menu-btn');
    await page.waitForSelector('.menu-panel', { timeout: 4000 });
    const labels = await page.$$eval('.menu-item', els => els.map(el => el.textContent));
    check('Fornecedores is hidden from the drawer per this environment\'s own preference, got: ' + JSON.stringify(labels),
      !labels.some(l => l.includes('Fornecedores')));
    check('Tarefas (an unrelated page) is still shown, got: ' + JSON.stringify(labels), labels.some(l => l.includes('Tarefas')));

    await page.goto(ORIGIN + '/index.html');
    await page.waitForSelector('.tile', { timeout: 6000 });
    const tiles = await page.$$eval('.tile .label', els => els.map(el => el.textContent));
    check('Fornecedores is not a dashboard tile either, got: ' + JSON.stringify(tiles), !tiles.includes('Fornecedores'));
    check('other Produção tiles are unaffected, got: ' + JSON.stringify(tiles), tiles.includes('Insumos'));
    await ctx.close();
  }

  // --- switching environments applies THAT environment's own menuHidden,
  // never the other one's - prod's own hidden list must not leak into dev
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    await withApiFake(ctx);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/tarefas.html');
    await seedEnv(page, { envId: 'dev', defaultEnv: 'dev', menuHidden: { dev: [], prod: ['financeiro'] } });
    await page.reload();
    await page.waitForSelector('#menu-btn', { timeout: 6000 });
    await page.click('#menu-btn');
    await page.waitForSelector('.menu-panel', { timeout: 4000 });
    const labels = await page.$$eval('.menu-item', els => els.map(el => el.textContent));
    check('prod\'s own hidden page does not leak into a dev session, got: ' + JSON.stringify(labels),
      labels.some(l => l.includes('Financeiro')));
    await ctx.close();
  }

  // --- a server-provided menuHidden can never hide Home or Preferências,
  // even if it tried to - the one client-side guard against being locked
  // out of the menu entirely -------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    await withApiFake(ctx);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/tarefas.html');
    await seedEnv(page, { envId: 'dev', defaultEnv: 'dev', menuHidden: { dev: ['home', 'preferencias', 'fornecedores'] } });
    await page.reload();
    await page.waitForSelector('#menu-btn', { timeout: 6000 });
    await page.click('#menu-btn');
    await page.waitForSelector('.menu-panel', { timeout: 4000 });
    const labels = await page.$$eval('.menu-item', els => els.map(el => el.textContent));
    check('Home stays in the drawer no matter what, got: ' + JSON.stringify(labels), labels.some(l => l.includes('Home')));
    check('Preferências stays in the drawer no matter what, got: ' + JSON.stringify(labels), labels.some(l => l.includes('Preferências')));
    check('a genuinely hideable page is still actually hidden, got: ' + JSON.stringify(labels),
      !labels.some(l => l.includes('Fornecedores')));
    await ctx.close();
  }

  await browser.close();
  server.close();

  if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
  console.log('env-scope.test.js: ok');
})();
