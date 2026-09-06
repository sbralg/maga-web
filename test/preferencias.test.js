// Headless test for preferencias.html — the per-account settings page that
// talks to the Magá MCP jump host (MCP_BASE in shared-api.js), not to
// maga-api. Modeled structurally on test/env-scope.test.js (static file
// server on an ephemeral port, Playwright chromium, localStorage seeding,
// page.route interception) and test/hoje.test.js (stubbing conventions).
//
//   NODE_PATH=/opt/node22/lib/node_modules node test/preferencias.test.js
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
const MCP_BASE = 'https://mcp-jump-host.duiker-ghost.ts.net';

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(WEB_DIR, rel || 'preferencias.html');
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

// Seeds localStorage the way a completed OAuth login would (mirrors
// env-scope.test.js's seedEnv) plus the sessionStorage bearer token the
// preferences page separately requires (getMcpToken()/MCP_TOKEN_KEY).
async function seed(page, { pass = 'x', envId, defaultEnv, token } = {}) {
  await page.evaluate(({ pass, envId, defaultEnv, token }) => {
    if (pass) localStorage.setItem('checklist_pass', pass);
    if (envId) localStorage.setItem('checklist_env', envId);
    if (defaultEnv) {
      localStorage.setItem('checklist_envs_cache', JSON.stringify({
        defaultEnv, environments: [{ id: 'dev', label: 'Dev' }, { id: 'prod', label: 'Prod' }],
      }));
    }
    if (token) sessionStorage.setItem('maga_mcp_token', token);
  }, { pass, envId, defaultEnv, token });
}

const DEFAULT_GROUPS = [
  { jid: '120363111@g.us', label: 'Família' },
  { jid: '120363222@g.us', label: 'Trabalho' },
];

function makePrefs(overrides = {}) {
  const base = {
    effective: {
      displayName: 'Alexandre',
      slug: 'alexandre',
      scopes: ['mcp:read', 'mcp:send'],
      whatsapp: {
        selfNumber: '5511994452426',
        excludedGroups: [],
        queryApiUrl: 'http://192.168.1.8:47502',
        bridgeApiUrl: 'http://192.168.1.8:47501',
        sendAllowlist: ['5511900000000', '5511911111111'],
      },
      mail: {
        imapHost: 'imap.example.com',
        imapPort: 1143,
        user: 'blackmage568@proton.me',
        sendAllowlist: ['someone@example.com'],
      },
      calendar: { labels: ['Personal', 'Family'] },
      rateLimits: {
        sendMessagePerHour: 10,
        draftMailPerHour: 5,
        extendedSearchContactsPerDay: 3,
        magaWritePerHour: 30,
      },
      alerts: { ownerPhone: '+55 11 9****-2426' },
      maga: { defaultWebEnvironment: 'dev' },
    },
    overrides: {},
    bounds: {
      rateLimits: {
        sendMessagePerHour: { min: 0, max: 60 },
        draftMailPerHour: { min: 0, max: 30 },
        extendedSearchContactsPerDay: { min: 0, max: 10 },
        magaWritePerHour: { min: 0, max: 120 },
      },
    },
    locked: [],
    writable: true,
  };
  return Object.assign(base, overrides);
}

// Deep merge helper for the PUT fake below — the real server answers a save
// with the FULL effective object (see shared-prefs.js's own comment: "the
// page renders THOSE rather than what it just sent"), and preferencias.html
// takes that literally: saveSection() does `prefs.effective = data.effective`,
// a full replace, not a per-section patch. A fake that only echoed the saved
// section back would make every OTHER section vanish from prefs.effective
// after one save — so the fake must always return the complete, merged copy.
function deepMerge(target, patch) {
  const out = { ...target };
  for (const k of Object.keys(patch)) {
    if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]) &&
        target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      out[k] = deepMerge(target[k], patch[k]);
    } else {
      out[k] = patch[k];
    }
  }
  return out;
}

// Installs a fake for every /preferences* path under MCP_BASE. Returns
// {calls, putCalls, getPrefs} so a test can inspect exactly what the page
// requested and sent.
async function withPrefsFake(ctx, opts = {}) {
  let prefs = makePrefs(opts.prefsOverrides);
  const calls = [];   // every request path hit, in order
  const putCalls = []; // {section, body}
  const groupsMode = opts.groupsMode || 'ok'; // 'ok' | 'fail' | 'unreachable'
  const groupsList = opts.groupsList || DEFAULT_GROUPS;
  const rateLimitsError = opts.rateLimitsError || null;

  await ctx.route(MCP_BASE + '/**', async route => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    calls.push(pathname);
    const method = route.request().method();

    if (pathname === '/preferences' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(prefs) });
      return;
    }
    if (pathname === '/preferences/whatsapp/groups') {
      if (groupsMode === 'fail') { await route.fulfill({ status: 500, body: 'oops' }); return; }
      const reachable = groupsMode !== 'unreachable';
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ groups: reachable ? groupsList : [], reachable }),
      });
      return;
    }
    if (pathname.startsWith('/preferences/person/') && method === 'PUT') {
      const section = pathname.split('/').pop();
      const body = JSON.parse(route.request().postData() || '{}');
      putCalls.push({ section, body });
      if (section === 'rateLimits' && rateLimitsError) {
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify(rateLimitsError) });
        return;
      }
      prefs = { ...prefs, effective: deepMerge(prefs.effective, { [section]: body }) };
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ effective: prefs.effective, overrides: prefs.overrides }),
      });
      return;
    }
    await route.fulfill({ status: 404, body: 'not found' });
  });

  return { calls, putCalls, getPrefs: () => prefs };
}

