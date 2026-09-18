// Headless UI test for compras.html — the scanner, the barcode validation,
// the camera/lens picker, the price and quantity fields, and the scan
// confirmation dialog.
//
//   node test/shopping.test.js          # exits non-zero on any failure
//   KEEP_SHOTS=1 node test/...          # also prints where screenshots went
//
// It lives in this repo rather than in maga-api because
// compras.html does too: the page has exactly one copy, and the test that
// guards it sits next to it.
//
// It serves the repo root over http rather than using file://, because that
// is what GitHub Pages does and localStorage/permissions behave differently
// on a file: origin. maga-api is intercepted and answered from an
// in-memory fake, so the test never touches Supabase and never needs the
// passphrase.
//
// Two things HAVE to be stubbed and it is worth knowing why:
//   * BarcodeDetector — headless Linux Chromium has no platform barcode API
//     at all, so the real one can never run here. The stub feeds a queue of
//     codes, cycled forever, which is what lets a misread be simulated as a
//     steady stream of the same bad read.
//   * getUserMedia/enumerateDevices — Chromium's fake camera gives a video
//     feed but exposes no focusMode or torch, so the lens-picking logic
//     would have nothing to choose between. The stub reports the capability
//     sets copied from a real Android phone, including the ultra-wide that
//     advertises focusMode:["manual"] while being fixed-focus glass.
//
// The camera itself is real (Chromium's synthetic feed), so getUserMedia,
// track teardown and the overlay lifecycle are genuinely exercised.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Prefer a locally installed playwright, fall back to a global one.
function loadPlaywright() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch (_) { /* try the next */ }
  }
  console.error('playwright not found — npm i -D playwright, or set NODE_PATH');
  process.exit(2);
}
const { chromium } = loadPlaywright();

// The pages sit at the repo root here — this repo IS the deploy target, so
// serving the root is serving exactly what GitHub Pages serves.
const WEB_DIR = path.resolve(__dirname, '..');
const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), 'shopping-test-'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
                '.css': 'text/css', '.png': 'image/png' };

// A static server for the repo root, on an ephemeral port so parallel runs
// don't clash.
function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(WEB_DIR, rel || 'compras.html');
      // Refuse anything that escapes the served root, even in a test.
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


const state = {
  items: [
    { id: 'I1', name: 'Café', price: 12.5, quantity: 1, purchased: false, gtin: null,
      created_at: '2026-08-01T10:00:00Z', insumo: null },
  ],
  seq: 1,
  upserts: [],
  itemUpdates: [],
};

// A second known barcode, distinct from the merge-heavy 7891000100103, kept
// free of other scenarios so a fresh-insert correction can be asserted in
// isolation (exact call count and shape, not just the visible result).
const KNOWN_INSUMOS = {
  '7891000100103': { name: 'Leite Condensado Integral moça', brand: 'CASA DE BENTO',
    net_qty: 1000, net_unit: 'ml' },
  '7896004700236': { name: 'Bolacha Maria', brand: 'Adria', net_qty: null, net_unit: null },
  // A third, otherwise-untouched barcode for the row camera-icon test —
  // 7896004700236 is reserved for the later "fresh insert" scenario, which
  // needs that gtin to still be unused by any row when it runs.
  '7897001234564': { name: 'Suco de Uva Aurora', brand: 'AURORA', net_qty: null, net_unit: null },
  // A fourth, never-put-on-a-row barcode, so a plain rescan-live-fill test
  // can use a code that resolves to a real insumo WITHOUT colliding with
  // any row already in the list (every other fixture above ends up on one).
  '7891234567895': { name: 'Manteiga com Sal', brand: 'AVIAÇÃO', net_qty: 200, net_unit: 'g' },
};

function handleScan(body) {
  const known = KNOWN_INSUMOS[body.gtin];
  const name = body.name || (known && known.name);
  if (!name) return { needs_name: true, found: false, gtin: body.gtin };
  const existing = state.items.find(i => i.gtin === body.gtin && !i.purchased);
  if (existing) {
    existing.quantity = Number(existing.quantity) + Number(body.quantity ?? 1);
    if (body.price != null) existing.price = body.price;
    return { item: { ...existing }, merged: true, found: true };
  }
  const item = {
    id: 'S' + (++state.seq), name,
    price: body.price ?? null, quantity: body.quantity ?? 1,
    purchased: false, gtin: body.gtin, created_at: '2026-08-09T10:00:00Z',
    // Brand deliberately SHOUTED, to prove it is tidied at render.
    insumo: known
      ? { brand: known.brand.toUpperCase(), net_qty: known.net_qty, net_unit: known.net_unit }
      : null,
  };
  state.items.push(item);
  return { item: { ...item }, merged: false, found: true };
}

