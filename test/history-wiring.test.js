// Static check on how pages wire themselves to shared-history.js.
//
// WHY A STATIC TEST. The pilot's first cut had the back BUTTON call
// showList() — which re-renders the list but never touches the URL — while
// hardware Back went through the router. The two then disagreed about
// which screen you were on, and the symptom was remote from the cause: a
// background refresh silently stopped repainting, because it correctly
// saw an id still in the URL.
//
// No per-page suite could have caught it. Those suites drive the pages by
// clicking, and clicking #back LOOKED right — the list appeared. Only the
// URL was wrong. Several pages' suites never click a list row at all, so
// they would not have noticed either. This reads the source instead, and
// costs no browser.
//
// Same shape as test/sw.test.js and test/css-tokens.test.js: walk the real
// files, fail on what they say rather than on what a fixture says.
const fs = require('fs');
const path = require('path');

const WEB_DIR = path.resolve(__dirname, '..');
const failures = [];
const check = (label, cond) => { if (!cond) failures.push('FAIL: ' + label); };

// Strip // line comments and /* */ blocks before matching, so a commented
// -out example cannot pass or fail a rule. (sw.test.js learned this the
// hard way: a commented SHELL_FILES entry read as cached.)
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

const pages = fs.readdirSync(WEB_DIR).filter(f => f.endsWith('.html'));
const routed = [];

for (const file of pages) {
  const raw = fs.readFileSync(path.join(WEB_DIR, file), 'utf8');
  if (!/<script src="shared-history\.js">/.test(raw)) continue;
  routed.push(file);
  const src = stripComments(raw);

  // Exactly one router per page. Two would register two popstate
  // listeners and fight over the same param.
  const calls = (src.match(/wireHistoryRoute\s*\(/g) || []).length;
  check(file + ': calls wireHistoryRoute() exactly once (found ' + calls + ')', calls === 1);

  // THE PILOT'S BUG. Every back affordance must go through the router, so
  // the URL and the screen can never disagree. A bare load*()/showList()
  // here renders the right thing and leaves the URL lying.
  // Accepted: route.navToList itself, or a named function this same file
  // defines as a one-line delegate to it (notas.html keeps `backToList`
  // because its shells and detail header already reference that name).
  // `wireNav(null)` / `wireNav()` is the list screen, which has no back
  // button in the DOM at all — not a back target, so not a violation.
  const delegates = new Set(['route.navToList']);
  for (const m of src.matchAll(
      /function\s+([A-Za-z0-9_]+)\s*\(\s*\)\s*\{\s*route\.navToList\(\s*\)\s*;?\s*\}/g)) {
    delegates.add(m[1]);
  }
  const okBack = (name) => delegates.has(name);

  for (const m of src.matchAll(/backAction:\s*([A-Za-z0-9_.]+)/g)) {
    check(file + ': backAction goes through the router, not ' + m[1], okBack(m[1]));
  }
  for (const m of src.matchAll(/wireNav\(\s*([A-Za-z0-9_.]*)\s*\)/g)) {
    const name = m[1];
    if (name === '' || name === 'null') continue;
    check(file + ': wireNav() back target goes through the router, not ' + name,
      okBack(name));
  }

  // A routed page must not still erase its own route param on load — that
  // is the replaceState the router exists to replace. Pages are allowed
  // other replaceState calls for params the router does NOT own (e.g.
  // produtos.html's ?new=), so this checks the router's own param only.
  const param = (src.match(/wireHistoryRoute\(\{[\s\S]*?param:\s*"([a-z]+)"/) || [])[1];
  check(file + ': names the param it routes on', !!param);
  if (param) {
    const erases = new RegExp(
      'get\\(\\s*"' + param + '"\\s*\\)[\\s\\S]{0,200}?history\\.replaceState');
    check(file + ': no longer reads ?' + param + '= just to replaceState it away',
      !erases.test(src));
  }
}

// A guard on the guard: if the detection regex ever stops matching (a
// changed script tag, a renamed file), every rule above silently passes on
// an empty set. Assert the sweep actually found the pages it should.
check('the sweep found the routed pages (found ' + routed.length + ')', routed.length >= 9);

console.log('routed pages checked: ' + routed.join(', '));
console.log('--- failures ---');
console.log(failures.length ? failures.join('\n') : '(none)');
process.exit(failures.length ? 1 : 0);