(async () => {
  const failures = [];
  let assertions = 0;
  const check = (label, cond) => { assertions++; if (!cond) failures.push('FAIL: ' + label); };
  const server = await serve();
  const ORIGIN = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  // --- 1. no passphrase at all: login screen, zero MCP requests ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const { calls } = await withPrefsFake(ctx);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await page.waitForSelector('.login', { timeout: 6000 });
    check('the login screen renders when there is no passphrase', await page.$('.login') !== null);
    const title = await page.textContent('.login h2');
    check('the login screen is titled Preferências, got: ' + title, /Preferências/.test(title));
    check('no request reached the MCP jump host at all while logged out', calls.length === 0);
    await ctx.close();
  }

  // --- 2. passphrase but no token: "Entrar" button, no /preferences call -
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const { calls } = await withPrefsFake(ctx);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x' });
    await page.reload();
    await page.waitForSelector('#signin', { timeout: 6000 });
    check('the Entrar button renders with no MCP token', (await page.textContent('#signin')).includes('Entrar'));
    check('no /preferences call was made before signing in', !calls.includes('/preferences'));
    await ctx.close();
  }

  // --- 3. passphrase + token: full render with real values ----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const { calls } = await withPrefsFake(ctx);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('#f-displayName', { timeout: 6000 });
    check('GET /preferences was called', calls.includes('/preferences'));
    check('the display name input carries the effective value',
      await page.$eval('#f-displayName', el => el.value) === 'Alexandre');
    for (const key of ['sendMessagePerHour', 'draftMailPerHour', 'extendedSearchContactsPerDay', 'magaWritePerHour']) {
      const val = await page.$eval('#f-' + key, el => el.value).catch(() => null);
      check('rate-limit input #f-' + key + ' carries its value, got ' + val, val === String(makePrefs().effective.rateLimits[key]));
    }
    await page.click('summary'); // open the Infraestrutura <details>
    const infraText = await page.textContent('details.infra');
    check('Infraestrutura shows the read-only IMAP host:port', infraText.includes('imap.example.com:1143'));
    check('Infraestrutura shows the masked owner phone', infraText.includes('+55 11 9****-2426'));
    await ctx.close();
  }

  // --- 4. non-default environment: privacy banner, ZERO MCP requests -----
  // Same rule env-scope.test.js already enforces for hoje.html/tarefas.html:
  // isDefaultEnv() must gate this page before it ever talks to the jump
  // host, so a session looking at someone ELSE's environment can't leak or
  // edit the signed-in account's own settings.
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const { calls } = await withPrefsFake(ctx);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', envId: 'dev', defaultEnv: 'prod', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('.banner', { timeout: 6000 });
    const text = await page.textContent('#root');
    check('the non-default-environment banner renders, got: ' + text.slice(0, 200),
      /ambiente padrão/.test(text) || /não do ambiente/.test(text));
    check('zero requests reached the MCP jump host on a non-default environment', calls.length === 0);
    check('the header/menu button is still shown so the user can navigate away', await page.$('#menu-btn') !== null);
    await ctx.close();
  }

  // --- 5. editing + saving the display name -------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const { putCalls } = await withPrefsFake(ctx);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('#f-displayName', { timeout: 6000 });
    await page.fill('#f-displayName', 'Ale');
    await page.click('[data-save="identity"]');
    await page.waitForFunction(() => (document.getElementById('saved-identity') || {}).textContent === 'Salvo.', null, { timeout: 6000 });
    check('exactly one PUT for the identity section', putCalls.filter(c => c.section === 'identity').length === 1);
    const call = putCalls.find(c => c.section === 'identity');
    check('the PUT body is {displayName:"Ale"}, got ' + JSON.stringify(call.body),
      JSON.stringify(call.body) === JSON.stringify({ displayName: 'Ale' }));
    check('the page shows a saved confirmation', (await page.textContent('#saved-identity')) === 'Salvo.');
    await ctx.close();
  }

  // --- 6. ticking a group checkbox and saving whatsapp --------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const { putCalls } = await withPrefsFake(ctx);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('.grouprow input[type=checkbox]', { timeout: 6000 });
    await page.check('input[data-jid="120363222@g.us"]');
    await page.click('[data-save="whatsapp"]');
    await page.waitForFunction(() => (document.getElementById('saved-whatsapp') || {}).textContent === 'Salvo.', null, { timeout: 6000 });
    const call = putCalls.find(c => c.section === 'whatsapp');
    check('a whatsapp PUT was sent', !!call);
    const excluded = call && call.body && call.body.excludedGroups;
    check('excludedGroups is an array', Array.isArray(excluded));
    check('excludedGroups contains the ticked jid as {jid,label}, got ' + JSON.stringify(excluded),
      Array.isArray(excluded) && excluded.some(g => g.jid === '120363222@g.us' && g.label === 'Trabalho'));
    await ctx.close();
  }

  // --- 7. a 400 invalid_preference on rateLimits ---------------------------
  // limitRow() (the markup for each rate-limit row) never emits a `.err`
  // element, so saveSection()'s `[data-field="..."] .err` lookup found no
  // holder for a rateLimits field and fell through to a plain alert(). The
  // page now emits one per row, so a named 400 lands under the input that
  // caused it — which is the whole point of the server naming the field.
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const rateLimitsError = { error: 'invalid_preference', field: 'rateLimits.sendMessagePerHour', message: 'Máximo é 60 por hora.' };
    await withPrefsFake(ctx, { rateLimitsError });
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('#f-sendMessagePerHour', { timeout: 6000 });

    const holderExists = await page.$('[data-field="sendMessagePerHour"] .err') !== null;
    check('the rate-limit row carries an inline error slot', holderExists);

    // A dialog here would mean the inline path silently regressed to the old
    // alert() fallback, so the listener is a trap rather than an expectation.
    let dialogMessage = null;
    page.once('dialog', async d => { dialogMessage = d.message(); await d.accept(); });
    await page.click('[data-save="rateLimits"]');
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-field="sendMessagePerHour"] .err');
      return el && !el.hidden && el.textContent.length > 0;
    }, null, { timeout: 6000 });
    const inlineMessage = await page.textContent('[data-field="sendMessagePerHour"] .err');
    check('the 400 message lands under the offending input, got: ' + inlineMessage,
      inlineMessage.includes('Máximo é 60 por hora.'));
    check('no alert() fallback fired for a field-named 400', dialogMessage === null);
    await ctx.close();
  }

  // --- 8a. whatsapp/groups route fails outright ----------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    await withPrefsFake(ctx, { groupsMode: 'fail', prefsOverrides: {
      effective: Object.assign({}, makePrefs().effective, {
        whatsapp: Object.assign({}, makePrefs().effective.whatsapp, { excludedGroups: ['120363111@g.us'] }),
      }),
    } });
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('#f-displayName', { timeout: 6000 });
    check('the rest of the page still renders when the groups fetch fails',
      await page.$eval('#f-displayName', el => el.value) === 'Alexandre');
    await page.waitForFunction(() =>
      (document.getElementById('groups-box') || {}).textContent.includes('120363111@g.us'), null, { timeout: 6000 });
    const box1 = await page.textContent('#groups-box');
    check('an already-muted group is still listed (so it can be un-muted) when the bridge is unreachable',
      box1.includes('120363111@g.us') && (await page.$('#groups-box input[data-jid="120363111@g.us"]:checked')) !== null);
    await ctx.close();
  }

  // --- 8b. whatsapp/groups returns reachable:false explicitly --------------
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    await withPrefsFake(ctx, { groupsMode: 'unreachable', prefsOverrides: {
      effective: Object.assign({}, makePrefs().effective, {
        whatsapp: Object.assign({}, makePrefs().effective.whatsapp, { excludedGroups: ['120363222@g.us'] }),
      }),
    } });
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('#f-displayName', { timeout: 6000 });
    check('the page still renders normally when groups reports reachable:false',
      await page.$eval('#f-displayName', el => el.value) === 'Alexandre');
    await page.waitForFunction(() =>
      (document.getElementById('groups-box') || {}).textContent.includes('120363222@g.us'), null, { timeout: 6000 });
    const box2 = await page.textContent('#groups-box');
    check('the already-muted group is listed when reachable:false, got: ' + box2, box2.includes('120363222@g.us'));
    await ctx.close();
  }

  // --- 9. the drawer lists Preferências and every menu destination --------
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    await withPrefsFake(ctx);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('#menu-btn', { timeout: 6000 });
    await page.click('#menu-btn');
    await page.waitForSelector('.menu-panel.open', { timeout: 6000 });
    const menuLinks = await page.$$eval('.menu-item', els =>
      els.map(e => ({ tag: e.tagName, text: e.textContent.trim() })));
    const menuCount = await page.evaluate(() => MENU_ITEMS.length);
    // menuLinks includes the logout button, which also carries .menu-item —
    // same convention test/tarefas.test.js already uses for this exact count.
    check('the drawer lists every destination plus logout, got ' + menuLinks.length + ' for ' + menuCount + ' modules',
      menuLinks.length === menuCount + 1);
    check('Preferências is in the drawer and renders as the current page (inert label)',
      menuLinks.some(m => m.tag === 'SPAN' && m.text.includes('Preferências')));
    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log('preferencias.test.js: ' + assertions + ' assertions, ' + failures.length + ' failures');
  if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
  console.log('preferencias.test.js: ok');
})();
