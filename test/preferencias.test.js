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

// Server order is already busiest-first (see maga-infra's own test for the
// sorting itself) - Família intentionally comes first here with a higher
// rate, so a test can catch the page re-sorting or dropping avgPerDay
// without needing its own fixture.
const DEFAULT_GROUPS = [
  { jid: '120363111@g.us', label: 'Família', avgPerDay: 3.5 },
  { jid: '120363222@g.us', label: 'Trabalho', avgPerDay: 0.2 },
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

// Applies one PUT the same two ways the real server's mergePerson() does:
// the rich {number,label}/{jid,label} shape is kept VERBATIM in `overrides`
// (what GET /preferences echoes back as the raw overlay), while `effective`
// only ever gets the flat string form security code and every other render
// path expects. A fake that only updated `effective` (the original version
// of this helper) could never have caught the real "labels vanish on
// reload" bug, because prefs.overrides would just stay an empty object
// forever - the exact shape the client's own recovery logic depends on.
function applyPutToPrefs(prefs, section, body) {
  const overrides = { ...prefs.overrides, [section]: deepMerge(prefs.overrides[section] || {}, body) };
  let effective = { ...prefs.effective };
  if (section === 'whatsapp') {
    effective.whatsapp = { ...effective.whatsapp };
    if ('selfNumber' in body) effective.whatsapp.selfNumber = body.selfNumber;
    if (body.excludedGroups) effective.whatsapp.excludedGroups = body.excludedGroups.map(g => g.jid);
    if (body.sendAllowlist) effective.whatsapp.sendAllowlist = body.sendAllowlist.map(e => e.number);
  } else if (section === 'mail' && body.sendAllowlist) {
    effective.mail = { ...effective.mail, sendAllowlist: [...body.sendAllowlist] };
  } else {
    effective = deepMerge(effective, { [section]: body });
  }
  return { ...prefs, effective, overrides };
}

// Waits for the page to have ATTEMPTED a navigation to one of the two
// MCP-server endpoints (`/authorize`, `/logout`) that startOAuth()/
// startPreferencesReauth() drive via bare `location.href` assignment.
//
// Getting this right took two failed approaches, worth recording since a
// future navigation-triggering test here will hit the same wall: a real
// cross-origin navigation to an unreachable host (MCP_BASE only exists as a
// mock in these tests) destroys the current document - and everything a
// test still needs from it, like sessionStorage - the moment the browser
// commits to it. That happened whether the request was aborted, fulfilled
// with real content, or left to time out via a plain ctx.route() handler,
// and in every case fast enough to occasionally take the whole browser
// process down with it if a test kept reading from the page afterward
// (confirmed empirically, not just reasoned about). A CDP `Page.stopLoading`
// issued the instant the request was seen worked, but added a second event
// stream (a raw CDP session) to keep in sync with everything else.
//
// The actual fix needed no client-side trickery at all: per the HTML
// navigation spec, a top-level navigation whose response is 204 No Content
// (or 205) is simply ABANDONED by the browser - nothing commits, the
// current document is untouched. So the fake answers both endpoints with a
// plain 204 (see withPrefsFake below) and records that the request
// happened; this function just polls that record rather than opening a
// second stream, since the route handler is already the one place every
// MCP_BASE request passes through.
async function waitForNav(otherCalls, pathname, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = otherCalls.find(c => c.pathname === pathname);
    if (hit) return new URL(hit.url);
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('no navigation to ' + pathname + ' within ' + timeoutMs + 'ms');
}

// Installs a fake for every /preferences* path under MCP_BASE. Returns
// {calls, putCalls, otherCalls, getPrefs} so a test can inspect exactly what
// the page requested and sent.
//
// New in the phase-2 extension: sessions/password/export/import/contact
// routes, an optional `putOverride(section, body)` hook so a single save
// (e.g. the allow-list PUT, not the muted-groups PUT that shares the same
// section name) can be made to answer 428. The two bare-navigation targets
// (`/authorize`, `/logout`) are NOT handled here in any special way - see
// watchNav() above for how a test observes those safely.
async function withPrefsFake(ctx, opts = {}) {
  let prefs = makePrefs(opts.prefsOverrides);
  const calls = [];      // every request path hit, in order
  const putCalls = [];   // {section, body}
  const otherCalls = []; // {pathname, method, body?, query?} for the non-GET/PUT-person routes
  const groupsMode = opts.groupsMode || 'ok'; // 'ok' | 'fail' | 'unreachable'
  const groupsList = opts.groupsList || DEFAULT_GROUPS;
  const rateLimitsError = opts.rateLimitsError || null;
  const putOverride = opts.putOverride || null; // (section, body) => {status, body} | null
  const contactResult = opts.contactResult || (() => ({ reachable: true, matches: [] }));
  const contactSearchResult = opts.contactSearchResult || (() => ({ reachable: true, matches: [] }));
  const sessionsList = opts.sessionsList || [
    { clientId: 'maga-web', current: true, signedInAt: '2026-09-01T10:00:00Z' },
  ];
  const revokedCount = opts.revokedCount != null ? opts.revokedCount : 2;
  const passwordResult = opts.passwordResult || (() => ({ status: 200, body: { otherSessionsRevoked: 1 } }));
  const exportResult = opts.exportResult || (() => ({ exportedAt: '2026-09-06T00:00:00Z', person: {} }));
  const importResult = opts.importResult || (body => ({ status: 200, body: { imported: Object.keys(body || {}), effective: prefs.effective } }));

  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization,content-type',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  };

  await ctx.route(MCP_BASE + '/**', async route => {
    const req = route.request();
    const fulfill = (opts) => route.fulfill({ ...opts, headers: { ...CORS, ...(opts.headers || {}) } });
    const url = new URL(req.url());
    const pathname = url.pathname;
    calls.push(pathname);
    const method = req.method();
    if (process.env.TRACE) console.log('      ROUTE ' + method + ' ' + pathname);
    if (method === 'OPTIONS') { await fulfill({ status: 204 }); return; }

    if (pathname === '/authorize' || pathname === '/logout') {
      // Both are top-level navigations the page drives via location.href.
      // Answering with 204 No Content is what makes them observable without
      // being disruptive: a main-frame navigation that receives a 204 is
      // ABANDONED by the browser, so the request is recorded here, nothing
      // navigates, and the current document (and its sessionStorage) stays
      // readable by the assertions that follow. Aborting instead commits a
      // real cross-origin failure that destroys the document.
      otherCalls.push({ pathname, method, url: req.url() });
      await fulfill({ status: 204 });
      return;
    }

    if (pathname === '/preferences' && method === 'GET') {
      await fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(prefs) });
      return;
    }
    if (pathname === '/preferences/whatsapp/groups') {
      if (groupsMode === 'fail') { await fulfill({ status: 500, body: 'oops' }); return; }
      const reachable = groupsMode !== 'unreachable';
      await fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ groups: reachable ? groupsList : [], reachable }),
      });
      return;
    }
    if (pathname === '/preferences/whatsapp/contact' && method === 'GET') {
      const number = url.searchParams.get('number');
      otherCalls.push({ pathname, method, query: number });
      await fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contactResult(number)) });
      return;
    }
    if (pathname === '/preferences/whatsapp/contact-search' && method === 'GET') {
      const name = url.searchParams.get('name');
      otherCalls.push({ pathname, method, query: name });
      await fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contactSearchResult(name)) });
      return;
    }
    if (pathname === '/preferences/sessions' && method === 'GET') {
      otherCalls.push({ pathname, method });
      await fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: sessionsList }) });
      return;
    }
    if (pathname === '/preferences/sessions/revoke-others' && method === 'POST') {
      otherCalls.push({ pathname, method });
      await fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revoked: revokedCount }) });
      return;
    }
    if (pathname === '/preferences/password' && method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      otherCalls.push({ pathname, method, body });
      const r = passwordResult(body);
      await fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
      return;
    }
    if (pathname === '/preferences/export' && method === 'GET') {
      otherCalls.push({ pathname, method });
      await fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(exportResult()) });
      return;
    }
    if (pathname === '/preferences/import' && method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      otherCalls.push({ pathname, method, body });
      const r = importResult(body);
      await fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
      return;
    }
    if (pathname.startsWith('/preferences/person/') && method === 'PUT') {
      const section = pathname.split('/').pop();
      const body = JSON.parse(req.postData() || '{}');
      putCalls.push({ section, body });
      const override = putOverride && putOverride(section, body);
      if (override) {
        await fulfill({ status: override.status, contentType: 'application/json', body: JSON.stringify(override.body) });
        return;
      }
      if (section === 'rateLimits' && rateLimitsError) {
        await fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify(rateLimitsError) });
        return;
      }
      prefs = applyPutToPrefs(prefs, section, body);
      await fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ effective: prefs.effective, overrides: prefs.overrides }),
      });
      return;
    }
    await fulfill({ status: 404, body: 'not found' });
  });

  return { calls, putCalls, otherCalls, getPrefs: () => prefs };
}

