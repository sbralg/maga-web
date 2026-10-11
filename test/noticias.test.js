// Headless test for noticias.html — the news board.
//
//   node test/noticias.test.js           # exits non-zero on any failure
//   KEEP_SHOTS=1 node test/noticias.test.js
//
// Serves the repo root over http and answers maga-api from an in-memory fake
// (news_board / news_refresh_request), plus a fake image host so one
// thumbnail can fail on purpose. Never touches Supabase or the real outlets.
//
// Covers: env gate (zero API calls off the default env), the empty board,
// sections in the board's own category order with per-section counts, links
// opening in a new tab, Type + single-select source chips and their counts
// (zero-count chip disabled), the text box hiding rows/sections without
// touching counts, the outlet-tinted placeholder for a missing AND a broken
// thumbnail, the video duration chip, filters remembered across a reload,
// the stale banner, the full ↻ loop (request -> poll -> new board, filters
// kept), and no horizontal overflow at 360px.
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
const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), 'noticias-test-'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
                '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(WEB_DIR, rel || 'noticias.html');
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

const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

function makeBoard(extra = []) {
  return {
    version: 1, person: 'alexandre', generated_at: minsAgo(5), window_hours: 24,
    categories: [
      { key: 'mundo', label: 'Mundo' }, { key: 'brasil', label: 'Brasil' }, { key: 'politica', label: 'Política' },
      { key: 'economia', label: 'Economia' }, { key: 'outros', label: 'Outros' },
    ],
    sources: [
      { key: 'bbc', name: 'BBC', color: '#bb1919' },
      { key: 'cnn', name: 'CNN', color: '#9b2a8a' },
      { key: 'folha', name: 'Folha', color: '#0f5aa8' },
    ],
    items: [
      { id: 'a1', source: 'bbc', kind: 'article', title: 'Ceasefire talks resume in Geneva', url: 'https://www.bbc.com/news/a1', image: 'https://img.example/ok.png', published_at: minsAgo(20), category: 'mundo' },
      { id: 'a2', source: 'cnn', label: 'CNN Brasil', kind: 'article', title: 'Lula sanciona nova lei', url: 'https://www.cnnbrasil.com.br/a2', published_at: minsAgo(40), category: 'politica' },
      { id: 'a3', source: 'folha', kind: 'article', title: 'Ibovespa fecha em alta', url: 'https://www1.folha.uol.com.br/a3', image: 'https://img.example/broken.png', published_at: minsAgo(60), category: 'economia' },
      { id: 'v1', source: 'cnn', label: 'CNN International', kind: 'video', title: 'Análise: o que muda com o acordo', url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', image: 'https://img.example/ok.png', published_at: minsAgo(90), duration_s: 725, category: 'mundo' },
      { id: 'a4', source: 'bbc', kind: 'article', title: 'São Paulo terá frente fria', url: 'https://www.bbc.com/news/a4', published_at: minsAgo(100), category: 'brasil' },
      ...extra,
    ],
  };
}

(async () => {
  const failures = [];
  const check = (label, cond) => { if (!cond) failures.push('FAIL: ' + label); };
  const server = await serve();
  const ORIGIN = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];

  // state the fake maga-api serves
  const state = { board: makeBoard(), publishedAt: minsAgo(5), calls: [], refreshPending: false };

  async function newCtx(env = { envId: 'dev', defaultEnv: 'dev' }, viewport = { width: 414, height: 900 }) {
    const ctx = await browser.newContext({ viewport });
    ctx.on('weberror', e => errors.push('pageerror: ' + e.error().message));
    await ctx.addInitScript((env) => {
      // Init scripts also run in opaque frames (about:blank etc.) where
      // storage is off-limits - only seed real same-origin documents.
      try { if (location.protocol !== 'http:' || sessionStorage.getItem('__seeded')) return; } catch (_) { return; }
      sessionStorage.setItem('__seeded', '1');
      localStorage.setItem('checklist_pass', 'x');
      localStorage.setItem('checklist_env', env.envId);
      localStorage.setItem('checklist_envs_cache', JSON.stringify({ defaultEnv: env.defaultEnv, environments: [{ id: 'dev', label: 'Dev' }, { id: 'prod', label: 'Prod' }] }));
    }, env);
    await ctx.route('https://img.example/**', route =>
      route.request().url().endsWith('broken.png')
        ? route.fulfill({ status: 404, body: '' })
        : route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    await ctx.route('**/functions/v1/maga-api', async route => {
      const body = route.request().postDataJSON();
      state.calls.push(body.action);
      let resp;
      if (body.action === 'news_board') {
        if (state.refreshPending) {
          // the bridge "publishes" on the first poll after a refresh request
          state.refreshPending = false;
          state.board = makeBoard([{ id: 'n1', source: 'folha', kind: 'article', title: 'Notícia nova depois do refresh', url: 'https://www1.folha.uol.com.br/n1', published_at: minsAgo(1), category: 'brasil' }]);
          state.publishedAt = new Date().toISOString();
        }
        resp = state.board ? { board: state.board, published_at: state.publishedAt } : { board: null, published_at: null };
      } else if (body.action === 'news_refresh_request') {
        state.refreshPending = true;
        resp = { ok: true, requested_at: new Date().toISOString() };
      } else {
        resp = { error: 'bad action' };
      }
      await route.fulfill({ status: body.action in { news_board: 1, news_refresh_request: 1 } ? 200 : 400, contentType: 'application/json', body: JSON.stringify(resp) });
    });
    return ctx;
  }

  // --- env gate: another environment never calls maga-api ------------------
  {
    const ctx = await newCtx({ envId: 'prod', defaultEnv: 'dev' });
    const page = await ctx.newPage();
    state.calls = [];
    await page.goto(ORIGIN + '/noticias.html');
    await page.waitForSelector('text=não está disponível', { timeout: 8000 });
    check('non-default env: blocked message', (await page.textContent('#root')).includes('não está disponível'));
    check('non-default env: zero maga-api calls, got ' + state.calls.join(','), state.calls.length === 0);
    await ctx.close();
  }

  // --- empty board -------------------------------------------------------------
  {
    const saved = state.board;
    state.board = null;
    const ctx = await newCtx();
    const page = await ctx.newPage();
    await page.goto(ORIGIN + '/noticias.html');
    await page.waitForSelector('text=Nenhuma notícia publicada ainda', { timeout: 8000 });
    check('empty board offers the refresh button', !!(await page.$('#refresh-btn')));
    await ctx.close();
    state.board = saved;
  }

  // --- the board ------------------------------------------------------------------
  const ctx = await newCtx();
  const page = await ctx.newPage();
  await page.goto(ORIGIN + '/noticias.html');
  await page.waitForSelector('section.cat', { timeout: 8000 });

  const cats = await page.$$eval('section.cat:not([hidden])', els => els.map(e => e.dataset.cat));
  check('sections follow the board category order (empty ones absent), got ' + cats.join(','),
    JSON.stringify(cats) === JSON.stringify(['mundo', 'brasil', 'politica', 'economia']));
  check('section header shows its visible count',
    (await page.textContent('section[data-cat="mundo"] .count')).trim() === '2');
  const link = await page.$eval('section[data-cat="mundo"] .news-row', a => ({ t: a.target, r: a.rel, h: a.href }));
  check('rows open the outlet in a new tab, no referrer/opener', link.t === '_blank' && /noopener/.test(link.r) && /noreferrer/.test(link.r));
  check('row meta uses the feed label when present',
    (await page.textContent('section[data-cat="politica"] .news-meta .src')).trim() === 'CNN Brasil');
  check('video row carries the duration chip',
    (await page.textContent('a[data-kind="video"] .dur')).trim() === '12:05');
  check('an item with no image gets the tinted placeholder with the outlet name',
    (await page.textContent('section[data-cat="brasil"] .thumb.ph')).trim() === 'BBC');
  await page.waitForFunction(() => {
    const t = document.querySelector('section[data-cat="economia"] .thumb');
    return t && t.classList.contains('ph');
  }, null, { timeout: 5000, polling: 100 }).catch(() => {});
  check('a broken thumbnail turns into the placeholder tile',
    (await page.textContent('section[data-cat="economia"] .thumb')).trim() === 'Folha');
  check('working thumbnails are requested without a referrer',
    (await page.getAttribute('section[data-cat="mundo"] .thumb img', 'referrerpolicy')) === 'no-referrer');

  const chipText = async (key) => (await page.textContent('.src-chip[data-source="' + key + '"] .n')).trim();
  check('source chip counts (all types): bbc=2, cnn=2, folha=1, all=5',
    (await chipText('bbc')) === '2' && (await chipText('cnn')) === '2' && (await chipText('folha')) === '1' && (await chipText('')) === '5');

  // Type filter: videos only
  await page.click('.type-chip[data-type="video"]');
  check('Vídeos: only the video row remains', (await page.$$('a.news-row')).length === 1);
  check('Vídeos: chip counts follow the type filter (cnn=1, bbc=0)', (await chipText('cnn')) === '1' && (await chipText('bbc')) === '0');
  check('Vídeos: a zero-count source chip is disabled', await page.$eval('.src-chip[data-source="bbc"]', b => b.disabled));
  await page.click('.type-chip[data-type="all"]');

  // single-select source
  await page.click('.src-chip[data-source="cnn"]');
  const srcs = await page.$$eval('a.news-row', els => [...new Set(els.map(e => e.dataset.source))]);
  check('selecting CNN shows only CNN rows', JSON.stringify(srcs) === '["cnn"]');
  check('the selected chip is pressed and the others dimmed',
    (await page.getAttribute('.src-chip[data-source="cnn"]', 'aria-pressed')) === 'true' &&
    (await page.$eval('.src-chip[data-source="bbc"]', b => b.classList.contains('dim'))));
  await page.click('.src-chip[data-source="cnn"]');
  check('clicking the selected source again clears it', (await page.$$('a.news-row')).length === 5);

  // text box hides rows and empty sections, counts stay
  await page.fill('#q', 'ibovespa');
  check('search: one visible row', (await page.$$('a.news-row:not([hidden])')).length === 1);
  check('search: other sections hidden', (await page.$$eval('section.cat:not([hidden])', els => els.map(e => e.dataset.cat))).join() === 'economia');
  check('search: chip counts unchanged', (await chipText('')) === '5');
  await page.fill('#q', 'sao paulo'); // accent-insensitive
  check('search folds accents (sao paulo -> São Paulo)', (await page.$$('a.news-row:not([hidden])')).length === 1);
  await page.fill('#q', '');

  // filters remembered
  await page.click('.type-chip[data-type="article"]');
  await page.reload();
  await page.waitForSelector('section.cat', { timeout: 8000 });
  check('the Type filter survives a reload',
    (await page.getAttribute('.type-chip[data-type="article"]', 'aria-pressed')) === 'true');
  check('…and is applied', (await page.$$('a[data-kind="video"]')).length === 0);

  // refresh loop keeps filters and shows the new board
  state.calls = [];
  await page.fill('#q', 'notícia nova');
  await page.click('#refresh-btn');
  check('the button shows progress', (await page.textContent('#refresh-btn')).includes('Atualizando'));
  await page.waitForSelector('text=Notícia nova depois do refresh', { timeout: 15000 });
  check('refresh: news_refresh_request then news_board polled, got ' + state.calls.join(','),
    state.calls[0] === 'news_refresh_request' && state.calls.includes('news_board'));
  check('refresh: the search text is kept', (await page.inputValue('#q')) === 'notícia nova');
  check('refresh: the Type filter is kept', (await page.getAttribute('.type-chip[data-type="article"]', 'aria-pressed')) === 'true');
  check('refresh: "atualizado agora"', (await page.textContent('#when')).includes('agora'));
  check('refresh: button back to idle', (await page.textContent('#refresh-btn')).includes('Atualizar'));
  await page.screenshot({ path: path.join(SHOTS, 'noticias.png'), fullPage: true });
  await ctx.close();

  // --- stale banner -----------------------------------------------------------------
  {
    state.publishedAt = minsAgo(4 * 60);
    const c = await newCtx();
    const p = await c.newPage();
    await p.goto(ORIGIN + '/noticias.html');
    await p.waitForSelector('section.cat', { timeout: 8000 });
    check('a board older than 3h shows the stale banner', !!(await p.$('#stale-banner')));
    await c.close();
    state.publishedAt = minsAgo(5);
  }

  // --- 360px: no horizontal overflow --------------------------------------------------
  {
    const c = await newCtx(undefined, { width: 360, height: 800 });
    const p = await c.newPage();
    await p.goto(ORIGIN + '/noticias.html');
    await p.waitForSelector('section.cat', { timeout: 8000 });
    const ov = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
    check('360px: scrollWidth ' + ov.s + ' === innerWidth ' + ov.w, ov.s === ov.w);
    await c.close();
  }

  await browser.close();
  server.close();
  if (process.env.KEEP_SHOTS) console.log('screenshots: ' + SHOTS);
  console.log('--- JS errors ---');
  console.log(errors.length ? errors.join('\n') : '(none)');
  console.log('--- failures ---');
  console.log(failures.length ? failures.join('\n') : '(none)');
  process.exit(failures.length || errors.length ? 1 : 0);
})();
