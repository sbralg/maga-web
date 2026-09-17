// Structural check on sw.js's SHELL_FILES — the offline app shell.
//
// Why this exists: `assets/logo-badge.svg` was missing from the list for
// its whole life. It is the header brand mark on every page, the login
// screen's logo and the drawer's, so the offline shell rendered the entire
// app logo-less — and nothing could have caught it, because `install`
// deliberately swallows a failed `cache.add` per file (sw.js's own comment
// explains why: one bad entry must not fail the whole install). That makes
// a missing or misspelled entry completely silent by design. `shared-pwa.js`
// — the script that registers the service worker at all — was missing too.
//
// So this walks the real pages instead of trusting the list: every local
// file the HTML actually references has to be in SHELL_FILES, and every
// entry in SHELL_FILES has to exist on disk. No browser needed.
//
//   node test/sw.test.js          # exits non-zero on any failure
const fs = require('fs');
const path = require('path');

const WEB_DIR = path.resolve(__dirname, '..');
const failures = [];
function check(label, ok) {
  if (!ok) failures.push('FAIL: ' + label);
  console.log((ok ? 'ok   ' : 'FAIL ') + label);
}

// SHELL_FILES is a plain array literal in sw.js; read it out rather than
// importing, since sw.js is a service worker and references `self`.
const swSrc = fs.readFileSync(path.join(WEB_DIR, 'sw.js'), 'utf8');
const listMatch = swSrc.match(/const SHELL_FILES = \[([\s\S]*?)\];/);
if (!listMatch) {
  console.error('could not find SHELL_FILES in sw.js');
  process.exit(2);
}
// Line comments inside the array are stripped first — the entries are
// documented inline, and a quoted phrase in a comment would otherwise be
// read as a filename.
const shell = new Set(
  [...listMatch[1].replace(/^\s*\/\/.*$/gm, '').matchAll(/"([^"]+)"/g)].map(m => m[1])
);

const cacheName = (swSrc.match(/const CACHE_NAME = "([^"]+)"/) || [])[1];
check('sw.js declares a CACHE_NAME, got: ' + cacheName, !!cacheName);

const pages = fs.readdirSync(WEB_DIR).filter(f => f.endsWith('.html'));
check('found the app pages to scan, got: ' + pages.length, pages.length >= 15);

// Every local file the pages actually pull in.
const referenced = new Map(); // file -> the page that referenced it first
for (const page of pages) {
  const src = fs.readFileSync(path.join(WEB_DIR, page), 'utf8');
  const refs = [
    ...[...src.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]),
    ...[...src.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]),
    ...[...src.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)].map(m => m[1]),
  ];
  for (const r of refs) {
    if (/^https?:|^\/\//.test(r)) continue; // external, never cached here
    if (!referenced.has(r)) referenced.set(r, page);
  }
}
// Assets referenced from the shared scripts too (the login logo, the
// drawer's, the notification badge) — those are just as on-screen.
for (const js of fs.readdirSync(WEB_DIR).filter(f => f.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(WEB_DIR, js), 'utf8');
  for (const m of src.matchAll(/["'](assets\/[^"']+)["']/g)) {
    if (!referenced.has(m[1])) referenced.set(m[1], js);
  }
}

const missing = [...referenced.entries()].filter(([f]) => !shell.has(f));
check('every file the pages reference is in SHELL_FILES, missing: ' +
  (missing.length ? missing.map(([f, from]) => f + ' (from ' + from + ')').join(', ') : 'none'),
  missing.length === 0);

const everyPageListed = pages.filter(p => !shell.has(p));
check('every .html page is in SHELL_FILES, missing: ' +
  (everyPageListed.length ? everyPageListed.join(', ') : 'none'),
  everyPageListed.length === 0);

// The other direction: a typo'd entry is silent at install time, so it has
// to be caught here.
const ghosts = [...shell].filter(f => f !== './' && !fs.existsSync(path.join(WEB_DIR, f)));
check('every SHELL_FILES entry exists on disk, ghosts: ' +
  (ghosts.length ? ghosts.join(', ') : 'none'),
  ghosts.length === 0);

console.log('--- failures ---');
console.log(failures.length ? failures.join('\n') : '(none)');
process.exit(failures.length ? 1 : 0);