(async () => {
  const failures = [];
  let assertions = 0;
  // TRACE=1 streams each assertion and (below) each intercepted request as
  // they happen. This file only prints a summary at the end, so without it a
  // hang or a stall is invisible - which cost real time once already.
  const check = (label, cond) => { assertions++; if (process.env.TRACE) console.log((cond?'ok   ':'FAIL ') + label.slice(0,70)); if (!cond) failures.push('FAIL: ' + label); };
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

  // --- 6b. groups render in the server's order (busiest first) and show
  // the messages/day rate, without the page re-sorting or dropping it -----
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    await withPrefsFake(ctx, {
      prefsOverrides: { effective: Object.assign({}, makePrefs().effective, {
        whatsapp: Object.assign({}, makePrefs().effective.whatsapp, { excludedGroups: ['999999@g.us'] }),
      }) },
    });
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('.grouprow', { timeout: 6000 });
    const rows = await page.$$eval('.grouprow', els => els.map(el => el.textContent.trim()));
    check('Família (the busier group, 3.5/dia) renders before Trabalho, got: ' + JSON.stringify(rows),
      rows[0].includes('Família') && rows[1].includes('Trabalho'));
    check('the busier group shows its rate, got: ' + rows[0], /3,5\/dia/.test(rows[0]));
    check('the quieter group shows its own (lower) rate, got: ' + rows[1], /0,2\/dia/.test(rows[1]));
    // The muted group with no recent activity (appended because it's
    // excludedGroups but absent from the 14-day fetch) must render with NO
    // rate at all - "no data in this window" is not the same as "0,0/dia".
    const mutedRow = rows.find(r => r.includes('999999@g.us'));
    check('a muted-but-quiet group still renders, got rows: ' + JSON.stringify(rows), !!mutedRow);
    check('it shows no fabricated rate, got: ' + mutedRow, !/\/dia/.test(mutedRow));
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

  // ==== Phase 2: allow-lists, password, sessions, backup ===================

  // --- 10. allow-list rows: one per configured WhatsApp/e-mail recipient --
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    await withPrefsFake(ctx);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('#wa-allow .entry', { timeout: 6000 });
    const waRows = await page.$$eval('#wa-allow .entry', els => els.map(e => e.dataset.value));
    check('one WhatsApp allow-list row per configured recipient, got ' + JSON.stringify(waRows),
      waRows.length === 2 && waRows.includes('5511900000000') && waRows.includes('5511911111111'));
    const mailRows = await page.$$eval('#mail-allow .entry', els => els.map(e => e.dataset.value));
    check('one e-mail allow-list row per configured address, got ' + JSON.stringify(mailRows),
      mailRows.length === 1 && mailRows[0] === 'someone@example.com');
    await ctx.close();
  }

  // --- 11. removing a WhatsApp row, then saving, drops it from the PUT body
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const { putCalls } = await withPrefsFake(ctx);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('#wa-allow .entry', { timeout: 6000 });
    await page.click('#wa-allow .entry[data-value="5511900000000"] [data-remove]');
    check('the removed row is gone from the DOM immediately',
      await page.$('#wa-allow .entry[data-value="5511900000000"]') === null);
    await page.click('[data-save="whatsappAllow"]');
    await page.waitForFunction(() => (document.getElementById('saved-whatsappAllow') || {}).textContent === 'Salvo.', null, { timeout: 6000 });
    const waAllowCall = putCalls.filter(c => c.section === 'whatsapp' && c.body && c.body.sendAllowlist).pop();
    check('a whatsapp PUT with sendAllowlist was sent', !!waAllowCall);
    const numbers = waAllowCall && waAllowCall.body.sendAllowlist.map(e => e.number);
    check('the removed number is gone from the saved sendAllowlist, got ' + JSON.stringify(numbers),
      Array.isArray(numbers) && !numbers.includes('5511900000000') && numbers.includes('5511911111111'));
    await ctx.close();
  }

  // --- 11b. pre-existing (bare-string) allow-list entries get their names
  // resolved live, the same way muted groups always do - not just entries
  // added through Verificar+Adicionar. Regression test for a real gap: only
  // the "add" flow ever captured a label, so anything already in
  // people.json (every entry that existed before this page did, per
  // makePrefs()'s own default fixture of bare strings) rendered as a bare
  // number forever.
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const contactResult = number => ({
      reachable: true,
      matches: number === '5511900000000' ? [{ name: 'Mãe' }] : [],
    });
    await withPrefsFake(ctx, { contactResult });
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('#wa-allow', { timeout: 6000 });
    await page.waitForFunction(() => {
      const row = document.querySelector('.entry[data-kind="wa"][data-value="5511900000000"] .who');
      return row && row.textContent.includes('Mãe');
    }, null, { timeout: 6000 });
    const resolvedRow = await page.textContent('.entry[data-kind="wa"][data-value="5511900000000"] .who');
    check('a pre-existing allow-list entry with no stored label is resolved to a name on load, got: ' + resolvedRow,
      resolvedRow.includes('Mãe'));
    // Resolution is SEQUENTIAL (one row at a time, deliberately - see the
    // page's own comment on why), so the moment row 1 settles, row 2 may
    // only just have started and briefly reads "verificando…" - wait for
    // IT to settle too rather than reading it the instant row 1 finishes.
    await page.waitForFunction(() => {
      const row = document.querySelector('.entry[data-kind="wa"][data-value="5511911111111"] .who');
      return row && !/verificando/.test(row.textContent);
    }, null, { timeout: 6000 });
    const unresolvedRow = await page.textContent('.entry[data-kind="wa"][data-value="5511911111111"] .who');
    check('a number with no contact match still falls back to showing the bare number, got: ' + unresolvedRow,
      unresolvedRow.trim() === '5511911111111');
    await ctx.close();
  }

  // --- 11c. Adicionar refuses an exact duplicate, for both lists ----------
  // Regression test for a real bug: nothing stopped the same number/address
  // from being added over and over, which is exactly how a live account
  // ended up with the same WhatsApp number listed four times.
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    await withPrefsFake(ctx);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('#wa-new', { timeout: 6000 });

    const waCountBefore = await page.$$eval('.entry[data-kind="wa"]', els => els.length);
    await page.fill('#wa-new', '5511900000000'); // already present in makePrefs()'s fixture
    await page.click('#wa-add');
    const waCountAfter = await page.$$eval('.entry[data-kind="wa"]', els => els.length);
    check('adding a WhatsApp number already on the list does not create a second row',
      waCountAfter === waCountBefore);
    const waMsg = await page.textContent('#wa-resolved');
    check('adding a duplicate WhatsApp number says so, got: ' + waMsg, /já está na lista/i.test(waMsg));

    const mailCountBefore = await page.$$eval('.entry[data-kind="mail"]', els => els.length);
    await page.fill('#mail-new', 'someone@example.com'); // already present in makePrefs()'s fixture
    await page.click('#mail-add');
    const mailCountAfter = await page.$$eval('.entry[data-kind="mail"]', els => els.length);
    check('adding an e-mail already on the list does not create a second row',
      mailCountAfter === mailCountBefore);
    const mailErr = await page.textContent('[data-field="mailAllowlist"] .err');
    check('adding a duplicate e-mail says so, got: ' + mailErr, /já está na lista/i.test(mailErr));
    await ctx.close();
  }

  // --- 12. Verificar resolves a name; Adicionar + Salvar sends {number,label}
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const contactResult = number => ({ reachable: true, matches: number === '5511922223333' ? [{ name: 'Nice Person' }] : [] });
    const { putCalls, otherCalls } = await withPrefsFake(ctx, { contactResult });
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('#wa-new', { timeout: 6000 });
    await page.fill('#wa-new', '5511922223333');
    await page.click('#wa-check');
    await page.waitForFunction(() => (document.getElementById('wa-resolved') || {}).textContent.includes('Nice Person'), null, { timeout: 6000 });
    check('a contact lookup request reached /preferences/whatsapp/contact with the typed number',
      otherCalls.some(c => c.pathname === '/preferences/whatsapp/contact' && c.query === '5511922223333'));
    check('the resolved contact name is shown on the page',
      (await page.textContent('#wa-resolved')).includes('Nice Person'));

    await page.click('#wa-add');
    check('a new row was added for the added number',
      await page.$('#wa-allow .entry[data-value="5511922223333"]') !== null);

    await page.click('[data-save="whatsappAllow"]');
    await page.waitForFunction(() => (document.getElementById('saved-whatsappAllow') || {}).textContent === 'Salvo.', null, { timeout: 6000 });
    const call = putCalls.filter(c => c.section === 'whatsapp' && c.body && c.body.sendAllowlist).pop();
    const added = call && call.body.sendAllowlist.find(e => e.number === '5511922223333');
    check('the saved entry carries {number,label} with the resolved name as the label, got ' + JSON.stringify(added),
      !!added && added.label === 'Nice Person');

    // --- 12b. reloading after that save shows the name immediately, with NO
    // fresh lookup - regression test for a real reported bug: a label
    // resolved via Verificar+Adicionar+Salvar vanished on every reload,
    // because render() only ever read prefs.effective (always bare numbers
    // post-merge) and never prefs.overrides (where the real {number,label}
    // pair actually survives). otherCalls.length is checked BEFORE reload
    // so the "no new lookup" assertion below can't be satisfied by a lookup
    // that simply never ran in this test at all.
    // Other pre-existing (still-unlabeled) rows on this fixture legitimately
    // get looked up again on every reload - the assertion below only cares
    // about the one number that was JUST resolved and saved, so it counts
    // lookups for THAT number specifically rather than the endpoint's total.
    const lookupsFor = num => otherCalls.filter(c => c.pathname === '/preferences/whatsapp/contact' && c.query === num).length;
    const lookupsBeforeReload = lookupsFor('5511922223333');
    await page.reload();
    await page.waitForSelector('#wa-allow .entry', { timeout: 6000 });
    const rowText = await page.textContent('.entry[data-kind="wa"][data-value="5511922223333"] .who');
    check('the resolved name is shown on the very first render after reload, got: ' + rowText,
      rowText.includes('Nice Person'));
    // Give resolveAllowlistNamesLater() a moment to run (it always fires
    // after render()) so a wrongly-triggered re-lookup has time to show up.
    await page.waitForTimeout(300);
    check('no fresh contact lookup ran for an already-labeled entry after reload, before=' +
      lookupsBeforeReload + ' after=' + lookupsFor('5511922223333'),
      lookupsFor('5511922223333') === lookupsBeforeReload);
    await ctx.close();
  }

  // --- 12c. Verificar searches BY NAME when what's typed has letters,
  // shows a plain pick-list on multiple matches, and picking one behaves
  // exactly like a resolved number lookup for Adicionar --------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const contactSearchResult = name => {
      if (name === 'facco') {
        return { reachable: true, matches: [
          { name: 'João Facco', phone: '5511900000001' },
          { name: 'Facco Jr', phone: '5511900000002' },
        ] };
      }
      if (name === 'ninguem') return { reachable: true, matches: [] };
      if (name === 'quebrado') return { reachable: false };
      return { reachable: true, matches: [] };
    };
    const { otherCalls } = await withPrefsFake(ctx, { contactSearchResult });
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('#wa-new', { timeout: 6000 });

    await page.fill('#wa-new', 'facco');
    await page.click('#wa-check');
    await page.waitForSelector('#wa-resolved .pick-list button', { timeout: 6000 });
    check('a name search reached /preferences/whatsapp/contact-search, not the number endpoint',
      otherCalls.some(c => c.pathname === '/preferences/whatsapp/contact-search' && c.query === 'facco'));
    const picks = await page.$$eval('#wa-resolved .pick-list button', els => els.map(el => el.textContent));
    check('both matches are listed as a plain list, got: ' + JSON.stringify(picks),
      picks.length === 2 && picks.some(p => p.includes('João Facco')) && picks.some(p => p.includes('Facco Jr')));

    await page.click('#wa-resolved .pick-list button:has-text("Facco Jr")');
    check('picking a match fills the number field', await page.$eval('#wa-new', el => el.value) === '5511900000002');
    check('picking a match shows the resolved-name confirmation, same as a number lookup',
      (await page.textContent('#wa-resolved')).includes('Facco Jr'));

    await page.click('#wa-add');
    check('the picked contact was added with the picked name as its label',
      await page.$('#wa-allow .entry[data-value="5511900000002"][data-label="Facco Jr"]') !== null);

    await page.fill('#wa-new', 'ninguem');
    await page.click('#wa-check');
    // "Procurando…" is set synchronously before the search starts (same
    // race this file already avoids elsewhere) - wait for the SPECIFIC
    // settled text, not just any non-empty content.
    await page.waitForFunction(() => (document.getElementById('wa-resolved') || {}).textContent.includes('Nenhum contato encontrado'), null, { timeout: 6000 });
    check('zero name matches says so plainly, got: ' + await page.textContent('#wa-resolved'),
      (await page.textContent('#wa-resolved')).includes('Nenhum contato encontrado'));

    await page.fill('#wa-new', 'quebrado');
    await page.click('#wa-check');
    await page.waitForFunction(() => (document.getElementById('wa-resolved') || {}).textContent.includes('não respondeu'), null, { timeout: 6000 });
    check('an unreachable bridge during a name search says so, got: ' + await page.textContent('#wa-resolved'),
      (await page.textContent('#wa-resolved')).includes('não respondeu'));

    // A WhatsApp @username can't be resolved by this stack at all (whatsmeow
    // has no username support) - typing one must be caught client-side with
    // an explanation, never sent to the server as a doomed name search.
    const searchCallsBefore = otherCalls.filter(c => c.pathname === '/preferences/whatsapp/contact-search').length;
    await page.fill('#wa-new', '@ronaldoaoki');
    await page.click('#wa-check');
    await page.waitForFunction(() => (document.getElementById('wa-resolved') || {}).textContent.length > 0, null, { timeout: 6000 });
    const usernameMsg = await page.textContent('#wa-resolved');
    check('an @username is refused with a clear reason, got: ' + usernameMsg,
      usernameMsg.includes('@ronaldoaoki') && /usuário do whatsapp/i.test(usernameMsg));
    const searchCallsAfter = otherCalls.filter(c => c.pathname === '/preferences/whatsapp/contact-search').length;
    check('no request was sent for the @username - it never had a chance of resolving',
      searchCallsAfter === searchCallsBefore);
    await ctx.close();
  }

  // --- 13. an unreachable bridge still lets a number be added -------------
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const contactResult = () => ({ reachable: false, matches: [] });
    await withPrefsFake(ctx, { contactResult });
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('#wa-new', { timeout: 6000 });
    await page.fill('#wa-new', '5511955556666');
    await page.click('#wa-check');
    // "Procurando…" is set SYNCHRONOUSLY before the lookup starts, so
    // waiting for any non-empty text resolves instantly on the placeholder
    // and reads it instead of the answer - the same stale-signal race this
    // repo hit with .ins-head. Wait for the placeholder to be replaced.
    await page.waitForFunction(() => {
      const t = (document.getElementById('wa-resolved') || {}).textContent || '';
      return t.length > 0 && !/procurando/i.test(t);
    }, null, { timeout: 6000 });
    const resolvedText = await page.textContent('#wa-resolved');
    check('the page says it could not verify when the bridge is unreachable, got: ' + resolvedText,
      /não deu para verificar/i.test(resolvedText));
    await page.click('#wa-add');
    check('the number can still be added despite the failed verification',
      await page.$('#wa-allow .entry[data-value="5511955556666"]') !== null);
    await ctx.close();
  }

  // --- 14. a 428 on the allow-list save shows confirmModal, and accepting
  // it navigates to MCP_BASE/logout?return=...reauth=1... -----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const reauthBody = { error: 'reauth_required', message: 'Confirme sua senha para alterar este ajuste.' };
    const putOverride = (section, body) => (section === 'whatsapp' && body && body.sendAllowlist ? { status: 428, body: reauthBody } : null);
    const { otherCalls } = await withPrefsFake(ctx, { putOverride });
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('[data-save="whatsappAllow"]', { timeout: 6000 });
    await page.click('[data-save="whatsappAllow"]');
    await page.waitForSelector('.modal-backdrop', { timeout: 6000 });
    const dialogText = await page.textContent('.modal-card p');
    check('the 428 shows a confirmModal (not a native dialog) carrying the server message, got: ' + dialogText,
      dialogText.includes('Confirme sua senha para alterar este ajuste.'));

    // The click is dispatched via evaluate() rather than page.click():
    // Playwright's click() waits for a navigation it sees starting, and the
    // 204 means that navigation never commits, so the wait would outlast it.
    await page.evaluate(() => document.getElementById('confirm-ok').click());
    const navUrl = await waitForNav(otherCalls, '/logout');
    check('accepting navigates to the MCP-server /logout endpoint, got: ' + navUrl.href,
      navUrl.origin === MCP_BASE && navUrl.pathname === '/logout');
    const ret = navUrl.searchParams.get('return');
    check('the return= parameter carries reauth=1 so the page knows to resume the OAuth flow on the way back, got: ' + ret,
      !!ret && ret.includes('reauth=1'));
    await ctx.close();
  }

  // --- 15. the reauth=1 return hop: loop prevention ------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const { otherCalls } = await withPrefsFake(ctx);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html?reauth=1');
    await seed(page, { pass: 'x', token: 'tok-1' });

    // load() is called directly rather than via page.reload(): the reauth
    // branch navigates to /authorize during the document's initial script
    // run, before "load" ever fires, so a reload's own wait would never
    // resolve. The /authorize request is answered 204, so this document
    // survives and its URL/sessionStorage are still readable below.
    const state = await page.evaluate(() => {
      load();
      return {
        hasSections: !!document.getElementById('f-displayName'),
        url: location.href,
        oauthState: (() => { try { return JSON.parse(sessionStorage.getItem('maga_oauth') || 'null'); } catch (_) { return null; } })(),
      };
    });
    const navUrl = await waitForNav(otherCalls, '/authorize');

    check('a reload with ?reauth=1 does NOT render the settings sections', !state.hasSections);
    check('it navigates into the OAuth /authorize flow', navUrl.pathname === '/authorize');

    // Loop-prevention: the reauth=1 param must be stripped from the URL
    // BEFORE startOAuth() reads location.href as its returnTo, or the OAuth
    // callback would bounce straight back into this same reauth branch
    // forever.
    check('the reauth=1 param is stripped from the page URL before starting OAuth, got: ' + state.url,
      !state.url.includes('reauth=1'));
    check('the stored OAuth returnTo does not itself carry reauth=1, got: ' + JSON.stringify(state.oauthState),
      !!state.oauthState && !!state.oauthState.returnTo && !state.oauthState.returnTo.includes('reauth=1'));
    await ctx.close();
  }

  // --- 16. password: mismatch shows an inline error and sends no request --
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const { otherCalls } = await withPrefsFake(ctx);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('#pw-save', { timeout: 6000 });
    await page.fill('#pw-current', 'oldpass123');
    await page.fill('#pw-new', 'novaSenha1234');
    await page.fill('#pw-confirm', 'novaSenhaDIFERENTE');
    await page.click('#pw-save');
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-field="confirmPassword"] .err');
      return el && !el.hidden && el.textContent.length > 0;
    }, null, { timeout: 6000 });
    const msg = await page.textContent('[data-field="confirmPassword"] .err');
    check('a mismatched confirm password shows an inline error, got: ' + msg,
      msg.includes('não são iguais'));
    check('no request was sent for a client-side-rejected mismatch',
      !otherCalls.some(c => c.pathname === '/preferences/password'));
    await ctx.close();
  }

  // --- 17. password: a field-named failure from the server ----------------
  //
  // This test found a real collision: mcpFetch() treats EVERY 401 as session
  // expiry before it looks at the body, so a 401 carrying
  // {error:"wrong_password", field:"currentPassword"} was indistinguishable
  // from an expired token, and a mistyped password bounced the person out to
  // the login form instead of naming the field. Fixed on the SERVER side -
  // the bearer token was valid, only a submitted credential was wrong, so
  // that is a 400 - which keeps 401 meaning exactly one thing for every
  // client. This test now pins the fixed behaviour.
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const passwordResult = () => ({ status: 400, body: { error: 'wrong_password', field: 'currentPassword', message: 'Senha atual incorreta.' } });
    await withPrefsFake(ctx, { passwordResult });
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('#pw-save', { timeout: 6000 });
    await page.fill('#pw-current', 'wrongpass');
    await page.fill('#pw-new', 'novaSenha1234');
    await page.fill('#pw-confirm', 'novaSenha1234');
    await page.click('#pw-save');
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-field="currentPassword"] .err');
      return el && !el.hidden && (el.textContent || '').length > 0;
    }, null, { timeout: 6000 });
    const holder = await page.$('[data-field="currentPassword"] .err');
    const inlineText = holder ? (await holder.textContent()) : null;
    const inlineShown = holder !== null && !(await holder.evaluate(el => el.hidden)) && !!inlineText;
    check('a wrong current password renders "Senha atual incorreta." under #pw-current rather than ' +
      'bouncing to the login form, got holder text: ' + inlineText,
      inlineShown && inlineText.includes('Senha atual incorreta.'));
    await ctx.close();
  }

  // --- 18. password: a successful change reports how many sessions ended --
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const passwordResult = () => ({ status: 200, body: { otherSessionsRevoked: 3 } });
    await withPrefsFake(ctx, { passwordResult });
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('#pw-save', { timeout: 6000 });
    await page.fill('#pw-current', 'oldpass123');
    await page.fill('#pw-new', 'novaSenha1234');
    await page.fill('#pw-confirm', 'novaSenha1234');
    await page.click('#pw-save');
    await page.waitForFunction(() => {
      const t = (document.getElementById('saved-password') || {}).textContent || '';
      return t.length > 0 && !/salvando/i.test(t);
    }, null, { timeout: 6000 });
    const status = await page.textContent('#saved-password');
    check('a successful password change reports how many other sessions were ended, got: ' + status,
      status.includes('3') && status.toLowerCase().includes('sess'));
    await ctx.close();
  }

  // --- 19. Sessões ativas: lists sessions, marks the current one, revokes -
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const sessionsList = [
      { clientId: 'maga-web', current: true, signedInAt: '2026-09-01T10:00:00Z' },
      { clientId: 'maga-web-outro-aparelho', current: false, signedInAt: '2026-08-20T08:00:00Z' },
    ];
    const { calls } = await withPrefsFake(ctx, { sessionsList, revokedCount: 1 });
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForFunction(() => {
      const box = document.getElementById('sessions-box');
      return box && box.querySelectorAll('.entry').length > 0;
    }, null, { timeout: 6000 });
    const rows = await page.$$eval('#sessions-box .entry', els => els.map(e => e.textContent));
    check('both configured sessions are listed, got ' + JSON.stringify(rows), rows.length === 2);
    check('the current session is marked as such', rows.some(t => t.includes('maga-web') && t.includes('este dispositivo')));
    check('the other session is not marked current', rows.some(t => t.includes('maga-web-outro-aparelho') && !t.includes('este dispositivo')));

    await page.click('#revoke-others');
    await page.waitForFunction(() => (() => { const t = (document.getElementById('saved-sessions') || {}).textContent || ''; return t.length > 0 && !/encerrando/i.test(t); })(), null, { timeout: 6000 });
    const status = await page.textContent('#saved-sessions');
    check('revoking reports the count returned by the server, got: ' + status, status.includes('1'));
    const sessionGetCalls = calls.filter(c => c === '/preferences/sessions').length;
    check('the session list was reloaded after revoking (fetched at least twice), got ' + sessionGetCalls,
      sessionGetCalls >= 2);
    await ctx.close();
  }

  // --- 20. Backup: export makes the GET request (a real file download is
  // not observable in headless Chromium - see the report) -----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 }, acceptDownloads: true });
    const { otherCalls } = await withPrefsFake(ctx);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('#export', { timeout: 6000 });
    await page.click('#export');
    await page.waitForFunction(() => {
      const el = document.getElementById('saved-backup');
      return el && el.textContent.length > 0;
    }, null, { timeout: 6000 });
    check('exporting called GET /preferences/export', otherCalls.some(c => c.pathname === '/preferences/export'));
    await ctx.close();
  }

  // --- 21. Backup: import feeds a JSON file through the hidden file input -
  {
    const ctx = await browser.newContext({ viewport: { width: 414, height: 860 } });
    const importedPayload = { effective: { displayName: 'Restaurado' } };
    const { otherCalls } = await withPrefsFake(ctx, {
      importResult: body => ({ status: 200, body: { imported: Object.keys(body || {}), effective: Object.assign({}, makePrefs().effective, body.effective || {}) } }),
    });
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/preferencias.html');
    await seed(page, { pass: 'x', token: 'tok-1' });
    await page.reload();
    await page.waitForSelector('#import', { timeout: 6000 });
    await page.setInputFiles('#import-file', {
      name: 'maga-preferencias-2026-09-01.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(importedPayload)),
    });
    await page.waitForSelector('.modal-backdrop', { timeout: 6000 });
    await page.click('#confirm-ok');
    await page.waitForFunction(() => (() => { const t = (document.getElementById('saved-backup') || {}).textContent || ''; return t.length > 0 && !/restaurando/i.test(t); })(), null, { timeout: 6000 });
    const importCall = otherCalls.find(c => c.pathname === '/preferences/import');
    check('a POST /preferences/import request was sent with the parsed file contents',
      !!importCall && JSON.stringify(importCall.body) === JSON.stringify(importedPayload));
    const backupStatus = await page.textContent('#saved-backup');
    check('the page shows what was restored, got: ' + backupStatus, backupStatus.startsWith('Restaurado:') && backupStatus.includes('effective'));
    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log('preferencias.test.js: ' + assertions + ' assertions, ' + failures.length + ' failures');
  if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
  console.log('preferencias.test.js: ok');
})();