(async () => {
  const failures = [];
  const server = await serve();
  const PAGE = 'http://127.0.0.1:' + server.address().port + '/compras.html';
  const browser = await chromium.launch({
    // Honour an explicit browser path when one is provided (this sandbox
    // ships Chromium outside playwright's own cache); otherwise let
    // playwright resolve it.
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 860 },
    permissions: ['camera'],
  });

  const errors = [];
  ctx.on('weberror', e => errors.push('pageerror: ' + e.error().message));

  await ctx.addInitScript(() => {
    try { localStorage.setItem('checklist_pass', 'x'); } catch (_) {}
    window.__vibrations = 0;
    // navigator.vibrate is absent in headless Chromium; define a counter so
    // "must not buzz on a misread" is actually assertable.
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: () => { window.__vibrations++; return true; },
    });
    // Simulate a three-lens Android phone where facingMode:environment
    // lands on the fixed-focus ultra-wide, which is the reported problem.
    window.__opened = [];
    // addInitScript also runs on the opaque pre-navigation document, which
    // has no navigator.mediaDevices at all — that's the harness, not the page.
    if (navigator.mediaDevices) {
    const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = async () => ([
      { kind: 'videoinput', deviceId: 'wide', label: 'camera2 2, facing back' },
      { kind: 'videoinput', deviceId: 'main', label: 'camera2 0, facing back' },
      { kind: 'videoinput', deviceId: 'tele', label: 'camera2 3, facing back' },
      // A rear lens whose label says nothing about which way it points —
      // the old "must match /back/" filter dropped this one from the cycle.
      { kind: 'videoinput', deviceId: 'odd', label: 'Camera 3' },
      { kind: 'videoinput', deviceId: 'selfie', label: 'camera2 1, facing front' },
    ]);
    navigator.mediaDevices.getUserMedia = async (c) => {
      const want = c && c.video && c.video.deviceId && c.video.deviceId.exact;
      const id = want || 'wide';
      window.__opened.push(id);
      const s = await realGUM({ video: true });
      const t = s.getVideoTracks()[0];
      // Capability sets copied from a real phone: the ultra-wide reports
      // focusMode ["manual"] — a knob that does nothing on fixed-focus
      // glass — while the main lens reports the full set plus the torch.
      const CAPS = {
        wide: { focusMode: ['manual'], zoom: { min: 1, max: 8 },
                width: { max: 4000 }, height: { max: 3000 } },
        main: { focusMode: ['manual', 'single-shot', 'continuous'], torch: true,
                zoom: { min: 1, max: 10 }, width: { max: 4080 }, height: { max: 3060 } },
        tele: { width: { max: 3000 }, height: { max: 2250 } },
        odd: { width: { max: 2000 }, height: { max: 1500 } },
        selfie: { focusMode: ['manual', 'single-shot', 'continuous'],
                  width: { max: 3392 }, height: { max: 2544 } },
      };
      t.getCapabilities = () => (CAPS[id] || {});
      t.getSettings = () => ({ deviceId: id });
      t.applyConstraints = async () => {};
      return s;
    };
    }

    // What the decoder "sees", cycled forever: a one-element list is a
    // steady read, a multi-element list flaps between values indefinitely.
    window.__setCodes = list => { window.__q = list ? list.slice() : null; };
    window.BarcodeDetector = class {
      constructor() {}
      static getSupportedFormats() {
        return Promise.resolve(['ean_13', 'ean_8', 'upc_a', 'upc_e']);
      }
      detect() {
        const q = window.__q;
        if (!q || !q.length) return Promise.resolve([]);
        const v = q.shift();
        q.push(v);
        return Promise.resolve(v ? [{ rawValue: v, format: 'ean_13' }] : []);
      }
    };
  });

  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.route('**/functions/v1/maga-api', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'shopping_item_update') state.itemUpdates.push({ ...body });
    let resp;
    if (body.action === 'shopping_lists') {
      resp = { lists: [{ id: 'L1', name: 'Mercado', emoji: '🛒', item_count: state.items.length,
        purchased_count: 0, total_all: 12.5, total_cart: 0, created_at: '2026-08-01T10:00:00Z' }] };
    } else if (body.action === 'shopping_items') {
      resp = { items: state.items.map(i => ({ ...i })) };
    } else if (body.action === 'insumo_lookup') {
      const known = KNOWN_INSUMOS[body.gtin];
      resp = known
        ? { found: true, gtin: body.gtin, insumo: { gtin: body.gtin, ...known }, origin: 'local' }
        : { found: false, gtin: body.gtin };
    } else if (body.action === 'insumo_price_history') {
      resp = { gtin: body.gtin, prices: body.gtin === '7891000100103'
        ? [{ price: 5.5, quantity: 1, store: null, captured_at: '2026-08-01T10:00:00Z' }]
        : [] };
    } else if (body.action === 'shopping_item_scan') {
      resp = handleScan(body);
    } else if (body.action === 'insumo_upsert') {
      // The size (and, for a brand-new barcode, the brand) the user typed in
      // the scan dialog land here, against the barcode rather than the row.
      // Recorded so the test can assert both that it is sent when edited and
      // that it is NOT sent otherwise.
      state.upserts.push({ ...body });
      // Mirrors the real insumos table: insumo_lookup reads from the same
      // place this writes to, so a barcode registered here has to become
      // resolvable by insumo_lookup too — otherwise a later rescan of it
      // would see "unknown" here when the real API would not.
      KNOWN_INSUMOS[body.gtin] = { name: body.name, brand: body.brand ?? '',
        net_qty: body.net_qty ?? null, net_unit: body.net_unit ?? null };
      resp = { insumo: { gtin: body.gtin, name: body.name, brand: body.brand ?? null,
        net_qty: body.net_qty ?? null, net_unit: body.net_unit ?? null } };
    } else if (body.action === 'shopping_item_add') {
      // Mirrors the API: net_text is parsed into a normalized pair, and
      // unreadable text is a 400 rather than a silent drop.
      let net = { net_qty: null, net_unit: null };
      const t = (body.net_text || '').trim();
      if (t) {
        const m = t.match(/^([\d.,]+)\s*(kg|g|ml|l)$/i);
        if (!m) { await route.fulfill({ status: 400, contentType: 'application/json',
          body: JSON.stringify({ error: 'invalid net quantity' }) }); return; }
        const n = Number(m[1].replace(',', '.'));
        const u = m[2].toLowerCase();
        net = u === 'kg' ? { net_qty: n * 1000, net_unit: 'g' }
            : u === 'l' ? { net_qty: n * 1000, net_unit: 'ml' }
            : { net_qty: n, net_unit: u };
      }
      const item = { id: 'M' + (++state.seq), name: body.name, price: null,
        quantity: body.quantity || 1, purchased: false, gtin: null,
        brand: (body.brand || '').trim() || null, insumo: null,
        created_at: '2026-08-09T12:00:00Z', ...net };
      state.items.push(item);
      resp = { item };
    } else if (body.action === 'shopping_item_update' && !('name' in body) &&
               !('price' in body) && ('quantity' in body)) {
      // A bare quantity bump: the steppers, and the "one more of that" a
      // repeat scan or a merge sends.
      const it = state.items.find(i => i.id === body.id);
      if (it) it.quantity = body.quantity;
      resp = { ok: true, item: it ? { ...it } : null };
    } else if (body.action === 'shopping_item_delete') {
      const idx = state.items.findIndex(i => i.id === body.id);
      if (idx !== -1) state.items.splice(idx, 1);
      resp = { ok: true };
    } else if (body.action === 'shopping_confirm_purchase') {
      const purchased = state.items.filter(i => i.purchased);
      const withGtin = purchased.filter(i => i.gtin);
      state.lastConfirmBody = { ...body };
      resp = {
        ok: true,
        confirmed: withGtin.filter(i => i.price != null).length,
        skipped_no_gtin: purchased.filter(i => !i.gtin).map(i => i.name),
        skipped_no_price: withGtin.filter(i => i.price == null).map(i => i.name),
      };
    } else if (body.action === 'shopping_item_update' && !('name' in body) &&
               ('purchased' in body)) {
      const it = state.items.find(i => i.id === body.id);
      if (it) it.purchased = body.purchased;
      resp = { ok: true, item: it ? { ...it } : null };
    } else if (body.action === 'shopping_item_update' && !('name' in body) &&
               ('price' in body)) {
      const it = state.items.find(i => i.id === body.id);
      if (it) it.price = body.price;
      resp = { ok: true, item: it ? { ...it } : null };
    } else if (body.action === 'shopping_item_update' && !('name' in body) &&
               ('brand' in body)) {
      // A known insumo's brand corrected from the scan dialog: an
      // item-level override sent on its own, without the rest of the
      // full edit-modal payload (name/net_text/gtin).
      const it = state.items.find(i => i.id === body.id);
      if (it) it.brand = (body.brand ?? '').trim() || null;
      resp = { ok: true, item: it ? { ...it } : null };
    } else if (body.action === 'shopping_item_update' && 'name' in body) {
      const it = state.items.find(i => i.id === body.id);
      it.name = body.name;
      // Each field is only touched when the caller actually sent it — the
      // full edit modal sends all of them together, but a scan-dialog
      // correction can send just the name, so a field's absence has to mean
      // "leave it alone", not "clear it".
      if ('price' in body) it.price = body.price;
      if ('quantity' in body) it.quantity = body.quantity;
      if ('brand' in body) it.brand = (body.brand ?? '').trim() || null;
      if ('net_text' in body) {
        const t = (body.net_text || '').trim();
        const m = t ? t.match(/^([\d.,]+)\s*(kg|g|ml|l)$/i) : null;
        it.net_qty = m ? Number(m[1].replace(',', '.')) * (/^(kg|l)$/i.test(m[2]) ? 1000 : 1) : null;
        it.net_unit = m ? (/^(kg|g)$/i.test(m[2]) ? 'g' : 'ml') : null;
      }
      // Only a CHANGED code re-resolves; an unchanged one leaves the edits
      // above standing as overrides.
      if ('gtin' in body && (body.gtin || null) !== (it.gtin || null)) {
        const g = (body.gtin || '').trim();
        it.gtin = g || null;
        if (g === '7891000100103') {
          it.name = 'Leite Condensado Integral moça';
          it.brand = null; it.net_qty = null; it.net_unit = null;
          it.insumo = { brand: 'Nestlé', net_qty: 395, net_unit: 'g' };
        }
      }
      resp = { ok: true, item: { ...it } };
    } else {
      resp = { ok: true };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resp) });
  });

  await page.goto(PAGE);
  await page.waitForSelector('.card');
  await page.evaluate(() => openList('L1'));
  await page.waitForSelector('#scan-item-btn');

  const check = (label, cond) => { if (!cond) failures.push('FAIL: ' + label); };
  const rows = async () => (await page.$$('.row[data-id]')).length;
  const overlayOpen = async () => (await page.$$('.scan-overlay')).length === 1;
  const vibrations = () => page.evaluate(() => window.__vibrations);

  // --- the reported failure: a 13-digit EAN read with the first digit
  // missing. Checksum-invalid, so it must never buzz or close. ---
  await page.evaluate(() => window.__setCodes(['891000100103']));
  await page.click('#scan-item-btn');
  await page.waitForSelector('.scan-overlay');
  await page.waitForTimeout(1500);

  // --- lens selection: must walk off the fixed-focus ultra-wide ---
  const opened = await page.evaluate(() => window.__opened);
  check('tried the default lens first, got: ' + opened.join(','), opened[0] === 'wide');
  check('switched to the lens that has autofocus, got: ' + opened.join(','),
    opened.includes('main'));
  check('remembered the focusable lens',
    await page.evaluate(() => localStorage.getItem('maga_scan_camera_id')) === 'main');
  check('hint offers tap-to-focus once on a focusable lens',
    /focar/.test(await page.textContent('.scan-hint')));
  check('lens switch button visible with several cameras',
    await page.isVisible('#scan-cam'));
  check('front camera excluded from the rear list',
    !opened.includes('selfie'));

  check('misread does NOT close the camera', await overlayOpen());
  check('misread does NOT vibrate', await vibrations() === 0);
  check('misread adds no row', await rows() === 1);

  // it should say so rather than leaving the user holding the phone there
  await page.waitForFunction(
    () => { const t = document.querySelector('.scan-toast'); return t && /ilegível/.test(t.textContent); },
    null, { timeout: 8000 });
  check('unreadable-code hint shown', /ilegível/.test(await page.textContent('.scan-toast')));

  // --- recovers without reopening: feed it the correct code ---
  await page.evaluate(() => window.__setCodes(['7891000100103']));
  await page.waitForFunction(() => !document.querySelector('.scan-overlay'), null, { timeout: 6000 });
  check('valid code closes the camera', !(await overlayOpen()));
  check('valid code vibrates once', await vibrations() === 1);
  // --- the scan dialog confirms the insumo and collects qty + price ---
  await page.waitForSelector('#scan-price', { timeout: 6000 });
  // Name and brand are editable, not read-only — a known insumo can still
  // have a bad OFF entry or an earlier mistake worth fixing right here.
  check('dialog prefills the resolved name, got: ' + await page.inputValue('#scan-name'),
    (await page.inputValue('#scan-name')) === 'Leite Condensado Integral moça');
  check('dialog prefills the brand, got: ' + await page.inputValue('#scan-brand'),
    (await page.inputValue('#scan-brand')) === 'Casa de Bento');
  // The gtin line no longer repeats the brand — that lives in its own field now.
  check('dialog meta line shows just the code, got: ' + await page.textContent('.scan-meta'),
    (await page.textContent('.scan-meta')).trim() === 'Código 7891000100103');
  // 1000 ml is stored, but the box says 1 L — the prefill has to read like the
  // packaging, not like our storage units, or every scan looks wrong.
  check('package size is prefilled from the catalogue, got: ' +
      await page.inputValue('#scan-net-qty') + ' / ' +
      await page.inputValue('#scan-net-unit'),
    (await page.inputValue('#scan-net-qty')) === '1' &&
    (await page.inputValue('#scan-net-unit')) === 'L');
  check('cursor starts in the price field, not the prefilled name',
    await page.evaluate(() => document.activeElement.id) === 'scan-price');
  check('quantity defaults to 1', (await page.inputValue('#scan-qty')) === '1');
  // Several .hint lines share the dialog now (size, price), so this has to
  // look across all of them rather than at whichever one happens to be first.
  const dialogHints = (await page.locator('.modal-card .hint').allTextContents()).join(' | ');
  check('last paid price is shown, got: ' + dialogHints, /5,50/.test(dialogHints));

  // Geometry, not just behaviour: the price and quantity inputs are type=text
  // (a number input can't hold "5,50"), so the modal's generic
  // input[type=text] rule outranks .num-input and once stretched the price
  // field past the card, detached from its R$ chip and out of line with the
  // stepper. Cheap to assert, invisible to every behavioural check.
  const geom = await page.evaluate(() => {
    const box = s => document.querySelector(s).getBoundingClientRect();
    const card = box('.modal-card'), price = box('#scan-price'),
          prefix = box('.fields-row .prefix'), qty = box('#scan-qty');
    return {
      insideCard: price.right <= card.right && price.left >= card.left,
      joinedToPrefix: Math.abs(price.left - prefix.right) < 1,
      // The chip and the input have to read as ONE control: same height, same
      // top. This is the half that survives the input merely overflowing.
      matchesPrefix: Math.abs(price.top - prefix.top) < 3
                  && Math.abs(price.height - prefix.height) < 3,
      alignedWithQty: Math.abs(price.bottom - qty.bottom) < 3,
      // .num-input is a flex child with min-width:0 here, so it can in
      // principle collapse rather than overflow.
      fillsColumn: price.width > 80,
    };
  });
  check('price field stays inside the dialog', geom.insideCard);
  check('price field is flush against its R$ prefix', geom.joinedToPrefix);
  check('price field and its R$ chip read as one control', geom.matchesPrefix);
  check('price and quantity sit on one line', geom.alignedWithQty);
  check('price field fills the rest of the row', geom.fillsColumn);

  // Same exposure for the package-size row: its amount box is a .num-input
  // inside a rule set that also styles full-width text inputs, and the unit
  // picker is the first <select> on the page, so nothing else would notice a
  // specificity clash wrapping them onto two lines or collapsing the select.
  const packGeom = await page.evaluate(() => {
    const box = s => document.querySelector(s).getBoundingClientRect();
    const card = box('.modal-card'), amt = box('#scan-net-qty'), unit = box('#scan-net-unit');
    return {
      insideCard: unit.right <= card.right && amt.left >= card.left,
      oneLine: Math.abs(amt.bottom - unit.bottom) < 3,
      unitVisible: unit.width > 40,
      amountVisible: amt.width > 40,
      notOverlapping: amt.right <= unit.left + 1,
    };
  });
  check('package size row stays inside the dialog', packGeom.insideCard);
  check('package amount and unit sit on one line', packGeom.oneLine);
  check('unit picker is not collapsed', packGeom.unitVisible);
  check('package amount field is not collapsed', packGeom.amountVisible);
  check('package amount does not overlap the unit picker', packGeom.notOverlapping);

  await page.click('.fields-row .step-btn[data-step="1"]');
  await page.waitForTimeout(100);
  check('dialog stepper raises the quantity', (await page.inputValue('#scan-qty')) === '2');
  await page.locator('#scan-price').pressSequentially('675');
  await page.waitForTimeout(100);
  check('dialog price is cents-first, got: ' + await page.inputValue('#scan-price'),
    (await page.inputValue('#scan-price')) === '6,75');
  await page.click('#scan-ok');

  await page.waitForFunction(() => document.querySelectorAll('.row[data-id]').length === 2,
    null, { timeout: 6000 });
  check('quantity from the dialog is saved',
    (await page.inputValue('.row[data-id="S2"] .qty-input')) === '2');
  // The size was prefilled and left alone, so the catalogue row must not be
  // rewritten — otherwise every scan of a known insumo costs a needless write.
  check('untouched size does not rewrite the insumo, got: ' +
      JSON.stringify(state.upserts),
    state.upserts.length === 0);
  check('price from the dialog is saved, got: ' +
      await page.inputValue('.row[data-id="S2"] .price-input'),
    (await page.inputValue('.row[data-id="S2"] .price-input')) === '6,75');
  const addedName = await page.textContent('.row[data-id="S2"] .txt');
  check('row has OFF name, got: ' + addedName, addedName === 'Leite Condensado Integral moça');
  const metaText = (await page.textContent('.row[data-id="S2"] .meta')).trim();
  check('brand and size shown under the name, got: ' + metaText,
    metaText === 'Casa de Bento · 1 L');
  check('hand-typed row has no meta line',
    (await page.$$('.row[data-id="I1"] .meta')).length === 0);

  // --- two DIFFERENT valid codes alternating never agree, so never accept ---
  await page.evaluate(() => window.__setCodes(
    ['7891000100103', '7899999999999', '7891000100103', '7899999999999',
     '7891000100103', '7899999999999', '7891000100103', '7899999999999']));
  await page.click('#scan-item-btn');
  await page.waitForSelector('.scan-overlay');
  await page.waitForTimeout(1400);
  check('flapping reads are not accepted', await overlayOpen());
  check('flapping adds no row', await rows() === 2);

  // --- camera picker lists every input, including the front one ---
  await page.click('#scan-cam');
  await page.waitForSelector('#cam-list .cam-item');
  const names = await page.$$eval('#cam-list .cam-name', els => els.map(e => e.textContent.trim()));
  check('picker lists every video input, got: ' + names.length, names.length === 5);
  check('neutrally-labelled rear lens is listed', names.some(n => /Camera 3/.test(n)));
  check('front camera listed and marked', names.some(n => /frontal/.test(n)));
  check('active lens marked', names.some(n => n.startsWith('●') && /camera2 0/.test(n)));

  // --- "Testar todas" reports real capabilities per lens ---
  await page.click('#cam-probe');
  await page.waitForFunction(
    () => document.querySelector('#cam-probe').textContent.includes('de novo'),
    null, { timeout: 15000 });
  const caps = await page.$$eval('#cam-list .cam-item', els => els.map(e => ({
    id: e.getAttribute('data-cam'),
    caps: e.querySelector('[data-caps]').textContent.trim(),
  })));
  const capOf = id => (caps.find(c => c.id === id) || {}).caps || '';
  check('probe reports autofocus on the main lens, got: ' + capOf('main'),
    /autofoco: single-shot, continuous/.test(capOf('main')));
  // The whole point: focusMode:["manual"] must NOT read as having autofocus.
  check('manual-only lens reported as having NO autofocus, got: ' + capOf('wide'),
    /SEM autofoco \(só manual\)/.test(capOf('wide')));
  check('lens with no focusMode at all reported too, got: ' + capOf('tele'),
    /^SEM autofoco/.test(capOf('tele')));
  check('probe reports the torch on the main lens', /lanterna/.test(capOf('main')));
  check('probe reports resolution, got: ' + capOf('main'), /4080×3060/.test(capOf('main')));

  // --- picking a lens switches to it and persists ---
  await page.click('#cam-list .cam-item[data-cam="tele"]');
  await page.waitForTimeout(500);
  check('picker closed', (await page.$$('#cam-list')).length === 0);
  check('chosen lens persisted',
    await page.evaluate(() => localStorage.getItem('maga_scan_camera_id')) === 'tele');
  check('camera restarted on the chosen lens',
    (await page.evaluate(() => window.__opened)).slice(-1)[0] === 'tele');
  check('scanner still open after switching', await overlayOpen());

  await page.click('#scan-close');
  await page.waitForTimeout(200);
  // Put the good lens back for the remaining scenarios.
  await page.evaluate(() => localStorage.setItem('maga_scan_camera_id', 'main'));

  // --- a code already on the list is "one more of that": the unit lands on
  // the existing row with NO dialog at all. An insumo that has already been
  // confirmed once has nothing left to confirm, and asking again on every
  // repeat scan is what made picking up a second box feel like adding a
  // stranger. ---
  await page.evaluate(() => window.__setCodes(['7891000100103']));
  await page.click('#scan-item-btn');
  await page.waitForFunction(
    () => document.querySelector('.row[data-id="S2"] .qty-input').value === '3',
    null, { timeout: 6000 });
  check('repeat scan adds a unit to the existing row',
    await page.inputValue('.row[data-id="S2"] .qty-input') === '3');
  check('no dialog at all for a repeat scan', (await page.$$('.modal-card')).length === 0);
  check('still 2 rows after the repeat scan', await rows() === 2);
  check('the repeat scan leaves the existing price alone, got: ' +
      await page.inputValue('.row[data-id="S2"] .price-input'),
    (await page.inputValue('.row[data-id="S2"] .price-input')) === '6,75');
  // The row can be anywhere, including off-screen, so a silent bump would
  // read as "my scan did nothing" — it gets scrolled to, lit up, and the
  // toast spells out the before → after.
  check('the row is lit up so the change is visible',
    await page.locator('.row[data-id="S2"]').evaluate(el => el.classList.contains('flash')));
  check('the toast names the before → after, got: ' + await page.textContent('#list-toast'),
    /2 → 3/.test(await page.textContent('#list-toast')) &&
    /Leite Condensado/.test(await page.textContent('#list-toast')));
  check('only the quantity is patched, got: ' + JSON.stringify(state.itemUpdates),
    state.itemUpdates.length === 1 && state.itemUpdates[0].id === 'S2' &&
    state.itemUpdates[0].quantity === 3 &&
    !('name' in state.itemUpdates[0]) && !('brand' in state.itemUpdates[0]));
  state.itemUpdates.length = 0;

  // --- unknown but VALID code still prompts, after the camera closes ---
  await page.evaluate(() => window.__setCodes(['7899999999999']));
  await page.click('#scan-item-btn');
  await page.waitForSelector('#scan-name', { timeout: 6000 });
  check('overlay gone before the dialog', !(await overlayOpen()));
  check('unknown code focuses the name field first',
    await page.evaluate(() => document.activeElement.id) === 'scan-name');
  check('unknown code cannot be saved without a name',
    await (async () => {
      await page.click('#scan-ok');
      await page.waitForTimeout(200);
      return (await page.$$('#scan-name')).length === 1;
    })());
  check('unknown code offers empty size fields',
    (await page.inputValue('#scan-net-qty')) === '' &&
    (await page.inputValue('#scan-net-unit')) === '');
  check('unknown code offers a brand field', (await page.$$('#scan-brand')).length === 1);
  await page.fill('#scan-name', 'Pão caseiro');
  await page.fill('#scan-brand', 'Wickbold');

  // The amount field takes digits and one separator only, like the item
  // quantity — a package size is a decimal, not free prose.
  await page.fill('#scan-net-qty', '');
  await page.locator('#scan-net-qty').pressSequentially('1a,5x');
  await page.waitForTimeout(120);
  check('size amount keeps only digits, got: ' + await page.inputValue('#scan-net-qty'),
    (await page.inputValue('#scan-net-qty')) === '1,5');

  // An amount with no unit is refused rather than guessed: "1,5" could be
  // grams or kilos, and guessing corrupts the number the recipes add up.
  // No native dialog fires any more — this is fieldError(), inline under
  // the unit field, not alert().
  let sawDialog = false;
  page.once('dialog', d => { sawDialog = true; d.dismiss(); });
  await page.click('#scan-ok');
  await page.waitForTimeout(250);
  check('amount without a unit keeps the dialog open',
    (await page.$$('#scan-net-qty')).length === 1);
  check('amount without a unit is never sent', state.upserts.length === 0);
  check('no native dialog fired', !sawDialog);
  check('a field-error message names the unit field, got: ' +
    (await page.locator('.field-error').last().textContent()),
    (await page.locator('.field-error').last().textContent())
      .indexOf('unidade do pacote') >= 0);

  await page.selectOption('#scan-net-unit', 'kg');
  await page.click('#scan-ok');
  await page.waitForFunction(() => document.querySelectorAll('.row[data-id]').length === 3,
    null, { timeout: 6000 });
  check('typed-name row added', await rows() === 3);
  // Normalized to the g/ml/un pair on the way out, and written against the
  // BARCODE (brand included), so the next scan of this code already knows
  // both. Fired in the background after the row lands, so it needs a moment.
  for (let i = 0; i < 40 && state.upserts.length === 0; i++) await page.waitForTimeout(50);
  check('size and brand stored against the barcode, got: ' + JSON.stringify(state.upserts),
    state.upserts.length === 1 && state.upserts[0].gtin === '7899999999999' &&
    state.upserts[0].net_qty === 1500 && state.upserts[0].net_unit === 'g' &&
    state.upserts[0].brand === 'Wickbold');
  check('new size and brand show on the row without a refetch, got: ' +
      (await page.textContent('.row[data-id="S3"] .meta')).trim(),
    (await page.textContent('.row[data-id="S3"] .meta')).trim() === 'Wickbold · 1,5 kg');

  // --- quick add: name and quantity only, one row ---
  check('quick-add form has no brand field', (await page.$$('#new-item-brand')).length === 0);
  check('quick-add form has no size field', (await page.$$('#new-item-net')).length === 0);
  check('quick-add form has no price field', (await page.$$('#new-item-price')).length === 0);
  check('quick-add placeholder renamed',
    (await page.getAttribute('#new-item-name', 'placeholder')) === 'Novo item rápido');
  // One visual line: the row is only as tall as a single control, and the
  // three sit left-to-right rather than stacked.
  const rowLayout = await page.evaluate(() => {
    const r = document.querySelector('.addrow.additem');
    const b = el => el.getBoundingClientRect();
    const row = b(r), name = b(r.querySelector('#new-item-name'));
    const qty = b(r.querySelector('#new-item-qty')), add = b(r.querySelector('#add-item-btn'));
    return { h: Math.round(row.height), ordered: name.right <= qty.left && qty.right <= add.left };
  });
  check('quick-add row is a single line, height ' + rowLayout.h, rowLayout.h < 60);
  check('name, quantity and buttons sit side by side', rowLayout.ordered);

  await page.fill('#new-item-name', 'Pão francês');
  await page.fill('#new-item-qty', '3');
  await page.click('#add-item-btn');
  await page.waitForFunction(() => document.querySelectorAll('.row[data-id]').length === 4,
    null, { timeout: 6000 });
  check('quick add keeps the typed quantity',
    (await page.inputValue('.row[data-id="M4"] .qty-input')) === '3');
  check('quick-add fields cleared after adding',
    (await page.inputValue('#new-item-name')) === '' &&
    (await page.inputValue('#new-item-qty')) === '');

  // --- per-item quantity steppers ---
  await page.click('.row[data-id="M4"] .step-btn[data-step="1"]');
  await page.waitForFunction(
    () => document.querySelector('.row[data-id="M4"] .qty-input').value === '4',
    null, { timeout: 5000 });
  check('+ steps the quantity up',
    (await page.inputValue('.row[data-id="M4"] .qty-input')) === '4');
  for (let i = 0; i < 5; i++) {
    await page.click('.row[data-id="M4"] .step-btn[data-step="-1"]');
    await page.waitForTimeout(120);
  }
  check('− steps down but never below 1, got: ' +
      (await page.inputValue('.row[data-id="M4"] .qty-input')),
    (await page.inputValue('.row[data-id="M4"] .qty-input')) === '1');
  check('stepping updates the list total',
    /R\$/.test(await page.textContent('.total-bar')));

  // --- quantity: digits only, and tapping selects what's there ---
  const qtySel = '.row[data-id="M4"] .qty-input';
  const qtyBox = page.locator(qtySel);
  await qtyBox.fill('');
  await qtyBox.pressSequentially('a2e-b5');
  await page.waitForTimeout(120);
  check('quantity keeps only digits, got: ' + await page.inputValue(qtySel),
    (await page.inputValue(qtySel)) === '25');
  await qtyBox.fill('');
  await qtyBox.pressSequentially('1,5,5');
  await page.waitForTimeout(120);
  check('quantity keeps a single separator, got: ' + await page.inputValue(qtySel),
    (await page.inputValue(qtySel)) === '1,55');

  await qtyBox.fill('7');
  await qtyBox.blur();
  await page.waitForTimeout(200);
  // tapping selects the whole value, so the next digit replaces it
  const qtyBoxRect = await qtyBox.boundingBox();
  await page.mouse.click(qtyBoxRect.x + qtyBoxRect.width - 6, qtyBoxRect.y + qtyBoxRect.height / 2);
  await page.waitForTimeout(150);
  const qtySelection = await page.$eval(qtySel,
    el => [el.selectionStart, el.selectionEnd, el.value.length]);
  check('tapping the quantity selects all of it, got: ' + JSON.stringify(qtySelection),
    qtySelection[0] === 0 && qtySelection[1] === qtySelection[2]);
  await page.keyboard.type('3');
  await page.waitForTimeout(120);
  check('typing after the tap replaces rather than appends, got: ' +
      await page.inputValue(qtySel), (await page.inputValue(qtySel)) === '3');
  await qtyBox.blur();
  await page.waitForTimeout(200);

  // --- the edit dialog has the same fields, in the same order, as the scan
  // dialog: name, brand, code, size, quantity, price. A quick-add row is a
  // reminder to buy something, not a catalogue entry, so brand/size stay
  // out of the way until a code is attached — but quantity and price are
  // right there either way. ---
  await page.click('.row[data-id="M4"] [data-action="rename-item"]');
  await page.waitForSelector('#edit-name');
  check('brand hidden for a barcode-less item', await page.isHidden('#edit-brand-field'));
  check('size hidden for a barcode-less item', await page.isHidden('#edit-net-field'));
  check('hint explains why, got: ' + await page.textContent('#edit-gtin-hint'),
    /lembrança de compra/.test(await page.textContent('#edit-gtin-hint')));
  check('quantity is editable from the pencil too, got: ' + await page.inputValue('#edit-qty'),
    (await page.inputValue('#edit-qty')) === '3');
  await page.fill('#edit-name', 'Pão de forma');
  await page.click('#edit-ok');
  await page.waitForFunction(
    () => document.querySelector('.row[data-id="M4"] .txt').textContent.trim() === 'Pão de forma',
    null, { timeout: 6000 });
  check('name updated', (await page.textContent('.row[data-id="M4"] .txt')).trim() === 'Pão de forma');
  check('still no meta line — there is no insumo behind a hand-typed row',
    (await page.$$('.row[data-id="M4"] .meta')).length === 0);

  // --- the camera icon replaces the old warning triangle, but only for a
  // row with no code of its own yet — a linked row keeps its code through
  // the pencil, whose dialog has its own scan button for a rescan ---
  check('barcode-less row shows the camera',
    await page.isVisible('.row[data-id="M4"] [data-action="scan-item"]'));
  check('a scanned row hides it',
    !(await page.isVisible('.row[data-id="S2"] [data-action="scan-item"]')));

  // --- tapping the camera opens the scanner immediately, no dialog first —
  // and whatever it resolves to lands prefilled in the same review dialog
  // editing already uses, brand included, before anything is saved ---
  // A gtin of its own, distinct from the ones later scenarios need
  // untouched (7896004700236 for the "fresh insert" test, 7891000100103
  // for the rescan-vs-merge history this row already carries).
  await page.evaluate(() => window.__setCodes(['7897001234564']));
  await page.click('.row[data-id="M4"] [data-action="scan-item"]');
  await page.waitForSelector('.scan-overlay');
  await page.waitForSelector('#edit-name', { timeout: 6000 });
  check('overlay gone before the review dialog', (await page.$$('.scan-overlay')).length === 0);
  check('name filled from the catalogue, got: ' + await page.inputValue('#edit-name'),
    (await page.inputValue('#edit-name')) === 'Suco de Uva Aurora');
  check('brand revealed and filled from the catalogue, got: ' + await page.inputValue('#edit-brand'),
    (await page.isVisible('#edit-brand-field')) &&
    (await page.inputValue('#edit-brand')) === 'Aurora');
  check('code filled in too', (await page.inputValue('#edit-gtin')) === '7897001234564');
  await page.click('#edit-ok');
  await page.waitForFunction(
    () => document.querySelector('.row[data-id="M4"] .txt').textContent.trim() === 'Suco de Uva Aurora',
    null, { timeout: 6000 });
  check('name replaced by the catalogue on the row',
    (await page.textContent('.row[data-id="M4"] .txt')).trim() === 'Suco de Uva Aurora');
  check('brand shown on the row, got: ' + (await page.textContent('.row[data-id="M4"] .meta')).trim(),
    (await page.textContent('.row[data-id="M4"] .meta')).trim() === 'Aurora');
  check('camera hides once the row is linked to a code',
    !(await page.isVisible('.row[data-id="M4"] [data-action="scan-item"]')));

  // --- rescanning from INSIDE the edit dialog (opened via the pencil, not
  // the row's own camera) shows the newly resolved insumo live too — the
  // "wrong one got scanned" case — without saving over the row yet. Uses a
  // code no other row has, so this is testing the live-fill on its own,
  // separate from the collision handling covered further down. ---
  await page.click('.row[data-id="M4"] [data-action="rename-item"]');
  await page.waitForSelector('#edit-gtin');
  await page.evaluate(() => window.__setCodes(['7891234567895']));
  await page.click('#edit-scan');
  await page.waitForSelector('.scan-overlay');
  await page.waitForFunction(
    () => document.querySelector('#edit-name').value === 'Manteiga com Sal',
    null, { timeout: 6000 });
  check('rescan-from-edit fills the newly resolved name',
    (await page.inputValue('#edit-name')) === 'Manteiga com Sal');
  check('rescan-from-edit fills the newly resolved brand, got: ' + await page.inputValue('#edit-brand'),
    (await page.inputValue('#edit-brand')) === 'Aviação');
  check('rescan-from-edit fills the newly resolved size, got: ' +
      await page.inputValue('#edit-net-qty') + ' / ' + await page.inputValue('#edit-net-unit'),
    (await page.inputValue('#edit-net-qty')) === '200' && (await page.inputValue('#edit-net-unit')) === 'g');
  check('rescan-from-edit fills the newly resolved code',
    (await page.inputValue('#edit-gtin')) === '7891234567895');
  // Cancelled on purpose: M4 stays the Suco de Uva Aurora row the rest of the
  // test still relies on — this only proves the rescan is caught before
  // anything saves, which is the whole point of reviewing it here first.
  await page.click('#edit-cancel');

  // --- quantity and price are editable from the pencil too, in the same row
  // the scan dialog puts them in ---
  await page.click('.row[data-id="M4"] [data-action="rename-item"]');
  await page.waitForSelector('#edit-price');
  check('price field starts blank for an item with no price yet',
    (await page.inputValue('#edit-price')) === '');
  await page.locator('#edit-price').pressSequentially('999');
  await page.waitForTimeout(80);
  check('edit-modal price is cents-first too, got: ' + await page.inputValue('#edit-price'),
    (await page.inputValue('#edit-price')) === '9,99');
  await page.fill('#edit-qty', '5');
  await page.click('#edit-ok');
  await page.waitForFunction(
    () => document.querySelector('.row[data-id="M4"] .price-input').value === '9,99',
    null, { timeout: 6000 });
  check('price set through the edit dialog shows on the row',
    (await page.inputValue('.row[data-id="M4"] .price-input')) === '9,99');
  check('quantity set through the edit dialog shows on the row, got: ' +
      await page.inputValue('.row[data-id="M4"] .qty-input'),
    (await page.inputValue('.row[data-id="M4"] .qty-input')) === '5');
  const m4Subtotal = (await page.textContent('.row[data-id="M4"] [data-subtotal]'))
    .replace(/[  ]/g, ' ').trim();
  check('line total follows both, got: ' + m4Subtotal, m4Subtotal === 'R$ 49,95');

  // --- price: cents-first, digits fill in from the right ---
  const priceSel = '.row[data-id="I1"] .price-input';
  const priceBox = page.locator(priceSel);
  check('existing price rendered with comma and two decimals, got: ' +
      await page.inputValue(priceSel), (await page.inputValue(priceSel)) === '12,50');

  // Focus once, then type: re-focusing between digits would re-select the
  // whole amount and make each digit a replace instead of an append.
  await priceBox.fill('');
  await priceBox.focus();
  await page.waitForTimeout(80);
  const progression = [];
  for (const digit of '12345') {
    await page.keyboard.type(digit);
    await page.waitForTimeout(60);
    progression.push(await page.inputValue(priceSel));
  }
  check('digits fill from the right, got: ' + progression.join(' '),
    progression.join(' ') === '0,01 0,12 1,23 12,34 123,45');

  // Intl currency formatting puts a non-breaking space after "R$".
  const subtotal = async () =>
    (await page.textContent('.row[data-id="I1"] [data-subtotal]'))
      .replace(/[\u00a0\u202f]/g, ' ').trim();
  await priceBox.blur();
  await page.waitForTimeout(200);
  check('line total follows the typed price, got: ' + await subtotal(),
    (await subtotal()) === 'R$ 123,45');

  // Backspacing must walk all the way back to empty, not stall on 0,00.
  // No re-focusing inside the loop: a tap selects the whole amount, so
  // focus-then-backspace deliberately clears it in one go (tested below).
  await priceBox.fill('');
  await priceBox.pressSequentially('12345');
  await page.waitForTimeout(80);
  const backwards = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(60);
    backwards.push(await page.inputValue(priceSel));
  }
  check('backspacing clears down to empty, got: ' + JSON.stringify(backwards.join(' ')),
    backwards.join(' ') === '12,34 1,23 0,12 0,01 ');

  // ...and because a tap selects everything, one backspace after tapping
  // wipes the amount, which is the same "replace this" promise.
  await priceBox.fill('');
  await priceBox.pressSequentially('999');
  await page.waitForTimeout(80);
  await priceBox.blur();
  await priceBox.focus();
  await page.waitForTimeout(150);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(80);
  check('tap then backspace clears the whole amount, got: ' +
      JSON.stringify(await page.inputValue(priceSel)),
    (await page.inputValue(priceSel)) === '');

  await priceBox.blur();
  await page.waitForTimeout(200);
  check('cleared price shows no line total', (await subtotal()) === '');

  // thousands are grouped, and a stray non-digit is simply ignored
  await priceBox.fill('');
  await priceBox.pressSequentially('123456');
  await page.waitForTimeout(80);
  check('thousands grouped, got: ' + await page.inputValue(priceSel),
    (await page.inputValue(priceSel)) === '1.234,56');
  await priceBox.pressSequentially('a');
  await page.waitForTimeout(80);
  check('non-digits ignored, got: ' + await page.inputValue(priceSel),
    (await page.inputValue(priceSel)) === '1.234,56');
  // --- tapping selects the whole amount, wherever you tap ---
  const caret = () => page.$eval(priceSel, el => [el.selectionStart, el.selectionEnd, el.value.length]);
  const box = await priceBox.boundingBox();
  // tap near the LEFT edge, i.e. in the middle of "1.234,56"
  await page.mouse.click(box.x + 8, box.y + box.height / 2);
  await page.waitForTimeout(150);
  const afterLeftTap = await caret();
  check('tapping the left of the number selects all of it, got: ' +
      JSON.stringify(afterLeftTap),
    afterLeftTap[0] === 0 && afterLeftTap[1] === afterLeftTap[2] && afterLeftTap[2] > 0);

  // typing over that selection restarts the amount cents-first
  await page.keyboard.type('7');
  await page.waitForTimeout(100);
  check('typing after the tap restarts the amount, got: ' + await page.inputValue(priceSel),
    (await page.inputValue(priceSel)) === '0,07');
  // and the digits keep filling from the right afterwards
  await page.keyboard.type('5');
  await page.waitForTimeout(100);
  check('digits keep filling from the right after a replace, got: ' +
      await page.inputValue(priceSel), (await page.inputValue(priceSel)) === '0,75');

  // re-focusing from elsewhere selects everything too
  await priceBox.blur();
  await page.waitForTimeout(80);
  await priceBox.focus();
  await page.waitForTimeout(150);
  const afterRefocus = await caret();
  check('re-focusing selects the whole amount, got: ' + JSON.stringify(afterRefocus),
    afterRefocus[0] === 0 && afterRefocus[1] === afterRefocus[2]);

  await priceBox.fill('');
  await priceBox.blur();
  await page.waitForTimeout(200);

  // --- REGRESSION: editing an item that already has a barcode, without
  // changing the code, must store overrides rather than reset to the
  // catalogue. This used to silently discard every edit. ---
  await page.click('.row[data-id="M4"] [data-action="rename-item"]');
  await page.waitForSelector('#edit-name');
  await page.fill('#edit-name', 'Leite Moça lata');
  await page.fill('#edit-brand', 'Nestlé BR');
  await page.fill('#edit-net-qty', '800');
  await page.selectOption('#edit-net-unit', 'g');
  await page.click('#edit-ok');
  await page.waitForFunction(
    () => /800/.test((document.querySelector('.row[data-id="M4"] .meta') || {}).textContent || ''),
    null, { timeout: 6000 });
  check('edit of a barcoded item keeps the new name',
    (await page.textContent('.row[data-id="M4"] .txt')).trim() === 'Leite Moça lata');
  check('edit of a barcoded item stores brand/size overrides, got: ' +
      (await page.textContent('.row[data-id="M4"] .meta')).trim(),
    (await page.textContent('.row[data-id="M4"] .meta')).trim() === 'Nestlé BR · 800 g');
  check('the barcode survives the edit, camera stays hidden',
    !(await page.isVisible('.row[data-id="M4"] [data-action="scan-item"]')));

  // --- correcting a KNOWN insumo on its very FIRST scan (a fresh insert,
  // not a merge) — the name goes through as part of the insert itself, so
  // only the brand should need a follow-up patch. Run last, and its own
  // barcode, so the row-count checks and ids earlier in the test are
  // undisturbed by it. ---
  state.itemUpdates.length = 0;
  const rowCountBefore = await rows();
  await page.evaluate(() => window.__setCodes(['7896004700236']));
  await page.click('#scan-item-btn');
  await page.waitForSelector('#scan-price', { timeout: 6000 });
  check('second known insumo prefills its own name and brand, got: ' +
      await page.inputValue('#scan-name') + ' / ' + await page.inputValue('#scan-brand'),
    (await page.inputValue('#scan-name')) === 'Bolacha Maria' &&
    (await page.inputValue('#scan-brand')) === 'Adria');
  await page.fill('#scan-name', 'Bolacha Maria Tradicional');
  await page.fill('#scan-brand', 'Piraquê');
  await page.click('#scan-ok');
  await page.waitForFunction(
    (n) => document.querySelectorAll('.row[data-id]').length === n,
    rowCountBefore + 1, { timeout: 6000 });
  const newRowId = await page.evaluate(() =>
    document.querySelector('.row:last-child').getAttribute('data-id'));
  check('corrected name used for the new row, got: ' +
      await page.textContent('.row[data-id="' + newRowId + '"] .txt'),
    (await page.textContent('.row[data-id="' + newRowId + '"] .txt')).trim() ===
      'Bolacha Maria Tradicional');
  check('corrected brand shown on the new row, got: ' +
      (await page.textContent('.row[data-id="' + newRowId + '"] .meta')).trim(),
    (await page.textContent('.row[data-id="' + newRowId + '"] .meta')).trim() === 'Piraquê');
  // The name was already sent as part of the insert itself (shopping_item_scan
  // took it directly), so the follow-up patch should carry the brand only —
  // resending an unchanged name would just be a wasted round trip.
  check('fresh insert only patches the brand, not the name, got: ' +
      JSON.stringify(state.itemUpdates),
    state.itemUpdates.length === 1 && state.itemUpdates[0].id === newRowId &&
    state.itemUpdates[0].brand === 'Piraquê' && !('name' in state.itemUpdates[0]));
  check('no catalogue write for a correction on an insumo that already exists',
    state.upserts.every(u => u.gtin !== '7896004700236'));

  // --- two rows can't share a barcode: a code that resolves to ANOTHER row
  // already in the list merges into it instead of creating a duplicate,
  // with no dialog in the way. I1 ("Café") has no code of its own yet, so
  // attaching one that turns out to already be S2's merges SILENTLY, right
  // when the code is read — the same way a fresh scan from the "+" flow
  // already merges on sight — and no "Adicionar item" dialog ever shows. ---
  check('I1 shows the camera — it has no code yet',
    await page.isVisible('.row[data-id="I1"] [data-action="scan-item"]'));
  const rowsBeforeSilentMerge = await rows();
  await page.evaluate(() => window.__setCodes(['7891000100103']));
  await page.click('.row[data-id="I1"] [data-action="scan-item"]');
  await page.waitForSelector('.scan-overlay');
  await page.waitForFunction(
    (n) => document.querySelectorAll('.row[data-id]').length === n,
    rowsBeforeSilentMerge - 1, { timeout: 6000 });
  check('no dialog ever shown for a silent merge',
    (await page.$$('.modal-card')).length === 0);
  check('I1 is gone, merged away', (await page.$$('.row[data-id="I1"]')).length === 0);
  check('its quantity landed on the existing item, got: ' +
      await page.inputValue('.row[data-id="S2"] .qty-input'),
    (await page.inputValue('.row[data-id="S2"] .qty-input')) === '4');
  check('a toast explains what happened, got: ' + await page.textContent('#list-toast'),
    /estava na lista/i.test(await page.textContent('#list-toast')) &&
    /Leite Condensado/.test(await page.textContent('#list-toast')));

  // --- a row that already has ITS OWN code, rescanned (from inside the edit
  // dialog) to one that turns out to belong to someone else: a correction to
  // something already decided, so the warning shows FIRST — before the scan
  // result ever reaches the dialog's fields — rather than after reviewing
  // and saving it. ---
  await page.click('.row[data-id="M4"] [data-action="rename-item"]');
  await page.waitForSelector('#edit-gtin');
  const nameBeforeScan = await page.inputValue('#edit-name');
  await page.evaluate(() => window.__setCodes(['7899999999999']));
  await page.click('#edit-scan');
  await page.waitForSelector('.scan-overlay');
  await page.waitForSelector('#confirm-ok', { timeout: 6000 });
  const warnText = await page.locator('.modal-backdrop').last().locator('p').first().textContent();
  check('warns which item the code belongs to, got: ' + warnText,
    /Pão caseiro/.test(warnText) && /Leite Moça lata/.test(warnText));
  check('the dialog underneath still shows its OWN, unscanned name — the ' +
      'scan never reached the fields, got: ' + await page.inputValue('#edit-name'),
    (await page.inputValue('#edit-name')) === nameBeforeScan);

  // Declining leaves both rows exactly as they were — including M4's OWN
  // code, which the scan never got to apply — and closes the edit dialog too.
  const rowsBeforeCancel = await rows();
  await page.click('#confirm-cancel');
  await page.waitForTimeout(200);
  check('declining closes the edit dialog', (await page.$$('#edit-name')).length === 0);
  check('declining the merge changes the row count not at all, got: ' + await rows(),
    (await rows()) === rowsBeforeCancel);
  check('M4 keeps its own name',
    (await page.textContent('.row[data-id="M4"] .txt')).trim() === 'Leite Moça lata');
  check('M4 keeps its own code, camera stays hidden',
    !(await page.isVisible('.row[data-id="M4"] [data-action="scan-item"]')));
  check('S3 quantity unchanged', (await page.inputValue('.row[data-id="S3"] .qty-input')) === '1');

  // Same scan again, this time accepted.
  await page.click('.row[data-id="M4"] [data-action="rename-item"]');
  await page.waitForSelector('#edit-gtin');
  await page.evaluate(() => window.__setCodes(['7899999999999']));
  await page.click('#edit-scan');
  await page.waitForSelector('.scan-overlay');
  await page.waitForSelector('#confirm-ok', { timeout: 6000 });
  const rowsBeforeAccept = await rows();
  await page.click('#confirm-ok');
  await page.waitForFunction(
    (n) => document.querySelectorAll('.row[data-id]').length === n,
    rowsBeforeAccept - 1, { timeout: 6000 });
  check('accepting closes the edit dialog too', (await page.$$('#edit-name')).length === 0);
  check('M4 is gone, merged away', (await page.$$('.row[data-id="M4"]')).length === 0);
  check('one unit added to the item the code actually belongs to, got: ' +
      await page.inputValue('.row[data-id="S3"] .qty-input'),
    (await page.inputValue('.row[data-id="S3"] .qty-input')) === '2');

  // --- a row already IN THE CART still matches: checking it off means it's
  // in the trolley, not that it's off the list, so scanning the code again
  // is a walk back to the aisle for one more and belongs on that same line.
  // ("Confirmar compra" is a separate, explicit step that posts checked
  // rows to stock/finance — it never removes a row, so a checked row stays
  // matchable for a repeat scan either way.) ---
  await page.click('.row[data-id="S2"] [data-purchase]');
  await page.waitForFunction(
    () => document.querySelector('.row[data-id="S2"] .txt').classList.contains('done'),
    null, { timeout: 6000 });
  const qtyBeforeCartScan = await page.inputValue('.row[data-id="S2"] .qty-input');
  const rowsBeforeCartScan = await rows();
  await page.evaluate(() => window.__setCodes(['7891000100103']));
  await page.click('#scan-item-btn');
  await page.waitForFunction(
    (q) => document.querySelector('.row[data-id="S2"] .qty-input').value !== q,
    qtyBeforeCartScan, { timeout: 6000 });
  check('scanning a checked-off item bumps it rather than starting a new line, got: ' +
      await page.inputValue('.row[data-id="S2"] .qty-input') + ' from ' + qtyBeforeCartScan,
    (await page.inputValue('.row[data-id="S2"] .qty-input')) ===
      String(Number(qtyBeforeCartScan) + 1));
  check('no new row for a checked-off item', (await rows()) === rowsBeforeCartScan);
  check('no dialog either', (await page.$$('.modal-card')).length === 0);
  check('it stays in the cart', await page.locator('.row[data-id="S2"] [data-purchase]')
    .evaluate(el => el.checked));

  // --- "Confirmar compra": posts the checked rows to stock/finance, and
  // never removes a row (that's still Limpar comprados' job) ---
  check('confirm button visible once something is checked off',
    await page.isVisible('#confirm-purchase-btn'));
  await page.click('#confirm-purchase-btn');
  await page.waitForSelector('.modal-card');
  const confirmMsg = await page.textContent('.modal-card p');
  check('confirm dialog names the barcoded count, got: ' + confirmMsg,
    /1 item comprado/.test(confirmMsg));
  await page.click('.modal-card .save');
  await page.waitForFunction(
    () => (document.getElementById('list-toast') || {}).textContent.includes('lançado'),
    null, { timeout: 6000 });
  check('confirm sent the right list_id, got: ' + JSON.stringify(state.lastConfirmBody),
    state.lastConfirmBody && state.lastConfirmBody.list_id === 'L1');
  check('toast reports the confirmed count, got: ' + await page.textContent('#list-toast'),
    /1 item lançado/.test(await page.textContent('#list-toast')));
  check('row still on the list — Confirmar never deletes it',
    (await page.$$('.row[data-id="S2"]')).length === 1);
  check('still in the cart afterwards', await page.locator('.row[data-id="S2"] [data-purchase]')
    .evaluate(el => el.checked));

  await page.screenshot({ path: path.join(SHOTS, 'after_scan.png'), fullPage: true });
  await browser.close();
  server.close();
  if (process.env.KEEP_SHOTS) console.log('screenshots: ' + SHOTS);

  console.log('--- JS errors ---');
  console.log(errors.length ? errors.join('\n') : '(none)');
  console.log('--- failures ---');
  console.log(failures.length ? failures.join('\n') : '(none)');
  process.exit(failures.length || errors.length ? 1 : 0);
})();
