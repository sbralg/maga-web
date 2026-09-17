// Static check: every `var(--token)` used anywhere resolves to a token
// actually defined in shared-base.css's :root.
//
// Why this exists: preferencias.html styled its success state as
// `color:var(--ok, var(--accent))` and `--ok` was never defined anywhere.
// CSS custom properties fail silently — the fallback simply wins — so a
// "resolved / found it" confirmation rendered in the brand RED for its
// whole life, looking exactly like an error. Nothing about that is visible
// in a class-name assertion, and it does not throw, so only a check of the
// token vocabulary itself catches it.
//
//   node test/css-tokens.test.js          # exits non-zero on any failure
const fs = require('fs');
const path = require('path');

const WEB_DIR = path.resolve(__dirname, '..');
const failures = [];
function check(label, ok) {
  if (!ok) failures.push('FAIL: ' + label);
  console.log((ok ? 'ok   ' : 'FAIL ') + label);
}

// The vocabulary: whatever shared-base.css declares on :root, in either
// colour scheme. Every page loads it first, so this is the full set.
const base = fs.readFileSync(path.join(WEB_DIR, 'shared-base.css'), 'utf8');
const defined = new Set([...base.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(m => m[1]));
check('shared-base.css defines the token vocabulary, got: ' + defined.size + ' tokens',
  defined.size > 10);

// Anywhere a token is consumed: the shared sheets and every page's own
// <style> block (and inline style attributes, which do use them).
const files = fs.readdirSync(WEB_DIR)
  .filter(f => f.endsWith('.css') || f.endsWith('.html') || f.endsWith('.js'));

const unknown = new Map(); // token -> first file using it
for (const f of files) {
  const src = fs.readFileSync(path.join(WEB_DIR, f), 'utf8');
  // Locally-defined tokens are legitimate too (a page may declare its own),
  // so subtract whatever this file itself defines.
  const localDefs = new Set([...src.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(m => m[1]));
  for (const m of src.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
    const token = m[1];
    if (defined.has(token) || localDefs.has(token)) continue;
    if (!unknown.has(token)) unknown.set(token, f);
  }
}

check('every var(--token) resolves to a defined token, undefined: ' +
  (unknown.size ? [...unknown].map(([t, f]) => t + ' (in ' + f + ')').join(', ') : 'none'),
  unknown.size === 0);

// The dark scheme must redefine every colour the light one sets, or a page
// silently keeps a light-mode colour in dark mode.
const darkBlock = (base.match(/@media \(prefers-color-scheme: dark\)\{([\s\S]*?)\n\}/) || [])[1] || '';
const darkDefined = new Set([...darkBlock.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(m => m[1]));
const lightBlock = base.slice(0, base.indexOf('@media'));
const lightColourTokens = [...lightBlock.matchAll(/(--[a-z0-9-]+)\s*:\s*(#|rgba?\()/gi)].map(m => m[1]);
const notInDark = lightColourTokens.filter(t => !darkDefined.has(t));
check('every light colour token is redefined for dark mode, missing: ' +
  (notInDark.length ? notInDark.join(', ') : 'none'),
  notInDark.length === 0);

console.log('--- failures ---');
console.log(failures.length ? failures.join('\n') : '(none)');
process.exit(failures.length ? 1 : 0);
