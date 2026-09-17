// Static/logic check for shared-inputs.js's GTIN helpers — no browser
// needed, since gtinCheckDigit()/synthGtin() are pure arithmetic with no
// DOM dependency. Same "load the source, run it" shape as
// test/css-tokens.test.js.
//
//   node test/shared-inputs.test.js          # exits non-zero on any failure
//
// Why this exists: phase 2b's "+ Novo insumo" needs a client-generated
// EAN-13 (GS1 restricted-circulation range, prefix "2") for an insumo with
// no real barcode. A broken check digit would fail silently downstream —
// maga-api's insumo_upsert (via normalizeGtin) would just refuse the write,
// and "why won't this save" is a bad way to discover a generator bug.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB_DIR = path.resolve(__dirname, '..');
const failures = [];
function check(label, ok) {
  if (!ok) failures.push('FAIL: ' + label);
  console.log((ok ? 'ok   ' : 'FAIL ') + label);
}

// Load shared-inputs.js into an isolated context. Its top level is only
// const/function declarations — no call happens until the test makes one —
// so this needs no stubs for esc()/fmtStockQty(), which only functions this
// file doesn't exercise ever call.
const src = fs.readFileSync(path.join(WEB_DIR, 'shared-inputs.js'), 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'shared-inputs.js' });

check('gtinCheckDigit is defined', typeof ctx.gtinCheckDigit === 'function');
check('synthGtin is defined', typeof ctx.synthGtin === 'function');

// Known-good REAL EAN-13/UPC-A codes (from the OFF sampling recorded in
// maga-api's CLAUDE.md), computed by hand against the GS1 mod-10 algorithm
// independently of this file, so a broken TEST can't read as a working
// generator.
const KNOWN_GOOD = [
  '7891000100103', // Leite Moça
  '057000017859',  // Heinz Relish (UPC-A)
];
for (const code of KNOWN_GOOD) {
  const lead = code.slice(0, -1);
  const check_digit = Number(code.slice(-1));
  check('gtinCheckDigit(' + lead + ') === ' + check_digit,
    ctx.gtinCheckDigit(lead) === check_digit);
}

// A deliberately wrong check digit must NOT pass.
check('gtinCheckDigit rejects a wrong check digit',
  ctx.gtinCheckDigit('789100010010') !== 9 /* real check digit is 3 */);

// synthGtin(): every generated code, over many runs (it's random), is a
// 13-digit numeric string, starts with "2" (GS1's restricted-circulation
// range), and passes the very check digit algorithm it was built from —
// the same validation maga-api's normalizeGtin runs server-side.
const N = 500;
const codes = new Set();
let allValid = true;
let allThirteen = true;
let allPrefix2 = true;
for (let i = 0; i < N; i++) {
  const code = ctx.synthGtin();
  codes.add(code);
  if (!/^\d{13}$/.test(code)) allThirteen = false;
  if (code[0] !== '2') allPrefix2 = false;
  const lead = code.slice(0, -1);
  const digit = Number(code.slice(-1));
  if (ctx.gtinCheckDigit(lead) !== digit) allValid = false;
}
check('synthGtin() always returns a 13-digit numeric string', allThirteen);
check('synthGtin() always starts with "2" (GS1 restricted-circulation range)', allPrefix2);
check('synthGtin() always passes the GS1 mod-10 check digit', allValid);
// Not a collision guarantee (that's the caller's job, checked against the
// live catalogue) — just confirms the random digits are actually random.
check('synthGtin() produces distinct codes across ' + N + ' runs, got ' + codes.size,
  codes.size === N);

console.log('--- failures ---');
console.log(failures.length ? failures.join('\n') : '(none)');
process.exit(failures.length ? 1 : 0);
