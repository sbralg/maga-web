# CLAUDE.md — maga-web

Context file for Claude Code / Claude sessions working on this repo.

> Renamed 2026-08-31 in the `cowork-*` → `maga-*` big-bang (umbrella:
> **Magá Assistant**; `RENAME.md` in the `maga-api` repo has the full plan).
> **In the dated `## Status` entries below, `maga-api` / `maga-web` /
> `maga-infra` were swept in by that rename — when those entries were written
> the names were `checklist-api` / `cowork-checklist` /
> `cowork-assistant-backend`.**

## Status (2026-09-19): phase 4 — `index.html`'s five busiest tiles gain a live stat line

Continuation of the app audit past phase 3. This page's own header comment
has said since it was built that a quick per-module summary is "a
reasonable next step once there's something worth summarizing" — phase 3
and the rest of the audit gave every module something worth summarizing,
so this is that. Backend half (the new `dashboard_summary` action) is
`maga-api`'s own CLAUDE.md entry, PR
[#40](https://github.com/sbralg/maga-api/pull/40) — **merged and
redeployed to both maga-dev and maga-prod the same day**, at the user's
explicit "redeploy". `index.html` would have degraded cleanly either way
(see below), but the live stats are now genuinely live.

- **Five tiles, not all fourteen**: `tarefas`, `compras`, `eventos`,
  `estoque`, `financeiro` — the modules that accumulate state day to day.
  Reference catalogues (`insumos`/`receitas`/`produtos`/`fornecedores`/
  `clientes`) and `notas` have no single number that means "needs
  attention", so they stay plain navigation, same as always.
- **Two-phase render, deliberately non-blocking**: `render()` paints the
  full tile grid exactly as before (fast, no data dependency), then calls
  the new `loadStats()`, which fetches `dashboard_summary` and patches a
  `<p class="tile-stat" hidden>` placeholder per relevant tile once it
  answers — `data-page` attributes on each `<a class="tile">` are what
  `setStat()` uses to find the right one. A landing page never waits on a
  network round trip just to become navigable.
- **A stat can carry `.warn`** (`var(--danger)`, matching the despesas-row
  convention already established on `financeiro.html`): tarefas' overdue
  count, estoque's out-of-stock count, and a negative financeiro saldo all
  set it; a plain pending/open/in-progress count does not — a shopping
  list with items on it isn't an alarm, but a bill overdue or a shelf
  actually empty is.
- **Failure is silent and total on purpose, except for one case.**
  `loadStats()` is the one `api()` call in the app deliberately NOT routed
  through `handleAuthError`'s generic branch (which replaces `#root` with
  a full error+retry screen) — right for a page whose only content IS the
  data it fetched, wrong for a decorative line on five otherwise-complete
  nav tiles. An expired session (`err.unauthorized`) still bounces to
  login like any other call; a network hiccup, or a 400 "bad action" from
  an older `maga-api` deploy that predates this action, still just leaves
  all five tiles as plain navigation, same as before this phase shipped —
  no longer the live path since PR #40 deployed, but still the correct
  behavior if a future rollback or a stale cached deploy ever puts this
  page ahead of the backend again.
- **`fmtMoney`/`shared-format.js` newly loaded on this page** — the saldo
  stat is the first thing `index.html` has ever needed to format as
  currency. A small local `ddmm()` renders the next event's date as
  `DD/MM` from the raw `YYYY-MM-DD` string with no `Date` object involved
  at all, sidestepping the UTC-midnight-vs-America/Sao_Paulo off-by-one
  shift `eventos.html`'s own `fmtEventDate` comment already documents.
- **New `test/index.test.js`** (this page's first automated coverage —
  it had none before, being pure navigation with nothing to assert against)
  covers both the happy path (all five stats render with the right text
  and the right two carry `.warn`) and the degraded path (a mocked 400
  "bad action" — the actual pre-deploy shape — leaves every tile a working
  link, no error screen, no stray dialog, no console error beyond the
  expected failed-request log). The happy-path scenario uses a manually-
  released gate on the mocked route rather than a fixed delay, so the
  "starts hidden, then fills in" assertion is deterministic regardless of
  this sandbox's unpredictable Playwright↔Chromium round-trip latency —
  see [[feedback_sandbox_playwright_raf]]. Run via that same monkeypatch
  workaround, green across 3 runs.
- **Still open, unchanged**: no schema/backend badge shows a despesa's
  "came from a shopping list" origin on `financeiro.html` itself; phase 5
  (a final test/tidy pass) is next and not yet scoped in detail.

## Status (2026-09-18, phase 3 revision): "Limpar comprados" folded into "Confirmar compra" and removed; the button restyled

Same-day follow-up after the entry directly below. Two pieces of user
feedback from actually using the shipped feature: (1) a purchase that's
already been posted to stock/Financeiro has nothing left to do sitting in
the shopping list, so Confirmar should just clear those rows itself
rather than needing a second "Limpar comprados" tap; (2) the button
should look like a real action, not a muted text link. Backend half
(`shopping_confirm_purchase` now deletes what it processes) is
`maga-api`'s own CLAUDE.md entry — **merged and redeployed to both
maga-dev and maga-prod the same day**.

- **`#clear-purchased-btn` and its whole click handler are gone.**
  `#confirm-purchase-btn` is now `class="primary small"` (was `.link`) —
  matching the solid-button convention `notas.html`'s "+ Caderno" already
  uses for its primary add action, not the muted-link styling that made
  sense when this was a low-stakes bulk-tidy action rather than the thing
  that posts real money to Financeiro. `.clear-row .danger` dropped from
  the page's `<style>` block too — dead CSS once nothing in that row uses
  `.danger` any more.
- **The confirm handler now removes rows itself**, driven by the server's
  `res.removed_ids` (never re-deleting client-side, never assuming every
  purchased id it sent actually got cleared) — same DOM-removal/empty-
  state/`recomputeTotals()` shape Limpar's old handler had, just triggered
  from one API round trip instead of an N-call loop. The toast now reads
  "X itens confirmados e removidos" as the headline, with the same
  sem-preço/sem-código breakdown notes as before.
- **`test/compras.test.js` updated to match**: the confirm scenario now
  asserts the row is GONE after confirming (previously asserted it
  survived, back when Confirmar and Limpar were separate). Verified
  against the real file via the [[feedback_sandbox_playwright_raf]]
  monkeypatch — clean on run 1, only the suite's known pre-existing
  lens-autopick flakiness seen on repeat runs.

## Status (2026-09-18, phase 3): "Confirmar compra" — checking off a shopping item can finally become real pantry stock and a real despesa

First item of phase 3 (the plan's own "still open" list, carried since
phase 0/1). Backend half (`shopping_confirm_purchase`, the idempotency
migration) is `maga-api`'s own CLAUDE.md entry, written on branch
`claude/audit-phase3-confirmar-compra` — **merged and redeployed to both
maga-dev and maga-prod in a follow-up session the same day**, at the
user's explicit instruction ("Update supabase, both projects"), matching
`maga-api`'s own gotcha #20/[[feedback_edge_function_deploy]] convention
of never redeploying proactively.

- **New `#confirm-purchase-btn` ("✅ Confirmar compra")** in
  `compras.html`'s items screen, sitting beside "🗑 Limpar comprados" in
  `.clear-row` and sharing its exact visibility rule (hidden until at
  least one row is checked off — `updateClearButton()` now toggles both,
  renamed in spirit if not in name). **Deliberately a separate button,
  not folded into Limpar** — Confirmar posts to stock/Financeiro and never
  deletes a row; Limpar tidies the list and never touches stock/Financeiro.
  The two compose in either order: confirm then clear, or clear stragglers
  first and confirm what's left.
- Clicking it counts how many checked rows actually carry a barcode (only
  those can feed stock — a hand-typed row has no insumo behind it, same
  limitation the row's own muted camera icon already signals) and confirms
  with a wording that names both counts before calling
  `shopping_confirm_purchase`. The result toast reports how many were
  lançados, how many moved stock with no despesa (no price was ever typed),
  and how many were skipped outright (no barcode) — three different
  outcomes, three different phrases, rather than one bare success/fail.
  **Safe to click more than once**: the server upserts by row, so a repeat
  click (or a click after editing a still-checked row's price) updates the
  same movement/lançamento in place instead of double-posting — see
  `maga-api`'s entry for the two new unique indexes that make that true at
  the database level, not just in this page's intent.
- **Verified against the real, committed `test/compras.test.js`** — the
  mock route gained a `shopping_confirm_purchase` branch (and, along the
  way, a genuine pre-existing gap was found and fixed: the mock's generic
  `shopping_item_update` fallback never persisted a bare
  `{purchased: true}` patch onto its own fake state, so `state.items`
  silently disagreed with what the page showed on screen — every other
  test in this file happened to check the *rendered row*, not
  `state.items`, so nothing had ever caught it before this session needed
  the server-side mock to know which rows were actually in the cart). New
  assertions (button visibility, the confirm dialog's wording, the toast,
  that the row and its checked state survive the call) pass clean across
  3 runs of the real file via the [[feedback_sandbox_playwright_raf]]
  monkeypatch; the file's pre-existing lens-autopick flakiness (confirmed
  unrelated — reproduces identically against the untouched file) is the
  only noise seen.

## Status (2026-09-17, phase 2c): insumo categories removed, error detail surfaces everywhere, delete refusals get consistent, financeiro gains cross-links, and "Usado em" finally answers where a thing is used

Phase 2c of the audit, all on `maga-api`'s `claude/audit-2c-insumo-categories`
branch (PR [#37](../../maga-api/pull/37), **merged and redeployed to both
projects in a follow-up session** — see "Process notes" and that repo's
own 2026-09-17-later entry) paired with `maga-web` commits
`d200a06`..`f549b7d` pushed straight to `main` as each went green, per this
repo's own convention. Front end + backend both changed this phase, unlike
2b — every item here needed a `maga-api` change; two needed a live schema
migration (already applied to both `maga-dev`/`maga-prod`, verified zero
rows before dropping anything).

### 1. Insumo Categories removed entirely — not deferred, not staged, just gone

Raised mid-session as a design question, not originally in the plan: *"I
wonder if that makes any sense. We already have ingredients... I'm not sure
how it would ever be used in the system."* Audited every consumer before
agreeing: no filter chip (only `kind` gets one), no badge on the catalogue
row, no recipe/costing/shopping-list logic ever read `category_id` — the
2026-08-24 design comment's own claim ("purely organizational") was true in
a way that meant it never actually organized anything. `select count(*)
from insumo_categories` / `insumos where category_id is not null` came back
**zero on both `maga-dev` and `maga-prod`** — never used even once — so this
was a straight `DROP TABLE`/`DROP COLUMN` migration
(`20260917190000_drop_insumo_categories.sql`), not the keep-dead-first
staging the five frozen `notes` columns used (that case had real backfilled
data to protect; this one had nothing to lose). `insumos.html` loses the
"🏷️ Categorias" modal and the category `<select>` in `insumoEditModal`
(now `(p, opts)`, not `(p, categories, opts)`) — the whole feature phase 2b
had *just* wired a caller for a session earlier.

### 2. Dead `shopping_item_rename` action removed

Zero callers anywhere in `maga-web` (grepped every `*.html`) —
`shopping_item_update`'s `"name" in body` branch has fully covered a rename
since it shipped, with strictly more validation than the dedicated action
ever had.

### 3. Backend error detail surfaces in ~72 generic "Não foi possível" messages

Every `maga-api` error string is raw, English, developer-facing —
`"invalid net_qty"`, `"unknown cliente"`, `"id required"` (sampled ~50
unique ones) — never written for a Portuguese-speaking end user, so this
does **not** replace the existing message with the raw string. It appends
it as parenthetical diagnostic text, guarded on `e.body && e.body.error`
(silently absent on a network failure or any non-JSON error body):
`"Não foi possível salvar" + (e.body && e.body.error ? " (" + e.body.error
+ ")" : "")`. Touches 13 pages. Left completely alone: every
`e.unauthorized` branch, and every catch that already builds a *specific*
structured message from `e.body` (the six delete-refusal flows below,
`receita_item_add`'s cyclic-reference detection, `ingredientes.html`'s
duplicate-name field error) — those already do better than a raw
parenthetical, though a few (`receita_delete`'s fallback branch,
`receita_item_add`'s fallback branch, `eventos.html`'s shared
`itemSaveErrorMsg()`) got the parenthetical appended to their own
*remaining* generic branch, on top of what they already did.
`preferencias.html` was **skipped entirely** — it already surfaces detail
via `e.message` from its own MCP-layer wrapper functions (`changePassword()`
etc.), a different backend than `shared-api.js`'s `api()`, where `e.body`
isn't even the right shape.

Two sites (`hoje.html`, `tarefas.html`'s own daily-summary error states)
route the message through `innerHTML` via `renderShell()`, so those got
`esc()` on the appended text; every `listToast()` site didn't need it
(`.textContent`, not `innerHTML` — confirmed by reading `listToast()`
itself before assuming).

### 4. Delete-refusal protocols unified — three shapes down to one, deliberately keeping the one real exception

Audited all six "delete something other things reference" actions and
found three different shapes where there should have been one:
- **`evento`/`insumo`/`fornecedor`/`notebook_delete`** — already
  consistent with each other: refuse with real counts, confirm, retry with
  `force:true`.
- **`cliente_delete`** — deleted unconditionally, reported
  `eventos_unlinked` only *after* the fact. No warning. The one real
  inconsistency.
- **`produto_delete`** — deleted unconditionally and reported nothing at
  all.

`cliente_delete` now matches `fornecedor_delete`'s exact shape (the closest
analog — `eventos`↔`cliente` is the same relationship as `produtos`/
`movements`↔`fornecedor`). `produto_delete` now reports
`evento_itens_unlinked` (informational only, not a new refusal gate —
`evento_itens.produto_id` is `ON DELETE SET NULL` and a line's own
`description`/`unit_cost`/`unit_price` survive fully intact either way, so
there was never anything worth blocking on).

**Deliberately NOT touched: `ingredient_delete`/`receita_delete`'s hard
block (400, no force, ever).** That's a different, genuinely correct
semantic, not a fourth inconsistent shape — both FKs
(`produto_embalagens.ingredient_id`, `receita_itens.ingredient_id`) are `ON
DELETE RESTRICT` at the schema level, so a force option literally cannot
work without either cascading (silently destroying recipe lines) or nulling
a `NOT NULL` column. Unifying the *code shape* across all six would have
papered over that real difference.

### 5. Financeiro cross-links — no schema change needed for either direction

The plan's own note ("blocked on a missing backend field") turned out to be
stale on inspection: `financeiro_lancamentos.evento_id` already existed,
unused by any filter; `eventos.cliente_id` already existed, making the
cliente direction a one-extra-query join, not a new column.
`financeiro_lancamentos` gained `evento_id`/`cliente_id` filters;
`eventos.html`/`clientes.html` gained a "💰 Ver no Financeiro" link in
`.detail-actions`. `financeiro.html` already rendered a "🔗 evento" link
*back* to an evento (`entryRowHtml()`) and already had a `?id=` deep link
that opens one entry's edit modal — per its own code comment, these were
*"what the evento and cliente cross-links point at"*, built ahead of time
and never connected. `?evento_id=`/`?cliente_id=` are read at load, kept in
the URL (unlike `?id=`, which is stripped after opening its modal once —
this is a persistent filtered *view*, so reload/back-forward should keep
showing it), and shown as a "Filtrado por evento/cliente · Ver tudo"
banner. The evento name in the banner comes from the already-embedded
`evento:eventos(id,name)` on the first returned row, not a second round
trip; a cliente filter has no such embed (a lançamento doesn't carry a
cliente directly), so that banner stays generic.

### 6. "Usado em" (B7) — named reference lists, not counts, and a proactive read path

Closes the plan's own long-standing note: *"`ingredient_delete` returns
counts only, `receita_delete` returns names but only as a 400 refusal, and
no read action carries reverse references."*

- `ingredient_delete`'s refusal now returns `used_by_receitas`/
  `used_by_produtos` (names, via a new `ingredientUsage()` helper) instead
  of bare `receita_itens`/`produto_embalagens` counts — parity with
  `receita_delete`'s existing shape, which already named its blockers.
- New `ingredient_usage` action (`{id} -> {receitas, produtos}`) — same
  query, callable without attempting a delete. `ingredientes.html` gains a
  new "Usado em" card, **lazy-fetched only when a detail sheet opens** — a
  separate round trip on purpose, since `receita_itens`/`produto_embalagens`
  aren't part of the `ingredients`/`insumos` data this page already has
  loaded, and fetching them for every row in the list would cost far more
  than it's worth.
- `receita_detail` now also returns `used_by_receitas`/`used_by_produtos`
  (via a new `receitaUsage()` helper, extracted from `receita_delete`'s own
  query so both share one implementation) — **no new read action needed**,
  since `receita_detail` already round-trips on every page open.
  `receitas.html` shows only the `used_by_receitas` direction (which
  *other* recipe uses this one as a sub-receita) — deliberately **not**
  `used_by_produtos`, since which produto this receita is Produto Final of
  is already shown, with a working link, by the Categoria section right
  below it. Repeating it would be the same fact twice.

Both pages' delete-refusal dialogs updated to the new named-list shape —
`ingredientes.html`'s now reads the same way `receitas.html`'s always has
("está em uso por: X, Y").

### Process notes

**`maga-api`'s PR #37 was merged and redeployed to both projects in a
follow-up session** (the user's explicit request: "use [the Supabase CLI]
to redeploy and perform the required changes in supabase for both
environments"), after this session's own work ended with it still open —
per that repo's own gotcha #20, redeploy is always the user's own call, and
that session was the user making it. The schema migration (item 1's `DROP
TABLE`/`DROP COLUMN`) had already been applied live to both `maga-dev` and
`maga-prod` back in *this* session — a migration and an Edge Function
redeploy are independent steps in this project's own convention, so the
follow-up session's redeploy needed no further schema change, just the
code. Verified live (auth-gate only — no path to the real `CHECKLIST_PASS`
in-session, which is correct per that repo's NO SECRETS framing, not a
gap) and merged after, matching that repo's own established
deploy-then-merge precedent. Full detail: `maga-api/CLAUDE.md`'s
2026-09-17-later entry. The PR also folds in `maga-api`'s previously-loose
`15f9834` ("Record audit phase 0 in CLAUDE.md") commit, cherry-picked
cleanly — it sat on the old, already-merged
`claude/app-audit-improvements-n54adl` branch and never reached that repo's
`main`.

**Two items from 2b's own "Still open" note turned out to be stale**, caught
by re-reading the actual current code instead of trusting the carried-over
description: `compras.html`'s "four full-screen reloads" don't exist — every
mutation path (add/delete/edit/scan/merge/clear) already patches the DOM in
place, most likely from phase 0's own earlier work. And the financeiro
cross-links' "missing backend field" wasn't actually missing (see item 5).
Worth remembering for future phases: a plan document's own language is a
starting point to verify, not a fact to build from unchecked.

**Same standing environment limitation as phase 2b, but this session got
further**: headless Chromium's `requestAnimationFrame` still never fires in
this sandbox (confirmed again — `env-scope.test.js` needed a fresh `npx
playwright install chromium` this session, and even with a byte-correct
binary, a minimal rAF repro still times out). Unlike 2b, this session
**did** get real Playwright runs, by additionally monkeypatching
`page.waitForSelector` (default to `state:'attached'`, skipping the
rAF-blocked visibility/stability computation), `page.click` (`force:true`),
`page.waitForFunction` (`polling:100`, a real-timer interval instead of the
rAF-based default), and `page.screenshot` (a couple of test files' own final
debug screenshot call hangs on Playwright's internal "wait for fonts to
load" check, which is itself rAF-driven — stubbed to a no-op since the
image isn't needed for a pass/fail read). Applied to copies of
`clientes`/`produtos`/`financeiro`/`eventos`/`receitas`/`ingredientes`/
`notas`/`hoje`/`fornecedores.test.js` (9 of the 13 touched pages) — all
genuinely green, zero failures, zero JS errors, run for real through the
actual committed test files (not a throwaway driver script, unlike 2b).
`ingredientes.test.js` needed a real fix first (see item 6) and, once
fixed, passed clean too. `tarefas.test.js`/`stock.test.js` hit a **different,
confirmed-unrelated** hang — `shared-menu.js`'s hamburger-drawer-open
animation calls `requestAnimationFrame` directly
(`requestAnimationFrame(() => requestAnimationFrame(() => panel.classList
.add("open")))`), so `.menu-panel.open` never appears no matter what the
test harness's own waits are patched to do. That's the same sandbox
limitation showing up at the *application* level, not just Playwright's
internal one — no test-harness patch can fix it, since the app code itself
is waiting on a browser API that this sandbox's Chromium never services.
Not fixed, not worked around — flagged for a session with a real browser.

`ingredientes.test.js`'s fix surfaced one more thing, confirmed **not**
caused by this session: after the delete-refusal/"Usado em" assertions all
pass clean, a *later*, unrelated step in that same test (`#back` after
editing a freshly-created ingredient's unit, then re-opening a different
row) hangs with a fully blank page body and zero JS errors. Verified this
is pre-existing by disabling the new "Usado em" fetch entirely and
reproducing the identical hang — `git log` shows only this session's two
commits ever touched `ingredientes.html`, and neither touches the
list/routing code anywhere near this path. Never previously reachable in
this sandbox (earlier assertions always failed first), so never actually
verified passing by any session, ever, here. Flagged, not chased further —
out of scope for this phase.

### Still open

**Phases 3–5 unchanged**: the "Confirmar compra" loop (shopping → stock →
auto-post despesa to Financeiro), a live dashboard, and a final test/tidy
pass. Not yet scoped in detail.

**New, from this phase's own findings**: `tarefas.test.js`/`stock.test.js`'s
rAF-at-the-application-level hang (see Process notes) needs a session with
a working Chromium to actually investigate — this sandbox categorically
cannot service it. `ingredientes.test.js`'s later, unrelated hang
(also Process notes) likewise. Neither blocks anything — both are
test-environment findings, not known app bugs.



Phase 2b of the audit (`65fa16e`, `98b5655`, `bdf6777`, `e2c3405`), the plan
for which was committed and read from `PLAN-2b.md` (now deleted — its
content is this entry). Pushed straight to `main` as each of the four
commits went green, per this repo's own convention. **Front-end only: no
`maga-api` change, no migration, no redeploy** — every action used here was
already live.

### 1. `+ Novo insumo` — a synthetic in-store EAN-13

An insumo could previously only come into existence by scanning a real
barcode, so bulk flour, loose produce, anything sold unbarcoded was simply
uncreatable — and a new user who opened Insumos first had no way forward at
all. `gtinCheckDigit(lead)`/`synthGtin()` land in `shared-inputs.js` — one
shared copy of the GS1 mod-10 weights; `compras.html`'s `gtinCheckDigitOk()`
now delegates to `gtinCheckDigit()` instead of keeping its own copy.
`synthGtin()` generates a 13-digit code in GS1's restricted-circulation
range (prefix `"2"`, reserved for store-internal codes — a real retail
barcode can never collide), verified with a bounded retry against the
in-memory catalogue before insert (a collision would otherwise silently
**overwrite** an existing insumo via `insumo_upsert`'s upsert-on-conflict).
`insumos.html` gets a `+ Novo insumo` button reusing `insumoEditModal()` as-
is — it now takes an `opts.title`/`opts.note` pair rather than being forked.
`test/shared-inputs.test.js` is new: a browser-free unit test (Node's `vm`,
same shape as `css-tokens.test.js`) asserting `gtinCheckDigit()` against
known-good real EAN-13/UPC-A codes and asserting every `synthGtin()` output
is a valid 13-digit `"2"`-prefixed code.

### 2. Category management

`insumo_category_rename`/`_delete` had been live and deployed for weeks with
no caller — a category could be created inline from the insumo edit modal
and then never fixed or removed. New `🏷️ Categorias` control on the
catalogue screen opens a manage modal (list → rename/remove per row, plus
create) — one modal, not a new page or route. Every row shows its kind
badge (`ingrediente`/`embalagem`), since categories are themselves typed and
a bare name list would render two different "Doces" as duplicates. Deleting
a category **unlinks** insumos rather than blocking, matching what
`insumo_category_delete` already does server-side; the confirm states the
affected count up front, read from the catalogue already in memory rather
than a second round trip. `categoryCache` is invalidated on every rename/
create/delete, so the insumo edit modal never offers a stale category.

### 3. "Adicionar à lista de compras" (B3) — the shopping list stops being an island

Two mechanisms, because the two sources carry genuinely different things:

- **From `estoque.html` and `insumos.html` — a real barcode.**
  `shopping_item_scan` with `remote:false`, the merge-aware path: adding the
  same insumo twice increments the existing row instead of duplicating it,
  resolved locally with no Open Food Facts round trip.
- **From `receitas.html` — an ingredient, no barcode.**
  `shopping_item_add` with `name` + `net_text` (the line's own quantity +
  `base_unit`, e.g. `"450 g"`), per-ingredient-line and as `🛒 Adicionar
  todos` for the whole recipe at once — deliberately uses the recipe's OWN
  written quantity, never a batch-scaled one (the scale field only affects
  what's shown; piggybacking a second meaning onto it would surprise the
  moment someone scales the view just to look, not to shop).
  `shopping_item_add` has no merge/dedup by name (only `shopping_item_scan`
  merges, by gtin), so re-adding an already-listed ingredient makes a second
  row — a known, accepted limitation, not fixed here. `Adicionar todos`
  reports partial failure honestly (e.g. `"2 de 3 adicionados — 1 falhou"`)
  rather than a blanket success toast.

New `shared-shopping.js`/`.css`: `shoppingListPickerModal()`, the "which
list?" find-or-create picker all three pages share (same shape as
`shared-catalog.js`'s `ingredientModal()`), kept **separate** from
`shared-catalog.css` since that file is documented as estoque/insumos-only
and `receitas.html` is one of this picker's three callers. Remembers the
last-used list in `localStorage` under a `maga_`-prefixed key (gotcha E9)
and sorts it first on reopen, so adding several items in one visit doesn't
mean re-picking the list every time.

**`estoque.html`'s placement took a real measurement, not a guess:** a 40px
`icon-btn` as a 4th row cluster (alongside the thumbnail and the qty
stepper) squeezed the product-name column down to ~60px and broke words
mid-word at 360px — screenshotted, confirmed, reverted. The action lives
INSIDE `.body` instead, as a wrapping text link on its own line (same
`stopPropagation` treatment the row's existing ingredient chip already
needs, since both sit inside the row's own tap target) — costs the row no
width at all.

`sw.js`: `shared-shopping.js`/`.css` added to `SHELL_FILES`, `CACHE_NAME`
v5 → v6 (`test/sw.test.js` exists specifically to catch this class of miss
— see its own header comment).

### 4. Search on compras/tarefas/financeiro (B11), and "Limpar comprados" (B12)

Three search boxes, all following the established fold-accents-both-sides
pattern (`clientes.html`'s `matchesSearch()`/`foldSearchText()`):

- **`financeiro.html` and `tarefas.html` were nearly free** — both already
  computed a filtered array from an existing predicate (`render()`/
  `redraw()`'s `tipoFilter`, and `render()`/`redrawPendingCard()`'s
  star-sort respectively), so search is one more term on that same
  predicate. `tarefas.html`'s search filters the pending card only; the
  done-tasks section (its own separate lazy-load/pagination mechanism) is
  untouched, per the plan's own explicit call.
- **`compras.html` is the one that must NOT re-render.** Item rows carry
  deep per-row wiring (checkbox, qty stepper, scan-merge, edit modal)
  attached individually as each row is created, never from an array —
  re-rendering the card would silently drop all of it. Filtering toggles
  `row.hidden` instead; `rowForGtin()` reads the `items` **array**, not the
  DOM, so the scanner's merge logic is unaffected by what's currently
  hidden. **Totals stay unfiltered** (`recomputeTotals()` reads `items`,
  not what's visible) — a search box must not appear to change what the
  trip costs.

**"Limpar comprados"** (`compras.html` only — there is no bulk-delete
action, so this is N × `shopping_item_delete`): shown only when at least
one item is purchased (the lesson of audit C13's permanently half-visible
bulk-complete bar — verified both ways: visible with purchased items
present, hidden once none remain); `confirmModal` names the count first;
removes each row as its own call succeeds and leaves the rest on screen
otherwise (verified with a simulated single-item failure: the other row is
removed, the failing one survives, and the toast reads `"1 de 2 removidos —
1 falhou"` rather than claiming success); recomputes totals after.
Deliberately does **not** route a failure through `handleAuthError` unless
`e.unauthorized` — that exact over-reach was phase 0's A5 bug on this same
page.

### Process notes

**Three of the four commits were built directly in this session** (deep,
already-loaded context on the files involved made that faster than
re-briefing a fresh agent); **commit 4's two simpler, well-isolated pieces**
(the `financeiro.html` and `tarefas.html` search boxes) **were built by two
Sonnet subagents running in parallel**, each scoped to exactly one file with
the target pattern spelled out, then **independently re-verified here** —
syntax-checked fresh and driven through a real browser against a mocked
API, not trusted from their own reports. Both came back clean; one
subagent's hand-back correctly flagged that a second file
(`financeiro.html`) showed as modified in `git status` mid-run — a true
observation (the other subagent's own concurrent, legitimate edit), not a
bug, but exactly the kind of "a subagent contradicting an assumption is
data" signal worth surfacing rather than silently discarding.

**A standing environment limitation surfaced and worked around, not fixed:**
this session's sandbox headless Chromium never fires
`requestAnimationFrame` at all (confirmed with a minimal `<button>` repro
with zero page code involved, and confirmed as pre-existing/environment-
wide — not caused by any change here — by reproducing the identical hang
against the untouched pre-2b `main`). Playwright's own actionability waits
(`.click()`'s stability check, `.waitForFunction()`'s default rAF-based
polling) depend on that signal and hang indefinitely without it, which
means **the real `test/*.test.js` Playwright suite could not be run to
completion in this session** — every UI-driving test file timed out on its
first real click, on both branches, independent of anything this work
changed. What verification actually happened instead, for all four commits:
(1) every changed file's inline `<script>` block re-parsed with
`new Function()` after every edit; (2) `test/shared-inputs.test.js` and the
other browser-free static tests (`css-tokens`, `history-wiring`, `sw`) ran
for real and are genuinely green; (3) every interactive flow (the new-insumo
save, category rename/create/delete, both shopping-list-add mechanisms
including the merge-not-duplicate case, both search boxes, and
`Limpar comprados` including its partial-failure path) was driven end-to-end
in a real headless-Chromium page against a mocked `maga-api`, using
`{force:true}` clicks (which skip only the pixel-stability wait, not the
click itself) and real-timer `waitForTimeout` in place of the broken
rAF-based waits — genuine behavioural coverage, just not through the
committed test files, and not a substitute for the next session (with a
working Chromium) actually running `test/*.test.js` for real. **Geometry
(`scrollWidth === innerWidth` at 360px/390px) was measured for every new
element** (the estoque.html row change, the categories modal, the receitas
row/heading additions, the compras search/clear-row) using this same
working-but-limited harness — those numbers are trustworthy regardless of
the rAF issue, since they read layout directly rather than waiting on it.
**Next session with a working local Chromium should run the full suite for
real** before trusting "20/20" again; this session cannot make that claim.

### Still open

**2c — error surfacing and in-place updates, needs a `maga-api`
redeploy**: show `e.body.error` in the ~67 generic "Não foi possível"
messages; convert `compras.html`'s four full-screen reloads now that phase
0 made those handlers return rows; unify the three delete-refusal
protocols; delete the dead `shopping_item_rename`; the two financeiro
cross-links (evento/cliente → lançamento, blocked on a missing backend
field); "Usado em" (B7, surfacing the reference lists the delete handlers
already compute — needs a backend field, see `PLAN-2b.md`'s reasoning,
preserved here since that file is now gone: `ingredient_delete` returns
counts only, `receita_delete` returns names but only as a 400 refusal, and
no read action carries reverse references); and folding in `maga-api`'s
loose `15f9834` ("Record audit phase 0 in CLAUDE.md") commit, which sits on
`claude/app-audit-improvements-n54adl` in that repo but not on that repo's
own `main` — that repo keeps PRs, so it needs one opened, and 2c is already
getting a redeploy.

**Phases 3–5 unchanged**: the "Confirmar compra" loop, the live dashboard,
and the test/tidy pass.

## Status (2026-09-17, phase 2a): the URL becomes the source of truth — hardware Back works, detail screens are linkable, and list rows/chips are real controls

Phase 2a of the audit (`96a9328`, `3f3c474`, `09eada4`), pushed straight to
`main` — back to this repo's own convention after the deliberate PR exception
phase 0/1 used. The user's reason for reverting to it is worth recording: a
navigation change has to be *felt* on the phone, and the PR made the previous
phase invisible there until merge. **Phase 2 was split into 2a/2b/2c at the
user's call** — as written it was ten items across ~15 files, roughly phase 0
and phase 1 combined. 2b and 2c are listed at the bottom.

### The bug underneath all of it

Every detail page carried the same four lines at the top of its `load*()`:
read `?id=`, `history.replaceState()` to **erase** it, open the detail, return.
Eight pages did this. Erasing the URL is what made the app's two worst
navigation faults: **the Android hardware Back button left the PWA from any
detail screen** (nothing ever pushed an entry to go back to), and **a detail
screen could not be bookmarked, shared or returned to**. The worst case was
`compras.html` — the one screen used standing in a supermarket aisle — which
had no deep link at all; a list opened purely in memory.

### `shared-history.js` (new)

`wireHistoryRoute({param, openDetail, renderList})` returns
`routeFromUrl`/`navToDetail`/`navToList`/`routeNotFound` and registers one
`popstate` listener. Ten pages use it. Three decisions carry weight:

- **Re-rendering the detail you are already on replaces rather than pushes.**
  Saving an edit calls `open*()` again to redraw; without this, Back would
  land on an identical entry and appear to do nothing.
- **Back does not re-fetch synchronously.** That would put a "Carregando…"
  flash on the most common gesture in the app — the exact thing phase 1
  removed everywhere else — and cost a round trip in an aisle. `showList()`
  paints from memory and `refreshList()` reconciles in the background,
  repainting only if the payload actually moved **and** the URL still has no
  id (a fast Back-then-tap can open a detail while the refresh is in flight).
  `listLoaded`, not `array.length`, is the cache flag: an account with
  genuinely zero records must not read as a cache miss and re-fetch forever.
- **One treatment for a stale id** (a bookmark to a record deleted from
  another device): say so, show the list, and **clean the URL** — leaving the
  bad `?id=` in place repeats the error on every reload.

New deep links: **`compras.html?list=`**, **`hoje.html?date=`** (which also
makes each day a history entry, so Back steps back a day), and a one-shot
`?id=` into the edit modal on `tarefas`/`financeiro`. Those two have no detail
*screen*, only a modal over the list, so the param is consumed once and
cleaned off rather than reopening the modal on every later re-render.

**`estoque.html` is deliberately the exception** — it has no detail screen of
its own (its rows navigate to `insumos.html`), so it loads no router and only
stops erasing its own `?gtin=`.

### Rows, chips and headings become what they were pretending to be

Phase 1 shipped `:focus-visible` rings onto elements that could not receive
focus at all; this is the pass that fixes the reachability, exactly as that
entry said it would.

- **List rows are `<button type="button" class="row">`**, with the button
  reset in `shared-page.css`. **`<button>` takes phrasing content**, so a
  row's children are `<span>`s — a `<p>` or `<div>` in there is invalid and
  gets reparented. **A row containing its own controls can never be a
  button**: `compras.html`'s list *opener* is the button instead, and
  `estoque.html`'s opener keeps `role="button"` + `tabindex` + an Enter/Space
  handler and its own focus ring.
- **Filter chips are `<button>`s with `aria-pressed`** mirroring `.active`.
  Where a handler toggles `.active` in place (the pay-method and
  lançamento-tipo chips inside modals) it sets `aria-pressed` too — **an ARIA
  state that goes stale is worse than none**, the same objection the audit
  raised against `preferencias.html`'s half-built tab pattern. The four
  byte-identical page-local `.chip` blocks moved into `shared-page.css`;
  `financeiro` keeps its own tighter `.chiprow` margin, which is a real
  difference (it stacks a second filter row) rather than drift.
- **The detail title stops being click-to-edit.** It was a `<h2>` with
  `cursor:pointer` on six pages. A heading cannot be focused and is not
  announced as actionable — and five of the six already had an "✎ Editar"
  button doing the identical thing. `eventos.html` was the one page with **no
  edit button at all** (audit C7) and gained "✎ Renomear"; that rename had
  never been tested, because clicking the heading was the only way to reach
  it.
- **`tarefas.html`'s `.row` no longer inherits `cursor:pointer`** — the
  cosmetic regression phase 1 left explicitly for this pass. Closed.

### Cross-links (B6), and the one that could not be done here

A produto's receita/fornecedor and a fornecedor's purchased insumos rendered
as **dead text although the ids — and the gtin — were already in the
payload**; reaching them meant going out to the menu and searching by name.
Now real `<a href>`s (so middle-click and open-in-new-tab work), with the
invisible `::after` hit-area expansion phase 1 introduced. **The evento- and
cliente-to-financeiro links are NOT done**: unlike these, `evento_detail`
does not return a lançamento id per payment row, so they need a backend
field, not a front-end change.

### Two new test files, and why a static one earns its place

**`test/history-wiring.test.js` reads the source rather than driving a
browser, and it exists because the pilot's own bug was invisible to every
per-page suite.** The back *button* called `showList()` — which renders the
list but never touches the URL — while hardware Back went through the router,
so the two disagreed about which screen you were on. The symptom was remote
from the cause: the background refresh silently stopped repainting, because
it correctly saw an id still in the URL. **Clicking `#back` looked right.**
Several pages' suites never click a list row at all, so they would not have
noticed either. The guard was confirmed to fail against a deliberately
reintroduced copy of that bug before being trusted.

**`test/history.test.js`** measures behaviour: Back, Forward, the subheader
button agreeing with hardware Back, a cold deep link keeping its id, a stale
id, Tab+Enter reaching a row, the compras deep link, and
`scrollWidth === innerWidth` at 360px and 390px — a button's default width is
shrink-to-fit, and `width:100%` is only safe because `box-sizing:border-box`
is global in `shared-base.css`.

**20/20 test files exit 0** (18 before). One assertion was inverted, correctly:
`stock.test.js` expected `?gtin=` to have been erased. The param surviving is
the point.

### Process note

Three Sonnet subagents did the page edits, partitioned by file ownership so no
two touched the same file; every claim was re-verified here by exit code. Two
of them independently flagged the same real gap — list-row navigation had no
direct coverage on their pages — which is what prompted the static wiring
test. **A subagent contradicting or extending an assumption is data**, the
lesson phase 1 paid for.

### Still open

**2b — new capabilities**: `+ Novo insumo` (an insumo can only exist by
scanning a barcode, so bulk flour is uncreatable) **via a synthetic EAN-13 in
the GS1 restricted-circulation range, prefix `2`** — the range reserved for
store-internal codes, decided with the user; no schema change, and a real
barcode can never collide. Plus category CRUD (`insumo_category_rename`/
`_delete` still have no caller), "Adicionar à lista de compras" from estoque/
insumos/receitas (the shopping list is still an island), "Usado em" surfacing
the reference lists the delete handlers already compute, search on compras/
tarefas/financeiro, and "limpar comprados".

**2c — error surfacing and in-place updates, needs a `maga-api` redeploy**:
show `e.body.error` in the ~67 generic "Não foi possível" messages; convert
`compras.html`'s four full-screen reloads now that phase 0 made those handlers
return rows; unify the three delete-refusal protocols; delete the dead
`shopping_item_rename`; and the two financeiro cross-links above.

**Phases 3–5 unchanged**: the "Confirmar compra" loop, the live dashboard, and
the test/tidy pass.

## Status (2026-09-17, after everything below): an app-wide audit — phase 0's real bugs, then phase 1: shared page chrome, one error system, and an accessibility foundation

Direct ask: *"Make an extensive check of the application. Look for areas of
improvement... Also check for visual design and UI improvements. This app was
built incrementally and may be missing best practices or not be consistent
across all pages."* The audit read all three repos, ran the then-15-file suite
green as a baseline, and captured real screenshots of 14 screens at 390px
rather than inferring the visual layer. Nothing it found was a regression —
it was ten weeks of accumulated drift, which is exactly what an app that grew
one page at a time collects. The full finding list (A1–A17 bugs, B1–B15
missing paths, C1–C18 visual/consistency, D1–D6 accessibility, E1–E12 code
quality) and phases 2–5 live in the session plan file,
`make-an-extensive-check-toasty-whistle.md`; the open items that matter are
restated at the bottom of this entry so they survive that file being lost.

Shipped as two PRs rather than straight to `main` — **a deliberate override of
this repo's own convention**, at the user's request, so the whole thing could
be reverted in one move. The cost was real and worth recording: a 15-page
visual refactor was invisible on their phone until merge, which is precisely
why the no-PR rule exists here. `maga-api`'s half is `338790c` (PR #36),
merged and **redeployed by the user**.

### Phase 0 (`ae56718`) — real bugs, no refactor

- **`sw.js` had never cached `assets/logo-badge.svg`** — the header brand mark
  on all 15 pages, the login screen and the drawer. Offline, every page
  rendered logo-less, and had since the logo was introduced. Also missing:
  `shared-pwa.js` (loaded by all 15 pages), `assets/avatar-maga.webp`,
  `oauth.html`.
- **`CACHE_NAME` had never been bumped**, across five separate commits that
  changed `SHELL_FILES`. The purge in `activate` deletes caches whose name
  differs from `CACHE_NAME`, so with a constant name **it never ran once** —
  entries for deleted files (`shopping.html`) were still being served.
  Bumped v1 → v4 across this work.
- **The durable lesson, and why this went unnoticed for months: `install`
  swallows a failed `cache.add` by design**, so this entire class of bug is
  silent — no console error, no failed load, just a stale or incomplete
  offline shell. That is what **new `test/sw.test.js`** exists for: it walks
  the real pages, extracts everything they reference, and fails on anything
  `SHELL_FILES` misses. It strips `//` comments first, or a commented-out
  entry reads as cached.
- **`notas.html`'s `searchHits()` cached `[]` on failure** — a network error,
  a 401 and "no notes" all rendered identically, the 401 never reached
  `handleAuthError`, and the cached `[]` short-circuited every later
  keystroke, so one transient failure disabled cross-notebook search for the
  page's life. Now distinguishes failure from empty and rethrows on
  `e.unauthorized`. Also added `invalidateNotesCache()` (wired to
  `window.onNotesChanged`) — writing a note then searching for it used to
  find nothing until a reload — and a `renderListSeq` guard so a slow render
  can't overwrite a newer one that started while it was awaiting.
- **`logoutMcpSession()` never cleared `maga_prefs_cache`.** After "trocar de
  conta", `preferencias.html` rendered the *previous person's* WhatsApp
  allow-list, roster, timezone and context — and since that cache is read
  offline-first, with the jump host asleep there was no refresh coming to
  correct it. Same class as the 2026-09-09 stale-cache bug two entries down.
- **`--ok` was referenced and never defined** (`preferencias.html`'s
  `.resolved.ok`), so every success state rendered in the danger/brand red.
  Now a real token — **`#15803d`, deliberately not `#16a34a`**: that lighter
  green measures 3.30:1 on `--card` and fails WCAG AA at the 11–14px sizes
  this is actually used at; `#15803d` clears 4.5:1. **New
  `test/css-tokens.test.js`** fails on any `var(--token)` that resolves to
  nothing, and checks every light token is redefined for dark.
- `compras.html` called `handleAuthError` for non-auth failures too, wiping
  the whole screen for one failed row; `hoje.html`'s TRIAGEM card rendered
  `0 e-mails — — ruído, — com ação` when counts were absent (em-dashes as
  missing-value placeholders); the five unescaped `emoji` interpolations got
  `esc()`; `shared-menu.js` got a `typeof CURRENT_PAGE` guard — a missing
  declaration throws inside `openMenu()` before any markup is built, so the
  hamburger silently does nothing, **which has now shipped twice**.

### Phase 1 (`030991f`, `607b950`, `d3b5089`, `a51fb71`, `c480fad`, `30fcec0`, `8b63062`)

- **`shared-page.css` (new)** — the page chrome that was duplicated across 15
  `<style>` blocks: `body` padding, `.wrap`, `header`, `.hleft`, `h1`, `h3`,
  `.subheader`, `#back`, `.searchrow`, `.detail-actions`, the `.row` shell,
  `.row-actions`, `.addrow-btn`. **`.row`'s flex layout stayed page-local on
  purpose** — it genuinely differs per page, and merging it would have been
  the "looks similar, isn't the same thing" trap this file already warns
  about. `.wrap` carries `width:100%`, which is the 2026-09-01 overflow fix
  generalised rather than re-derived.
- **`shared-nav.js` (new)** — one `navHeader(title, opts)` + `wireNav()`
  replacing 11 and 9 hand-written copies whose signature had already drifted
  four ways (`(title,back)`, `(title,back,emoji)`, `(title,back,icon)`,
  `(title)`). `opts` is `{backLabel, backAction, titleClass, icon,
  listTitle}`; the seven `.cli-title`/`.evt-title`/`.rec-title`… classes
  collapse to one `.detail-title`.
- **`shared-produto-panel.css` (new)** — the shared produto panel shipped no
  stylesheet at all, so its classes were copy-pasted into both hosts and had
  already diverged. **The load-bearing detail: `.item-row` means two
  different things** — the panel's embalagem rows on `produtos.html`, and
  `receitas.html`'s own ingredient lines. Extracting it naively would have
  silently restyled the recipe list, so the shared rules are scoped under
  `#pp-emb-list` (which also makes them win regardless of `<style>` load
  order) and receitas keeps its own.
- **One error system.** `shared-ui.js` gained `fieldError(inputEl, message)` /
  `clearFieldError(inputEl)` (inline validation with `aria-invalid` +
  `aria-describedby`, auto-clearing on the next input) — the ten separate
  copies of `alert("O nome não pode ficar vazio.")` become one mechanism that
  puts the message under the field that caused it. Transient failures go to
  `listToast(msg, true)`. **52 native `alert()` calls at the start, zero
  now.**
- **An accessibility foundation, inherited rather than retrofitted.** New
  `openModal(html, opts)` in `shared-ui.js` carries `role="dialog"`,
  `aria-modal`, `aria-labelledby`, a focus trap, focus restore and a scroll
  lock; `confirmModal`/`promptModal` route through it **at unchanged
  signatures**, so every existing call site inherits all of it for free.
  `listToast()` gained `role="status"` + `aria-live="polite"`.
  `:focus-visible` rings landed across the shared sheets — the codebase had
  **zero** focus rules before this, and several custom buttons actively
  suppress the UA outline.
  - **The hit-area technique worth reusing**: `.link` and friends sit in
    baseline-aligned flex rows, so growing the box would shift layout. An
    invisible `::after{position:absolute;inset:-10px -8px}` expands the
    *effective* target without moving a pixel — and `test/a11y.test.js`
    probes it with `elementFromPoint`, not by reading a class.
- **The header stops flashing on load.** Every page's `load()` did
  `root.innerHTML = 'Carregando…'`, so list→detail was: header vanishes, one
  centred line, header reappears. `preferencias.html` already documented the
  fix and — found while applying it — **didn't actually do the thing it was
  cited for**: it rendered the shell on its four early-return branches but
  not around its own happy-path round trip, so it still flashed in exactly
  the window its comment claims to close. Now all of them render the shell
  first. Verified with a harness that samples the DOM during load and
  confirms both directions: clean now, and catching the flash at +31–47ms
  against the stashed originals.

### Measured outcomes, not adjectives

**18/18 test files exit 0.** `scrollWidth === innerWidth` on all 15 pages at
both 360px and 390px, with a header present on every one. Zero native
`alert()` calls (52 before). Zero bare header-wipes on load. Page-local
`<style>` went 1355 → 1204 lines while shared CSS went 361 → 550 — the point
being that the shared growth is one copy of what used to be fifteen.

### Three visible changes that are not pure refactor

Called out so a later session doesn't read them as regressions: `header`'s
bottom margin tightened 8px on `tarefas.html`/`hoje.html` (they were the
outliers against thirteen pages); `.subheader` (16px) and `.searchrow` (14px)
standardised on eventos/produtos/receitas; `--ok` moved as described above.

### Deliberately left, and why

- **`tarefas.html`'s `.row` now inherits `cursor:pointer`** from the shared
  row shell although only `.rowbody` is clickable. Cosmetic, and it belongs
  with the pass that makes rows real buttons rather than a special-case
  override now.
- **The new focus rings land on elements that are still not keyboard
  reachable** — list rows are `<div>` + click handler on 9 pages, every
  filter chip is a `<span>`, 7 detail titles are click-to-edit `<h2>`s. The
  rings are correct and the reachability is the next phase's first item;
  shipping the rings first is not an oversight.

### Two findings checked and dropped rather than shipped

- **A7** (`.wrap` overflow on `hoje.html`/`index.html`, by analogy to the
  2026-09-01 `tarefas.html` bug) **did not reproduce** — measured
  `scrollWidth === innerWidth` at 360px; both already carried the
  `width:100%` fix.
- **A9** (insumos' missing `.detail-actions` bottom margin) **is documented
  in this very file as deliberate** — it sits inside a `.card.pad` whose next
  block has its own divider. The audit had flagged it from the pattern, not
  the reason.

### The process lesson, in the same spirit as this file's CSS-bug entries

**A real `compras.test.js` failure sat through four commits because
verification grepped stdout for `/^FAIL/`** — and `compras.test.js` is the
only one of the suite whose `check()` pushes a bare label instead of
`'FAIL: ' + label`. It printed its failures, exited 1, and the harness
reported green. The failure itself was small (phase 0 renamed
`scan_camera_id` → `maga_scan_camera_id` and missed three references in the
test); the blindness was not. **The exit code is the signal, not the
output** — fixed in `1032c51`, along with that file's reporting. Two
independent Sonnet agents reported the failure and were overridden both
times: a subagent contradicting an assumption is data, not noise.

Two pre-existing flakes were also diagnosed and fixed while here:
`notas.test.js` (~15%, waited on `.notes-card`, which `openNotebook()`
renders synchronously while `wireNotesPanel()` fills it from a separate round
trip — 2/12 failures before, 0/15 after) and `fornecedores.test.js` (~50%, a
`page.url()` read racing `produtos.html`'s own `history.replaceState()` —
0/6 after).

### Still open — phase 2 onward, deferred at the user's request

Restated here so they survive the plan file: **keyboard reachability** (rows
as real buttons, chips as `<button>`, an explicit edit affordance on the 7
`<h2>` titles); **a visual-weight pass** (the notes "+ Adicionar" is
`class="primary"` — full-width crimson — and out-shouts every real action on
the 8 pages embedding it; the produto pricing card is a flat wall of 7 numbers
with the retail price no louder than a 5-centavo packaging cost; the dashboard
is 3.6 screens of pure navigation); **the back button** (no page calls
`pushState`, and 8 actively `replaceState` the URL away, so hardware Back
exits the PWA from any detail screen); **deep links** (`?id=` on compras — the
one screen used standing in a supermarket aisle — plus tarefas and
financeiro); **dead cross-links** where the id is already in the payload
(produto → receita/fornecedor, fornecedor → insumo, evento → financeiro);
**category CRUD and "+ Novo insumo"** (`insumo_category_rename`/`_delete` have
no caller at all, and an insumo can only exist by scanning a barcode — bulk
flour is uncreatable); **the "Confirmar compra" loop** (ticking a shopping
item writes a price and nothing else — no stock movement, no despesa — so no
expense ever reaches Financeiro automatically and fornecedor purchase history
is empty by construction); and **a live dashboard**.

## Status (2026-09-17, absolute latest): the notebook's icon now shows to the left of its name in the notebook-detail header

Direct follow-up on the entry right below: now that a user-created
notebook can actually carry a custom emoji, nothing on the page a person
lands on after opening one showed it — only the list row did.

- **`navHeader()` gained an optional third `icon` parameter**, rendered
  as a `<span class="nb-icon">` inside a new `<span class="nb-title-wrap">`
  wrapping it and the existing `<h2 class="nb-title">` — mirroring
  `compras.html`'s own `.list-title`/`emojiBtn` pattern for the same
  "icon beside the name" shape. `.subheader`'s right side is still one
  flex item (the wrap), so the existing right-alignment is unchanged.
- **`openNotebook()` computes the icon with the exact same fallback chain
  as the list row/search-hit icons** (`KIND_ICON[info.kind]` for an
  object-backed notebook, `info.icon || "🗒️"` for a user-created one)
  and passes it through — no new logic, just reusing the rule that
  already existed for the list.
- New assertion in `test/notas.test.js` confirms a custom emoji set on
  create shows up in the header (`.nb-title-wrap`) once the notebook is
  open. Full 16-file suite green.
- **Already deployed** — pushed straight to `main`.

## Status (2026-09-17, newest): notas.html's default icon changed to 🗒️; user-created notebooks can now carry a custom emoji, like a shopping list

Two direct asks. The 📓 icon (closed book) read wrong for a running notes
app; 🗒️ (spiral notepad) is the more literal fit and is now used
everywhere a notebook falls back to a default icon. Separately, a
user-created notebook could only ever show that same default icon — no
per-notebook identity the way `compras.html`'s shopping lists already
have (an emoji field, settable on create and editable later).

- **`shared-menu.js`'s Notas menu entry, and both default-icon fallbacks
  in `notas.html`** (the notebook-list row and the search-hit row)
  changed from `📓` to `🗒️`. Object-backed notebooks are unaffected —
  they already render `KIND_ICON` (👤/🥂/🏷️/etc.), never this fallback.
- **`firstGrapheme()`/`limitToOneEmoji()` moved from `compras.html` into
  `shared-inputs.js`** — compras.html's shopping-list emoji field was the
  only consumer until now; notas.html needing the exact same "truncate an
  emoji `<input>` to one grapheme cluster, compound emoji included"
  behavior made it a real shared function per this repo's own rule (2+
  consumers, identical behavior), not a page-local duplicate.
- **notas.html's "+ Novo caderno" full-width button became an inline
  add row** (`.emoji` + name `<input>`s + a small "+ Caderno" button),
  the same shape as `compras.html`'s own list-creation row — replacing
  the old `promptModal()`-based name-only flow. `notebook_create` already
  accepted an optional `emoji` field server-side (`maga-api`'s
  `domains/notas.ts`), so this needed no backend change.
- **The user-created notebook's "✎ Renomear" button became "✎ Editar"**,
  opening a new `openNotebookEditModal()` — name AND emoji in one modal,
  saved as up to two parallel calls (`notebook_rename` +
  `notebook_set_emoji`, only the ones that actually changed), mirroring
  `compras.html`'s `openListEditModal()` almost line for line. An
  object-backed notebook still never gets this control — its name/emoji
  follow its object, exactly as `notebook_rename`/`notebook_set_emoji`
  already refuse otherwise server-side.
- **The notebook row's icon already read `nb.emoji` when set** (this
  existed before today, just previously unreachable since nothing could
  ever set a custom emoji) — a custom emoji now actually shows up as the
  row's icon the moment one is set, no rendering change needed there.
- `test/notas.test.js` updated throughout (new add-row selectors, the new
  edit modal, a fake `notebook_set_emoji` handler, and new assertions
  that a custom emoji set on create is stored and rendered, and that
  editing changes it). Full 16-file suite green.
- **Already deployed** — pushed straight to `main`.

## Status (2026-09-17, latest of all): tarefas.html's ⭐ and notas.html's ⭐ now match — same unselected size, same selected glyph

Direct ask, comparing the two "star" affordances the app now has side by
side: tarefas.html's important-star (`.star-btn`) and notas.html's
pin-star (`.note-pin`, `shared-notes.js`) had drifted to look like two
different controls — different unselected sizes, and a different
selected glyph (tarefas used a styled `★` text glyph, notas used the
`⭐` color emoji).

- **Unselected (`☆`) size unified at 21px** — `shared-notes.css` gained
  `.note-pin{font-size:21px}`, overriding the generic `.icon-btn` default
  of 17px it was inheriting, to match `tarefas.html`'s own
  `.star-btn{font-size:21px}`.
- **Selected glyph unified on `⭐` (the color emoji), not `★` (a styled
  text glyph)** — `tarefas.html`'s important-star now renders `⭐`
  instead of `★`, matching notas.html's pin exactly. This also means
  `.star-btn.important`'s old `color:#eab308;font-weight:900;
  -webkit-text-stroke:0.8px currentColor` rule was dead weight and
  removed: a color emoji bakes in its own palette and ignores `color`/
  `font-weight`/stroke entirely (the same class of bug as the 📅
  calendar-icon gotcha elsewhere in this file) — that styling only ever
  did anything back when the glyph was the plain-text `★`.
- `test/tarefas.test.js`'s glyph assertion updated from `'★'` to `'⭐'`.
  Full 16-file suite green.
- **Already deployed** — pushed straight to `main`.

## Status (2026-09-17, even later): "Anotações"/"Anotação" renamed to "Notas"/"Nota" everywhere; the section heading loses its icon; notas.html's own notebook view drops the now-duplicate heading

Direct feedback on the entry right below, from a screenshot of an open
user-created notebook: the page's own top header already reads
"Anotações" (now "Notas"), and the just-added section `<h3>` directly
underneath it repeated the exact same word — a real duplicate, not two
different things that happen to share a name, since on `notas.html` the
whole page IS that one notebook already.

- **Every user-facing "Anotações"/"Anotação" (and lowercase) renamed to
  "Notas"/"Nota"** — the menu entry and dashboard tile label
  (`shared-menu.js`'s `MENU_ITEMS`, kept its own 📓 emoji, that's the nav
  icon, untouched), `index.html`'s tile description, `notas.html`'s page
  `<title>`/`apple-mobile-web-app-title`/login screen copy/every in-page
  heading and message, and every string in `shared-notes.js` (the empty-
  state message, both modals' titles/labels, every toast/confirm
  wording). A few English file-comment mentions on `clientes.html`/
  `fornecedores.html` updated too, for consistency.
- **The section `<h3>` on the seven object detail pages lost its 📓 icon**
  — now plain `<h3>Notas</h3>`, matching the plain-text `<h3>Eventos</h3>`/
  `<h3>Pagamentos</h3>` headings right above it on `clientes.html` (which
  never carried an icon either).
- **`notas.html`'s own notebook-detail view (`openNotebook()`) no longer
  renders this heading at all** — the seven OTHER consumers keep it (a
  cliente/evento/etc.'s own page has no other "Notas" label on screen, so
  the heading is the only cue), but `notas.html`'s top header already
  says "Notas" for every screen this page renders, including an open
  notebook — a second "Notas" directly under "Renomear"/"Remover" added
  nothing. `notesPanelHtml()` itself is unchanged; this is purely the one
  page-local call site that stopped prepending the heading.
- **Historical dated entries in this file were deliberately left saying
  "Anotações"** — same standing convention as every prior rename here
  (see the 2026-08-31 big-bang note at the top): they describe the app as
  it was when written.
- `test/env-scope.test.js`/`test/clientes.test.js`/`test/notas.test.js`
  updated to match the new copy. Full 16-file suite green.
- **Already deployed** — pushed straight to `main`.

## Status (2026-09-17, latest): the shared notes panel gets a "📓 Anotações" heading, and "+ Adicionar" moves below the note list

Two more direct polish requests, from a screenshot comparing the notes
panel against the WhatsApp/Eventos/Pagamentos sections right above it on
`clientes.html`: every other section on these detail pages has its own
`<h3>` heading, and the notes panel was the one exception — a bare card
with no title. Separately, "+ Adicionar" sitting above an (often
initially empty, then growing) note list read oddly once notes existed —
the button belongs after what it's adding to.

- **`<h3>📓 Anotações</h3>` added before the `.notes-card` div** in all
  eight consumers of `shared-notes.js` — `clientes.html`, `eventos.html`,
  `produtos.html`, `receitas.html`, `fornecedores.html`, `insumos.html`,
  `ingredientes.html`, and `notas.html`'s own notebook-detail view —
  matching the exact `<h3>` pattern the WhatsApp/Eventos/Pagamentos
  sections already use on `clientes.html`. Page-local markup, not part of
  `shared-notes.js` itself, since the heading sits outside the panel's own
  container and each page already builds its own surrounding HTML.
- **`notesPanelHtml()` reordered**: the note list now renders first, the
  "+ Adicionar" button after it. `shared-notes.css`'s `.note-add-btn`
  margin flipped from `0 0 16px` (space below, when it was on top) to
  `16px 0 0` (space above, now that it's on the bottom).
- Full 16-file suite green.
- **Already deployed** — pushed straight to `main`.

## Status (2026-09-17, later): notas.html's default list now shows only user-created notebooks — object-backed ones surface via search, not the front page

Direct feedback, discussed before building: as notes accumulate across
every object detail page (clientes/eventos/produtos/receitas/
fornecedores/ingredientes/insumos), the "Anotações" landing list would
otherwise fill with entries nobody came here looking for — a cliente's
notebook belongs on `clientes.html`, not competing for space with the
user's own general-purpose notebooks. Agreed approach (option 1 of two
discussed): filter the default view only; leave search untouched.

- **`renderList()`'s no-search branch now filters `notebooks` to
  `!notebookInfo(nb).kind`** (i.e. no object FK set — a user-created
  notebook) before rendering `#nb-card`. Nothing is hidden outright:
  `notes_all`-backed global search still reaches every note across every
  notebook, object-backed included, exactly as before — this only changes
  what's listed with an EMPTY search box.
- **Opening an object-backed notebook still works two ways**: through a
  search hit (already worked), or a direct `?id=` link from the object's
  own detail page (the `load()` function's `wanted` check already reads
  against the full, unfiltered `notebooks` array — untouched by this
  change).
- **The empty-state copy rewritten** from "Nenhum caderno ainda... aparecem
  aqui automaticamente" (no longer true) to "Nenhum caderno seu ainda...
  continuam na página do próprio objeto — busque aqui para encontrá-las".
- **`test/notas.test.js` reworked**: the old "only the notebook WITH a note
  is listed" case (testing the SERVER-side filter — an empty object-backed
  notebook never lists) now additionally confirms NEITHER a with-notes NOR
  an empty object-backed notebook shows in the default view, and opens the
  with-notes one via a direct `?id=` navigation instead of clicking a row
  that no longer exists there. New coverage: a freshly created user-made
  notebook DOES appear in the default list with its note count, right
  after creation.
- Full 17-file suite green.
- **Already deployed** — pushed straight to `main`.

## Status (2026-09-17): notas.html — the back link no longer wraps on a long object name, and "Ver X" is now a button in the same right-aligned row as Renomear/Remover

Two more direct polish requests on the notebook-detail view.

- **The back link ("← Cadernos") could wrap onto two lines** when the
  object's own name was long enough to push the flex `.subheader` row's
  other child (the back button) below its natural width — `.subheader`
  has `min-width:0` so its children can shrink, and the button had
  nothing stopping it from shrinking. Fixed with `#back{flex:none;
  white-space:nowrap}`, so the title (which already wraps via
  `.nb-title{word-wrap:break-word}`) is the only side allowed to grow
  taller.
- **"Ver X →" (the link back to an object-backed notebook's own record)
  is now a real button**, sharing the `.detail-actions` row (right-
  aligned, below the title) and the same `primary small alt` styling as
  Renomear — previously a plain `<p class="obj-link">` link sitting above
  the card, visually disconnected from the button row. New `a.primary`
  rule in `shared-base.css` (alongside the existing `button.primary`) is
  what makes a real `<a href>` look like a button — kept as a genuine
  link rather than a button+onclick fake-navigation, so middle-click/
  keyboard/etc. all still work. No other element uses `class="primary"`
  today, so this stays scoped to the two tags that need it rather than a
  blanket `.primary` selector.
  - **They never actually appear together**: an object-backed notebook
    never has Renomear/Remover, and a user-created one never has "Ver
    X" — so in practice this row only ever shows one or the other, never
    both side by side. Built to share one row/style regardless, in case
    that ever changes.
- `test/notas.test.js`'s two `.obj-link`-selector assertions updated to
  `.detail-actions a`. Full 17-file suite green.
- **Already deployed** — pushed straight to `main`.

## Status (2026-09-16, latest): notes panel simplified to a single "+ Adicionar" button, opening a modal instead of always-visible fields; two notas.html polish requests

Direct feedback on the shared notes panel (`shared-notes.js`, dropped into
all eight places it appears — the seven object detail pages plus
`notas.html`'s own notebook view): when a notebook is open, show only
"+ Adicionar"; drop the "📓 Anotações" heading and the always-visible
title/body fields, and open a note by clicking the button instead.
Two follow-up polish requests on `notas.html` specifically landed the
same session.

- **`notesPanelHtml()`** now renders just `<button class="note-add-btn">+
  Adicionar</button>` plus the note list — no heading, no inline
  `<input>`/`<textarea>`. `shared-notes.css`'s now-dead
  `.note-add`/`.note-add-title`/`.note-add-body` rules were removed; the
  button gets a plain `.note-add-btn{margin:0 0 16px}` for spacing before
  the list.
- **New `noteAddModal()`** in `shared-notes.js`, the same modal shell as
  the existing `noteEditModal()` (title/body fields, Cancelar/Salvar) but
  with no "Remover" button — there's nothing to remove yet for a note that
  doesn't exist. `wireNotesPanel()`'s `add()` now opens this modal on the
  button click and posts `note_create` with whatever it resolves, instead
  of reading two always-present form fields.
- **Applies to all eight consumers**, since this is the one shared
  component — not scoped to `notas.html` alone. All 8 existing add-note
  test assertions (in `clientes.test.js`/`eventos.test.js`/
  `fornecedores.test.js`/`ingredientes.test.js`/`notas.test.js`/
  `produtos.test.js`/`receitas.test.js`/`stock.test.js`) updated from
  filling `.note-add-body` directly to clicking `.note-add-btn`, waiting
  for `#note-new-body`, filling it, and clicking `#note-new-save`.
- **`notas.html` polish, same session**: the back link out of an open
  notebook now reads "← Cadernos" (was "← Anotações" — confusing next to
  the page's own "Anotações" header just above it). `.detail-actions`
  (the Renomear/Remover row on a user-created notebook) gained
  `justify-content:flex-end`, so those two buttons sit right-aligned
  under the notebook's name instead of left-aligned under the back link —
  this page-local style only, no other page shares this exact class
  content.
- Full 17-file suite green (`for t in test/*.test.js; do node "$t"; done`).
- **Already deployed** — pushed straight to `main`.

## Status (2026-09-16, even later): real bug — the edit-note modal's textarea was unstyled, rendering tiny and monospace

Reported directly with a screenshot: the "Anotação" textarea in the edit
modal looked much smaller than the "Título" field right above it, in a
different (monospace) font.

- **Root cause: `shared-modal.css` had never had a `textarea` rule at
  all** — only `.modal-card input[type=text]:not(.num-input)` was styled.
  `noteEditModal()`'s `#note-edit-body` (`shared-notes.js`) is the first
  `<textarea>` any modal in this app has ever used, so it fell straight
  through to the browser's UA-agent default: a small intrinsic width (the
  default `cols`) and a monospace font, instead of matching the text input
  next to it.
- **Fix: new `.modal-card textarea` rule**, mirroring the existing text-
  input rule (full width, same font/padding/border-radius) plus
  `resize:vertical;min-height:120px` so a longer note has room without the
  box needing to be dragged open first.
- **New regression assertion in `test/notas.test.js`**: opens a note's
  edit modal and compares `#note-edit-title`'s and `#note-edit-body`'s
  computed widths via `getBoundingClientRect()` — a class-name-only check
  could not have caught this (the textarea gets no special class, it's
  purely a missing element-selector rule), so this measures actual layout,
  the same lesson this file's CSS-bug entries already carry (the icon-btn
  hit-target entry, the calendar-icon `color`-vs-`filter` entry). Confirmed
  it fails against the pre-fix CSS first (`git stash` just
  `shared-modal.css`, re-run: `172.9px` vs `324.9px`) before trusting it.
- Full 17-file suite green.
- **Already deployed** — pushed straight to `main`.

## Status (2026-09-16, later): Anotações folded into "Dia a dia"; a real bug — its hamburger button was dead on arrival

Direct feedback on the entry directly below, same day: a standalone
"Anotações" menu section for one item was more ceremony than the page
warranted, and — a real, separate bug — tapping the hamburger button on
`notas.html` itself did nothing.

- **`shared-menu.js`**: the `notas` entry's `group` moved from `anotacoes`
  to `dia`, and the now-empty `anotacoes` key dropped from `MENU_GROUPS`.
  `ENV_GATED_GROUPS` shrank back to just `Set(["dia"])` — Anotações stays
  exactly as env-gated as before, since it now inherits `dia`'s own gating
  rather than carrying its own entry in the set. `index.html`'s
  `GROUP_HINT.anotacoes` line removed to match (no orphaned heading text
  for a group that no longer renders).
- **The hamburger bug, found while touching the file**: every other page
  declares `const CURRENT_PAGE = "<page>";` before `shared-menu.js` loads,
  so `openMenu()` can tell the active entry from a link. `notas.html` never
  did — the click handler called `openMenu()`, which threw a
  `ReferenceError` on the undeclared global `CURRENT_PAGE` before it ever
  built the drawer markup, so nothing visibly happened on tap. This is
  **the second time a newly-added page has shipped without this
  declaration** (per the user's own note) — swept every `.html` file
  loading `shared-menu.js` for the same gap; `notas.html` was the only one
  missing it. Fixed with `const CURRENT_PAGE = "notas";`.
- Full 17-file suite green (`for t in test/*.test.js; do node "$t"; done`).
- **Already deployed** — pushed straight to `main`.

## Status (2026-09-16): Notes/Notebooks — a new `notas.html` + `shared-notes.js` panel on all seven object detail pages, env-gated like Hoje/Tarefas

Backend half (`notebooks`/`notes` tables, the new `notas` domain, the
five retired `notes` columns) is in `sbralg/maga-api`'s own CLAUDE.md
entry — this one is the front-end half. Direct ask: notes on an object
should be dated and accumulate, not overwrite a single line, and the
user should also be able to make their OWN notebooks with no object
behind them, in a new menu section sibling to Hoje/Tarefas.

- **New `shared-notes.js`/`shared-notes.css`**: a self-contained notes
  panel — newest-pinned-first list, an always-visible "Nova anotação" box
  (capture has to be one tap), tap a note to edit (title/body, plus a
  "Remover" footer button mirroring `tarefas.html`'s edit-modal shape),
  a ⭐/☆ pin toggle. `wireNotesPanel(container, kind, ref)` resolves or
  lazily creates the object's notebook server-side (`notebook_detail`
  with `{kind, ref}`) — the calling page never handles a notebook id
  directly. `kind === "notebook"` is the one reserved exception, used
  only by `notas.html`: there `ref` IS a notebook id already, since a
  user-created notebook has no `{kind, ref}` of its own.
- **`noteTitle()`**: title is optional server-side, so this derives a
  display title from the first line/words of the body when absent,
  truncating on a whole word rather than mid-word. A row skips repeating
  the body underneath its title when the title IS the whole body (a
  short, single-line, untitled note) — showing the same short string
  twice would just be noise.
- **Dropped into all seven object detail pages** — `clientes.html`,
  `eventos.html`, `produtos.html`, `receitas.html`, `fornecedores.html`,
  `insumos.html` (keyed on `gtin`, not a uuid — the one kind that
  differs), `ingredientes.html` — each adding one `<div class="notes-card">`
  + one `wireNotesPanel(...)` call. **The five pages that had a one-line
  "Notas" field lost it** from both the create/edit dialog and the
  detail-page display: `clientes.html`/`eventos.html`/`fornecedores.html`
  dropped an `<input>`+payload key, `produtos.html`/`receitas.html`
  dropped a closure-tracked `let notes` variable too (per this repo's own
  2026-08-25 lesson that a field living only in a redraw's DOM node gets
  silently discarded — the fix there was tracking it in a variable; the
  fix here is simpler, there's nothing left to track).
- **New `notas.html`**: every notebook — user-created ones always, plus
  object-backed ones with at least one note (server-filtered, so an
  empty object-backed notebook doesn't clutter the list) — sorted by
  the notebook's own `updated_at` (bumped by every note write, so this
  IS "most recently active first"). A global search box folds accents
  the same way every other search box in this app does
  (`foldSearchText()`) and matches across every note's title+body via a
  new `notes_all` action, rendering hits with a link back to their
  notebook. "+ Novo caderno" creates a user notebook by name (no emoji
  picker in v1 — a deliberate scope cut, kept simple since `notebook_create`
  already accepts one server-side if a later pass wants it).
  Opening an object-backed notebook shows a "Ver X →" link into its own
  page (`clientes.html?id=…`, `insumos.html?gtin=…`, etc. — the same
  `?id=` deep-link convention every one of those seven pages already
  supports) instead of rename/delete controls, since an object-backed
  notebook's identity and lifetime both follow its object; a
  user-created notebook gets rename/delete instead (refusal-first with
  a note count, then `force:true`, same shape as every other
  refusal-first delete in this app).
- **New menu section "Anotações"**, a sibling of "Dia a dia" right after
  it in `shared-menu.js`'s `MENU_GROUPS`/`MENU_ITEMS` — one entry,
  `notas.html`, 📓. **Env-gated exactly like Hoje/Tarefas**, per the
  user's explicit instruction: `ENV_GATED_GROUPS` in `shared-menu.js`
  generalizes what used to be a single hardcoded `"dia"` check into a
  `Set`, now covering both groups, so `visibleMenuItems()` drops
  Anotações from the drawer/dashboard on a non-default environment the
  same way it already dropped Hoje/Tarefas — and `notas.html` itself
  carries the same direct-navigation guard those two pages have
  (`isDefaultEnv()` checked right after the passphrase, rendering
  `personalPageBlockedHtml()` and making ZERO API calls when blocked, so
  a bookmark or typed URL can't bypass it). **Deliberately NOT extended
  to the notes PANEL on the seven object detail pages** — a note on a
  cliente is part of that cliente's record, and hiding it while the rest
  of that record (phone, payment history, etc.) still shows through
  would be incoherent; those pages are already env-scoped by construction
  (each environment is its own Supabase project). The gate's real
  meaning is narrower than "notes are private": it keeps the
  cross-cutting notebook view and user-created notebooks out of a
  borrowed environment, not an object's own notes off that object's own
  page.
- **`sw.js`'s `SHELL_FILES`** gained `notas.html`, `shared-notes.js`,
  `shared-notes.css` — without this the PWA offline shell would serve a
  stale cache missing the new page/files.
- **`index.html`**: one `TILE_DESC` entry, one `GROUP_HINT` entry for
  `anotacoes`.
- **New `test/notas.test.js`** (the page's own list/search/user-notebook
  behavior — object-backed notebook mechanics are covered per-object,
  see below) plus a notes-panel case appended to all seven existing
  per-object test files (`clientes.test.js`/`eventos.test.js`/
  `produtos.test.js`/`receitas.test.js`/`fornecedores.test.js`/
  `stock.test.js` for `insumos.html`/`ingredientes.test.js`), each with
  its own minimal `notebooks`/`notes` fake sharing the same shape
  (get-or-create by `{kind, ref}`, matching `maga-api`'s own
  `domains/notas.ts`). **`test/env-scope.test.js` extended** with the
  same blocked/normal-load pair Hoje/Tarefas already had, plus Anotações
  added to the drawer/dashboard-tile assertions in both directions
  (hidden on non-default, present on default). **The five `#cli-notes`/
  `#forn-notes`-style test fields were removed** from
  `clientes.test.js`/`fornecedores.test.js` (the other three never had a
  standalone notes-field assertion). **Full 16-file suite run and green**
  (`for t in test/*.test.js; do node "$t"; done`, Playwright available in
  this session — confirmed on every file, not just the new ones).
- **Not yet deployed** — this repo has no build step, so "deploy" is a
  push to `main`; not done yet, pending review. **Depends on the
  `maga-api` side being migrated + redeployed** (see that repo's own
  entry) — until then every new action 400s, and the panel/`notas.html`
  degrade in words (the same "republish the Edge Function" pattern
  `ingredientes.html` already established) rather than failing silently.

## Status (2026-09-09, even later): `preferencias.html` reorganized into tabs, and `index.html` finally consumes the configured landing page — closing the two cuts phase 3 left open

Direct feedback: the Preferências page had grown too crowded and confusing
as one long scroll (six independent sections, from display name to
Infraestrutura, all stacked on top of each other) — the user asked for
tabs/submenus, and separately asked for the still-unconsumed "Página
inicial" setting (phase 3's own entry above says so explicitly) to be
wired up. Both closed the same session.

- **Seven category tabs** (`Conta`, `WhatsApp`, `E-mail`, `Limites`,
  `Aplicativo`, `Backup`, `Infraestrutura`) replace the single long scroll —
  a horizontally-scrollable pill row, same visual language `insumos.html`'s
  own kind-filter chips already use, plain `hidden` attribute toggling (no
  framework, no routing, matching this repo's conventions). `Aplicativo`
  renders conditionally, same as before — nothing to show for a person with
  no `maga.webEnvironments`. **`E-mail` is a genuinely new tab**, not just a
  relocation: the e-mail allow-list used to sit at the bottom of the
  WhatsApp section (an unrelated field parked there for lack of anywhere
  better), and now has its own tab under its own heading. Every existing
  element id is unchanged — `#f-displayName`, `#groups-box`, `#wa-*`,
  `#mail-*`, `#pw-*`, `#sessions-box`, `[data-env]`, `[data-save]`, etc. —
  this was a layout change, not a rewire.
- **`Infraestrutura` stopped being a collapsed `<details>` and became a
  plain tab** — collapsing it inside an already-collapsed (now hidden by
  default) tab panel was a leftover from when it was the one thing worth
  hiding on an otherwise-flat page; once every section is behind its own
  tab, a nested collapse under it added a click for no reason.
- **`test/preferencias.test.js` updated throughout** (still 129
  assertions, unchanged count — a pure navigation change, not new
  behavior) — every test interacting with a field outside the default
  `Conta` tab now clicks `[data-tab="<id>"]` first. The real gotcha this
  surfaced: Playwright's `waitForSelector` defaults to `state:"visible"`,
  so far more call sites needed a tab-switch than just the obviously
  interactive ones (`click`/`check`/`fill`/`selectOption`) — a plain
  content read (`$eval`, `$$eval`, `textContent`, `getAttribute`) does
  NOT require visibility and needed no change. One test (Adicionar's
  duplicate-refusal check) touches both the WhatsApp and E-mail tabs in
  the same block and switches tabs mid-test accordingly.
- **`index.html` now actually reads `currentEnvPrefs().landingPage`**
  (Preferências → Aplicativo → "Página inicial") instead of always
  showing the dashboard — the one half of phase 3 that entry explicitly
  left unconsumed ("nothing yet reads it to actually change what page an
  account lands on"). `index.html` is where every "go home" link in the
  app points (every page's brand-mark, every error-state "Voltar ao
  início"), so honouring the setting here means those links now genuinely
  go home to wherever the account configured — not a special case bolted
  onto one button.
  - **The one thing this needed that wasn't obvious up front**: without an
    escape hatch, the hamburger drawer's own "Home" entry would point
    right back at whatever landing page it exists to let someone bypass,
    making the tile dashboard itself unreachable the moment a landing page
    other than `"home"` is configured. Fixed with a `?dash=1` query
    param carried ONLY by that one link (`shared-menu.js`'s `MENU_ITEMS`
    "home" entry, `href: "index.html?dash=1"`) — `index.html`'s
    `redirectToLandingPage()` checks for it first and skips the redirect
    when present. Every other link to `index.html` deliberately does NOT
    carry it.
  - `landingPage` values of `null`/`"home"`, or a stale/unknown page key,
    all fall through to the ordinary dashboard render — no dead links, no
    self-redirect loop (the redirect only ever leaves `index.html` for a
    different page; nothing redirects back to it).
  - **New regression tests in `test/env-scope.test.js`** (`seedEnv()`
    gained an optional `landingPage` param): a configured landing page
    redirects `index.html` straight to that page; `landingPage:"home"`
    stays on the dashboard (regression guard for the common, unconfigured
    case); the drawer's Home link carries `?dash=1` and following it lands
    on the real dashboard even with a landing page configured. **Confirmed
    against the pre-fix `index.html`/`shared-menu.js` first** (`git
    stash` just those two files, re-run): the redirect test times out
    waiting for a navigation that never happens — restoring the fix makes
    it pass. `test/hoje.test.js`'s drawer assertion updated to expect the
    new `index.html?dash=1` href on the Home entry.
  - **Deliberately still not done, per the user's own instruction**:
    pricing-default prefills (safety margin, labor rate, the three margin
    tiers) — same cut phase 3's own entry already called out, left for a
    separate pass since it means touching `receitas.html`/`produtos.html`'s
    own creation flows.
- Full 14-file suite green (the same handful of pre-existing, unrelated
  console 404s a few files already logged before this session — not
  caused here, `failures: (none)` on every file either way).
- **Already deployed** — this repo has no build step, pushed straight to
  `main`.

## Status (2026-09-09, later): real bug, reported live within minutes of shipping — a saved "Aplicativo" preference needed a fresh login to actually take effect

Direct report: "I selected Fornecedores to be omitted, but it still shows.
Do I need to logout/login for it to take effect?" The honest answer at
that moment was yes, and it should never have been.

- **Root cause**: `visibleMenuItems()` reads `currentEnvPrefs()`, which
  reads `ENV_CACHE_KEY` (`checklist_envs_cache`) — but that cache is
  written in exactly ONE place, `completeOAuth()`, at login. Saving in
  Preferências updated the server correctly and updated
  `PREFS_CACHE_KEY` (the cache `preferencias.html` itself reads on its
  own next load) — but nothing ever refreshed `ENV_CACHE_KEY`, so the
  menu everywhere else in the app kept reading the pre-save list until
  the next full OAuth login.
- **Fix: new `updateCachedEnvPrefs(envId, effective)` in `shared-api.js`**,
  called from `shared-prefs.js`'s `savePreferenceEnvironmentSection()`
  right after a successful save — patches the matching environment's
  `menuHidden`/`landingPage` directly inside `ENV_CACHE_KEY`, in place.
  Silently a no-op if the cache doesn't exist yet or doesn't know the
  envId (nothing sensible to update; a future real login fixes it
  regardless).
- **New regression test in `test/preferencias.test.js`** (128 → 129):
  seeds `checklist_envs_cache` the way a real login would (no
  `menuHidden` yet — the exact pre-save state the report started from),
  checks Fornecedores, saves, then reads `checklist_envs_cache` back and
  asserts the `dev` entry's `menuHidden` reflects it. **Confirmed against
  the pre-fix code first** (`git stash` the two `shared-*.js` files,
  re-run): fails with exactly `got: undefined`, the same shape as the
  live report — restoring the fix makes it pass. Full 14-file suite
  green.
- **Net effect**: no logout/login needed anymore. Saving now updates the
  menu on this tab's very next render (opening the drawer, or navigating
  to another page) — the same tab, no reload of `preferencias.html`
  itself required either, since the fix runs synchronously inside the
  save handler.
- **Already deployed** — pushed straight to `main`.

## Status (2026-09-09): `preferencias.html` gains an "Aplicativo" section — environment tier (phase 3 of 4)

Front-end half of `maga-infra`'s phase 3 — see that repo's own CLAUDE.md
entry for the backend side (`mergeEnvironment`, the new `PUT
/preferences/environment/:envId/:section` route, `/web-config`'s richer
per-environment shape).

- **New "Aplicativo" section**, one block per `maga.webEnvironment` the
  signed-in account has (Alexandre: dev + prod; Bia: prod only) — a
  disambiguating heading only when there's more than one. Each block: a
  checklist of every page that CAN be hidden from that environment's own
  menu (every `MENU_ITEMS` entry except `home`/`preferencias`, which can
  never be hidden — see below), and a landing-page `<select>` offering
  every page. One "Salvar" per environment, sending TWO scoped PUTs (`menu`
  then `app` — they're separate `ENVIRONMENT_FIELDS` sections
  server-side), never touching a sibling environment's own saved state.
- **`shared-menu.js`'s `visibleMenuItems()` now also drops whatever the
  CURRENT environment's own `menu.hidden` names**, on top of the existing
  "dia" group rule (which is a separate, additional filter — this one
  fires even on the account's own default environment). `home` and
  `preferencias` are hard-excluded client-side too
  (`MENU_ITEMS_NEVER_HIDDEN`), not just left un-offered in the picker's
  checklist — a stale or tampered cache must never be able to strand an
  account with no way back to fix its own menu.
- **`shared-api.js`'s env cache (`ENV_CACHE_KEY`) now carries
  `menuHidden`/`landingPage`/`vapidPublicKey` per environment**, populated
  straight from `/web-config`'s response at login — no second fetch
  anywhere for something this basic. `apiUrl`/`passphrase` stay
  deliberately UNCACHED across the whole list (only the one chosen
  environment's are ever stored), since those are real per-environment
  secrets and these three new fields are not.
- **`shared-push.js`'s `currentVapidPublicKey()` now prefers the
  server-provided key** (from the same cache) **over the hardcoded
  `VAPID_PUBLIC_KEYS` map**, which becomes pure fallback once a real
  deployment sets `vapidPublicKey` on its `webEnvironments` entries.
- **`shared-prefs.js`** gained `savePreferenceEnvironmentSection(envId,
  section, body)`, scoping its localStorage cache update to just that one
  environment's entry inside `prefs.environments` rather than the whole
  cached blob.
- **14 new assertions in `test/preferencias.test.js`** (114 → 128): no
  section renders for a person with no `webEnvironments`; a single
  environment renders with no disambiguating heading and sane defaults;
  two environments each render pre-filled from their OWN already-saved
  state without cross-contamination; saving sends exactly the two expected
  scoped PUTs; saving one environment never touches another's. **9 new
  assertions in `test/env-scope.test.js`**: an environment's own
  `menuHidden` drops a page from both the drawer and the dashboard, on the
  default env (not just the non-default "dia" case the file already
  covered); switching between two environments applies each one's OWN
  hidden list, never leaking the other's; `home`/`preferencias` survive
  even a `menuHidden` list that names them directly. Full 14-file
  regression green.
- **Deliberately not done, matching the backend entry's own cuts**:
  pricing-default prefills (would need `receitas.html`/`produtos.html`
  changes, a separate scope), and the landing-page REDIRECT itself —
  `landingPage` saves and loads correctly, but nothing yet reads it to
  actually change what page an account lands on. Menu-hiding IS live;
  that's the other half of "the front end consuming it" from the plan.
- **Already deployed** — this repo has no build step, pushed straight to
  `main`.

## Status (2026-09-08, later): fixed a real reported bug — the same contact showed up twice in the muted-contacts picker — plus a "sem atividade" reveal for both pickers

Direct feedback on a live screenshot: "my contact is shown as duplicated in
the excluded Users list." Root cause lived on the `maga-infra` side (a
person can have both a phone-number JID and an opaque `@lid` - see that
repo's own CLAUDE.md entry) and is fixed there; this is the front-end half.

- **`chatPickerHtml()` (shared by the groups and contacts pickers) now
  takes a normalised `{jids, label, avgPerDay?}` row shape** - a group
  still only ever has one jid (wrapped into a 1-element array at the
  `groupsHtml()` call site), but a merged 1:1 contact can carry more than
  one. `data-jid` → `data-jids` (comma-joined) on every checkbox;
  `collectSection("whatsapp")` now expands one checked row into one
  `{jid,label}` entry PER jid it represents, so ticking a merged contact
  once mutes every identity they have.
- **New "sem atividade" reveal**: both pickers now render a
  `<details class="reveal"><summary>Mostrar grupos/contatos sem
  atividade</summary>` holding everything the person could ALSO mute but
  hasn't been active in the window - sourced from mcp-server's new
  `otherGroups`/`otherContacts` (see that repo's entry for where those come
  from). Collapsed `<details>` content stays in the DOM, so the existing
  `[data-jids]` query already reaches a row ticked from inside it with no
  extra wiring.
- **8 new assertions in `test/preferencias.test.js`** (93 → 114 across this
  and the prior entry's work): the reveal toggle renders and names itself
  correctly for both boxes, a row ticked from inside the collapsed section
  is still saved, and an end-to-end reproduction of the exact reported bug
  - a two-jid "Alê" fixture rendering as ONE row with a summed rate, saving
  both jids when ticked once. Full 13-file suite green.
- **Already deployed** - this repo has no build step (see its own
  Conventions), pushed straight to `main`.

## Status (2026-09-08): Preferências gains a "Conversas silenciadas" section — muting a specific 1:1 contact, not just a group

Bia asked to mute a specific 1:1 conversation from the daily summary (and
from audio transcription, where it's active) — the existing "Grupos
silenciados" section only ever let her mute a group. The `maga-infra`
side generalized `excludedGroups` into a union of `excludedGroups` +
`excludedUsers` (see that repo's own CLAUDE.md entry) and added a new
`GET /preferences/whatsapp/recent-contacts` endpoint, the 1:1 counterpart
to the existing `/whatsapp/groups`. This is the front-end half.

- **New "Conversas silenciadas no resumo diário" field**, right below the
  existing "Grupos silenciados" one in the WhatsApp section — same
  tick-list UI, same `#groups-box`-style container (`#contacts-box`),
  backed by the new `loadWhatsappRecentContacts()` (`shared-prefs.js`) →
  `GET /preferences/whatsapp/recent-contacts`.
- **`groupsHtml()`/`contactsHtml()` now share one renderer,
  `chatPickerHtml(state, known, muted, copy)`** — a group and a 1:1
  contact render as the exact same kind of row (checkbox + live-resolved
  name + rate), sourced from two different endpoints but otherwise
  identical mechanics; only the loading/unreachable/empty copy differs
  between the two callers. Refactored rather than duplicated, following
  the same "one generic renderer, a `kind` parameter" shape
  `allowRowsHtml(entries, kind)` already used for the WhatsApp/e-mail
  allow-lists.
- **`collectSection("whatsapp")` reads each checkbox list scoped to its
  own container** (`#groups-box [data-jid]` / `#contacts-box [data-jid]`)
  rather than a bare `[data-jid]` query — the two lists render visually
  identical rows, so the container is what actually tells a group
  checkbox apart from a contact checkbox when building the PUT body
  (`excludedGroups` vs `excludedUsers`, both as `{jid,label}` arrays,
  matching `preferencesStore.js`'s `groupList`/`userList` coerce shapes).
- **10 new assertions in `test/preferencias.test.js`** (93 → 103, all
  green): ticking a contact checkbox and saving sends `excludedUsers`
  without touching `excludedGroups`; busiest-first ordering + rate
  display for contacts, mirroring the existing groups test; an
  already-muted contact still renders (and stays checked) when
  `/whatsapp/recent-contacts` reports `reachable:false`, mirroring the
  existing groups test for the same case. New fixtures `DEFAULT_CONTACTS`
  and a `contactsMode`/`contactsList` pair of `withPrefsFake()` options,
  mirroring `DEFAULT_GROUPS`/`groupsMode`/`groupsList` exactly.
- **Not yet deployed** — this is a GitHub Pages static site with no build
  step, so "deploy" is just merging to `main`; not done yet, pending
  review.

## Status (2026-09-06, latest): every search/filter box in the app is now accent-insensitive

Reported directly: typing "cafe" against an ingrediente/insumo stored as
"Café" found nothing, and a contact search for "Ivan" missed someone
stored as "Iván" — a real, everyday gap for a Brazilian household app
where nobody reliably types every accent on a phone keyboard.

- **New shared `foldSearchText()` in `shared-format.js`**: lowercases and
  strips Unicode combining diacritics via
  `.normalize("NFD").replace(/[̀-ͯ]/g, "")` — NFD splits a
  precomposed accented character into its plain base letter plus a
  separate combining mark, which the regex then drops, leaving the base
  letter untouched. Search-comparison only, never for display or storage.
- **Applied to every search/filter site that existed** — nine of them,
  each previously a bare `.toLowerCase()`: `clientes.html`, `estoque.html`
  (list + fornecedor picker), `eventos.html` (list + cliente picker +
  produto picker), `fornecedores.html`, `ingredientes.html`,
  `insumos.html`, `produtos.html` (list + fornecedor picker + receita
  picker), `receitas.html` (list + ingredient/sub-receita picker), and
  `shared-catalog.js`'s ingredient picker. Both the typed term AND the
  stored field are folded — folding only one side would silently stop
  matching the exact case this exists for.
  - **The picker's own "is this an exact match" check is folded too, on
    purpose** — e.g. `shared-catalog.js`'s ingredient picker deciding
    whether to offer "➕ Criar 'cafe'". Folding this means typing "cafe"
    against an existing "Café" reads as already-exists, not as license to
    create a second, redundant "cafe" ingredient a click away from the
    real one.
- **Regression tests in 7 files** (`clientes.test.js`, `ingredientes.test.js`,
  `stock.test.js` written directly; `eventos.test.js`,
  `fornecedores.test.js`, `produtos.test.js`, `receitas.test.js`
  delegated to a Sonnet sub-agent given well-specified instructions —
  purely mechanical, well-understood work, per this session's own
  cost-optimization convention) — each creates or reuses a real accented
  fixture, types the unaccented form, confirms the match, and checks a
  genuinely different term does NOT match (no over-matching). Every new
  assertion confirmed to fail against the pre-fix `.toLowerCase()`-only
  code before being trusted — including the sub-agent's own four files,
  independently re-verified (full suite re-run, a couple of the new
  assertions spot-read) rather than taken on the agent's report alone.
  **Full 14-suite regression green.**
- **The matching real-world gap on the WhatsApp CONTACT side — "Iván"
  found by "ivan" — lives one layer down, in `maga-infra`'s
  `whatsapp-query-api` (a synced-contact name, not anything this repo
  renders locally).** Fixed the same session; see that repo's own
  CLAUDE.md entry.

## Status (2026-09-06, later still): the WhatsApp allow-list — groups sorted by rate, search by name, and a real duplicate-number bug fixed

Three more rounds of direct live testing against the phase-2 build below.

- **Muted-groups list now sorts busiest-first** (`avgPerDay`, computed
  server-side — see `maga-infra`'s own entry), each row showing its own
  "≈X,X/dia" rate. **Fixed a real layout bug the first cut of this
  shipped with**: the rate rendered nested inside `.label`, wrapping onto
  its own line under the group name instead of sharing the row's line —
  caught only by MEASURING geometry (`getBoundingClientRect()`), since the
  text content was identical either way and no text-based assertion could
  have told the difference. It's now a sibling of `.label` inside the
  already-flex `.grouprow`, which puts it flush against the row's right
  edge for free.
- **"Verificar" now doubles as a name search** when what's typed contains
  letters instead of digits — calls the new
  `GET /preferences/whatsapp/contact-search?name=` (see `maga-infra`'s
  entry) and renders every match as a plain pick-list (never auto-picking
  on more than one match, same "ambiguous → list it" rule this app
  follows everywhere else). Picking one fills the number+label exactly
  like a resolved number check, so Adicionar is unchanged from there.
  - **A bare `@handle` is caught client-side before any request goes
    out.** The user flagged WhatsApp's 2026 username rollout directly
    (`@ronaldoaoki`-style contacts) — confirmed via the actual
    `tulir/whatsmeow` issue tracker that the underlying library has closed
    username support as "not planned", so a search for one can only ever
    come back empty. Refusing it up front, with the reason stated
    plainly, beats a network round trip that was never going to work.
  - `#wa-new` had `inputmode="numeric"` (real reported bug: makes typing a
    name impossible on a phone — the field locks to a digits-only
    keyboard) and a placeholder too long to read on screen. Dropped the
    `inputmode`, shortened the hint to "Nome ou número com DDD".
- **Real bug: the same phone number, typed with vs. without the 55
  country code, could both end up on the allow-list as if they were two
  different people** — reported directly, with a screenshot showing
  "5511994452426" and "11994452426" both listed for the same person. The
  dedupe check compared raw digit strings with no normalization, and
  worse: the server's own allow-list check
  (`security/allowlist.js` in `maga-infra`) ALSO has no normalization of
  its own, so whichever spelling was missing the `55` would silently
  never match a real send. New `normalizeWaNumber()` applies the exact
  10/11-digit → prepend `"55"` rule `clientes.html`/`fornecedores.html`'s
  own `waPhoneDigits()` already use for `wa.me` links, run on every path
  that turns typed text into a stored/compared number: Adicionar,
  Verificar, and picking a name-search result.
  - **Same pass fixed a related rough edge**: Verificar on an obviously
    too-short number (a real screenshot — "12345") reached the server and
    came back as a bare "Erro 400" leaking straight onto the page.
    Anything under 12 digits after normalization is now refused
    client-side with "Número muito curto." before any request goes out.
- `test/preferencias.test.js` grew from 69 to 93 assertions across these
  three rounds; every new case confirmed to fail against the reverted
  page first (including one genuinely surprising false failure caught and
  fixed in the TEST itself — `resolveAllowlistNamesLater()`'s own
  background lookups for pre-existing unlabeled fixture rows were being
  miscounted as "a request for the number I just typed", fixed by scoping
  the assertion to the specific query rather than the whole endpoint).
  Full 14-suite regression green after each round.

## Status (2026-09-06, later again): a real bug — a resolved WhatsApp contact name vanished on every page reload, plus duplicate entries and a silent race in name resolution

Direct live testing against the phase-2 build below surfaced three related
problems in the same allow-list feature, fixed together.

- **The actual reported bug**: resolve a number to a name via Verificar,
  save it, reload the page — the name is gone, back to a bare number.
  **Root cause**: `mergePerson()` deliberately collapses the overlay's
  rich `{number,label}` allow-list entries down to bare digit strings for
  `prefs.effective` (security code must compare flat strings, not trust an
  object a person could have hand-edited a label into) — but `render()`
  only ever read allow-list rows from `prefs.effective`, never from
  `prefs.overrides` (which `GET /preferences` already returns, and which
  DOES retain the real `{number,label}` shape). Every save was therefore
  invisible to the page on the very next load, even though the label was
  sitting intact server-side the whole time.
  - **Fix**: new `allowlistLabelsFor()`/`withRecoveredLabels()` read
    `prefs.overrides.whatsapp.sendAllowlist` and map a bare number through
    to its saved label before handing rows to `allowRowsHtml()`. Restoring
    a backup (`/import`) never returned `overrides` at all, so that path
    now does a plain follow-up `GET /preferences` instead of trusting the
    import response's partial shape.
  - A second, related correctness bug fixed in the same pass: a row's
    label used to be inferred from DOM TEXT-NODE SHAPE
    (`el.querySelector(".who").firstChild.textContent`) — unable to tell
    "no label" apart from "a label that happens to equal the bare number",
    risking a self-referential fake label being saved. Every allow-list
    function now reads/writes an explicit `data-label` attribute instead.
- **A live account ended up with the same WhatsApp number listed four
  times, some resolved to a name and some not** — two separate causes:
  (1) "Adicionar" never checked for an exact duplicate at all; (2) name
  resolution for pre-existing bare-string entries ran via `Promise.all`
  in parallel, and against a likely single-threaded LAN WhatsApp bridge,
  "still resolving" and "found nothing" looked visually identical — so a
  double-tap or a slow bridge response read as a dead end. Fixed with an
  exact-string dedupe check on Adicionar, and by making
  `resolveAllowlistNamesLater()` sequential with a visible
  "· verificando…" in-flight state per row.
- Test-file discipline note worth keeping: one of the new assertions'
  own timing (reading a second row immediately after the first settled)
  raced the page's now-sequential resolution and had to wait for that
  row's OWN settled state, not just the first row's.

## Status (2026-09-06, same day as phase 1): `preferencias.html` gains allow-lists, password, sessions and backup (phase 2 of 4)

Front-end half of `maga-infra`'s phase 2 (`03b623c`) — the security-tier
fields phase 1 (below) deliberately refused to save at all.

- **Allow-list editors for WhatsApp and e-mail.** "Verificar" resolves a
  typed number to a contact NAME before it is committed — a wrong digit is
  otherwise invisible until a message reaches a stranger.
- **Change-password form, active sessions ("sair dos outros
  dispositivos"), and export/import for backup** — the jump host has no
  backup of its own, so a person's overlay would otherwise be one bad edit
  from being unrecoverable.
- **A 428 from a security-tier save is handled as "type your password
  again", never as a generic error.** It routes through
  `/logout?return=...&reauth=1` — clearing the login cookie is what
  actually makes the real password form appear again; without it
  `/authorize` would silently re-approve from the existing session and
  hand back a token exactly as stale (in `authTime`) as the one that was
  just refused. The `reauth` query param is stripped before `startOAuth`
  fires or the return trip would loop on itself forever.
  Deliberately NOT `logoutMcpSession()` — that also drops the `maga-api`
  passphrase and environment cache, signing the person out of the whole
  app to change one setting.
- **`test/preferencias.test.js` grew 31 → 61 assertions**, covering the
  allow-list editors and their exact PUT bodies, contact-name resolution,
  the 428 re-auth hop and its loop prevention, the password form,
  sessions, export and import. **Two real bugs the tests caught**: an
  import confirmation message was written and then destroyed microseconds
  later by `render()` rebuilding the whole page out from under it (fixed
  by writing it into the FRESH element after re-render); a wrong current
  password came back as a 401, which `mcpFetch` treats as session expiry
  before it even looks at the response body — a typo bounced the person to
  the login form instead of naming the field (fixed server-side in
  `maga-infra`, `64ab783`).
- **The test suite itself hung indefinitely at first** — the 428 test
  watched the `/logout` navigation over a CDP session that never fires for
  a route-intercepted request. Fixed by answering both navigation targets
  (`/authorize`, `/logout`) with a plain **204 No Content**, which the
  browser ABANDONS per the HTML navigation spec: nothing commits, the
  current document (and its `sessionStorage`) stays readable, and the
  request is already recorded by the same fake that sees every other
  `MCP_BASE` call — no second event stream needed. The fake also had to
  start answering CORS preflights, since the real server does.

## Status (2026-09-06, later): `preferencias.html` — the settings frozen in `people.json` become editable (phase 1 of 4)

Full plan of record, including the phases this one does NOT cover, lives in
`maga-infra`'s `mcp-server/docs/PREFERENCES-PLAN.md`. Backend half is that
repo's own entry; this is the front-end half.

- **New `preferencias.html` + `shared-prefs.js`.** The page talks to the
  MCP server (`MCP_BASE`), NOT to `maga-api` — preferences are per-person
  and gated by the OAuth login, while the `maga-api` passphrase is one flat
  per-environment secret. Two different authorities, two different
  endpoints. Editable in phase 1: display name, notes-to-self number, muted
  WhatsApp groups, the four per-hour limits. Everything else renders
  read-only under a collapsed "Infraestrutura" section that says where it
  IS edited (`people.json`, on the jump host) rather than leaving someone
  hunting.
- **Reads are cached in `localStorage`, writes are not.** The jump host is
  a VM on a desktop that sleeps at night; a page that needed a live call to
  know its own settings would break every evening. A cache-served render
  says so in a banner instead of passing month-old values off as current.
- **`shared-api.js` now keeps the OAuth access token — in `sessionStorage`,
  deliberately not `localStorage`.** That token carries `mcp:send`, a
  strictly bigger capability than the `maga-api` passphrase already sitting
  in `localStorage`, so it should not outlive the tab. The cost is one
  extra login when the page is opened in a fresh tab, which is the right
  trade for a screen used about once a month.
- **The page refuses to open on a non-default environment**, reusing
  `isDefaultEnv()` — these settings belong to whoever SIGNED IN, so
  editing them while looking at someone else's environment (Alexandre
  inside Bia's prod to help her) would silently change his own. Same rule,
  same function, as Hoje/Tarefas hiding there.
- **Muted groups are ticked from a real list**, fetched from the person's
  own WhatsApp bridge through the MCP server AFTER first paint, never
  blocking it. Group display names are not unique, so the `@g.us` jid is
  what gets stored and the name is only ever a label. A muted group the
  bridge no longer lists still renders — otherwise saving would silently
  un-mute it.
- **A validation error lands under the input that caused it.** The server
  names the offending field (`rateLimits.sendMessagePerHour`), so the page
  puts the message there rather than in an `alert()`. The first cut got
  this right for the text fields and wrong for the rate-limit rows, whose
  markup had no error slot — caught by the new test, fixed in the markup,
  and the test now asserts an alert does NOT fire.
- `shared-menu.js` gained one entry under a new "Conta" group; `index.html`
  its tile description and group hint; `sw.js` both new files in
  `SHELL_FILES`.
- **`test/preferencias.test.js`** (new, 31 assertions): the passphrase gate,
  the no-token state, the non-default-environment refusal making ZERO calls
  to the MCP server, the rendered values, both save paths and their exact
  PUT bodies, the inline 400, and the page surviving an unreachable
  WhatsApp bridge. Full 14-suite run green.

## Status (2026-09-06): Hoje/Tarefas hidden and blocked while on a non-default environment

The OAuth login (against the `maga-infra` MCP server — `shared-api.js`'s
`startOAuth()`/`completeOAuth()`, `ENV_ID_KEY`/`ENV_CACHE_KEY`) lets an
account switch between several `maga-api` environments via `GET
/web-config`'s `webEnvironments` (see `mcp-server/people.json`: Alexandre's
default is `dev`, which is the household's real personal data reused as
dev data per `maga-infra`'s CLAUDE.md; Bia's is `prod`, her business).
That machinery already existed but wasn't yet written up here. The gap the
user flagged directly: nothing stopped an account from opening a
NON-default environment and seeing the OTHER account's personal daily
triage/tasks — e.g. Bia opening "dev" would see Alexandre's real
`tarefas.html`/`hoje.html` data, since "dev" IS his household's real data.

- **New `isDefaultEnv()` in `shared-api.js`**: true when there's no
  resolved `checklist_env` at all (the manual-passphrase "Opções
  avançadas" path never sets one, same as `shared-push.js`'s VAPID
  lookup — can't tell, so it reads as default rather than hiding the
  household's own primary login path) or when it matches the cached
  account's `defaultEnv`; false only when it positively resolves to a
  different, known environment.
- **New `visibleMenuItems()` in `shared-menu.js`**: `MENU_ITEMS` with the
  `"dia"` group (Hoje, Tarefas) dropped when `!isDefaultEnv()`. Both the
  hamburger drawer (`openMenu()`) and `index.html`'s dashboard tiles read
  through this one function instead of `MENU_ITEMS` directly, so the two
  can't disagree about what's on screen.
- **Direct-navigation guard**: `hoje.html`/`tarefas.html`'s `load()` now
  checks `isDefaultEnv()` right after the passphrase check and, if false,
  renders a blocked message ("Esta página não está disponível para esta
  conta neste ambiente." + a link back to Início) instead of calling
  `api()` at all — a bookmark or a typed URL can't leak personal data into
  an environment it doesn't belong to. New shared
  `personalPageBlockedHtml()` in `shared-ui.js` keeps the wording
  identical on both pages. The header + hamburger button still render in
  the blocked state, so the person can navigate elsewhere.
- **`test/env-scope.test.js`** (new): the blocked message + zero `maga-api`
  calls on a non-default env for both pages, normal loading on the default
  env, the manual-passphrase (no env id) path still reading as default,
  and the drawer/dashboard both dropping Hoje/Tarefas on a non-default env
  while leaving every other page/tile alone. Full 13-suite run green.

## Status (2026-09-05): the "worth its own pass" `stock.test.js` flake — a test race, not an app bug

Follow-up on the 2026-09-04 entry's loose end: "and the sheet redraws with
it" (the insumo name after an `insumos.html` metadata edit) failed
intermittently. `insumos.html`'s own redraw logic turned out correct —
`openInsumo(p.gtin)` really is called after a successful `insumo_upsert`
and really does show the fresh name — so the fix landed in the test, not
the page.

- **Root cause: `.ins-head` is not a reliable "the redraw happened"
  signal, because it's already on the page from BEFORE the edit.** The
  metadata editor is a modal overlay appended to `document.body`, not a
  replacement of the sheet underneath, so `.ins-head` (with the STALE,
  pre-edit name still inside it) stays in the DOM the whole time the modal
  is open. `await page.waitForSelector('.ins-head', {timeout:6000})`
  right after clicking Salvar can therefore resolve **immediately**,
  before `insumo_upsert` has even returned — and the very next line then
  reads the old name straight out of that stale element.
- **Why it never failed against this repo's own fake, only for real:**
  the fake's `route.fulfill` responds essentially synchronously, so by the
  time the test's next `await page.*()` call round-trips over CDP, the
  real (fast) save-and-redraw chain has usually already landed — masking
  the race locally. Reproduced on demand by adding an artificial delay to
  the fake's `insumo_upsert` response (the call gating whether
  `openInsumo()` even runs yet): with the delay, the unpatched test failed
  every time with exactly the reported message; against a live Supabase
  Edge Function, that delay is just ordinary network latency, which is
  presumably why it surfaced there but not here.
- **Fix, `test/stock.test.js`**: swapped the `.ins-head` presence check
  for a `waitForFunction` on the actual redrawn name text — the same
  "wait for the state to actually settle" rule this file already applies
  elsewhere (`waitQty()`, and the 2026-08-27 movement-delete redraw fix
  right above this one in the file). Confirmed the fix holds under the
  same artificial-delay repro before removing it. Full 12-suite run green.

## Status (2026-09-04): `hoje.html` gets a Web Push opt-in — "🔔 Clique aqui para ser notificado quando um novo resumo for publicado"

Backend half (schema, the new `push` domain, VAPID keys, the DB webhook
trigger) is in `sbralg/maga-api`'s own CLAUDE.md entry — this one is the
front-end half, riding on the PWA work from the entries below (manifest +
`sw.js`, already shipped).

- **New `shared-push.js`**: `subscribeToPush()` / `unsubscribeFromPush()` /
  `getPushSubscription()`, plus a `VAPID_PUBLIC_KEYS` lookup keyed by the
  resolved OAuth environment id (`ENV_ID_KEY` — dev and prod are separate
  Supabase projects with **separate** VAPID key pairs, see the backend
  repo's entry for why) with a same-two-projects host-matching fallback
  for the manual-passphrase "Opções avançadas" login path, which never
  sets an env id. A push subscription is permanently bound to whichever
  public key was active when it was created, so handing the wrong one to
  `pushManager.subscribe()` would silently orphan the subscription later.
- **`sw.js` gained `push` and `notificationclick` handlers** — without
  them the browser receives the push but shows nothing at all, since a
  service worker has to explicitly call `showNotification()`. Also added
  to `SHELL_FILES` so it's cached offline like every other shared script.
- **`hoje.html`**: a card at the bottom of the page in BOTH the normal
  report view and the "nenhum resumo ainda" empty state — arguably more
  useful in the empty state ("tell me the moment the first one lands"),
  so it wasn't limited to the populated view. Reflects live state
  (not-yet-subscribed / activated / unsupported / permission-denied) and
  toggles in place, no page reload.
- **Deliberately does NOT prompt for permission on page load.**
  `Notification.requestPermission()` only fires from the button's own
  click handler. An unprompted ask is a real anti-pattern, not just a
  style preference: Chrome's own per-site heuristics can silently
  downgrade an unprompted prompt to the barely-visible "quiet" permission
  UI, and a reflexive denial burns the one native ask with no way to
  retry short of the person digging through their phone's site settings.
- **`test/hoje.test.js` extended**: stubs `navigator.serviceWorker`/
  `PushManager`/`Notification` (same "stub only what the platform/
  hardware demands" convention as `compras.test.js`'s camera/
  `BarcodeDetector` stubs — a REAL `pushManager.subscribe()` would try to
  reach an actual push service over the network, which has no place in a
  hermetic test) and asserts the actual `push_subscribe`/
  `push_unsubscribe` calls reach `maga-api` with the right
  `endpoint`+`keys` shape, not just that the button's text changed.
- **Full 12-suite run green**, except a pre-existing, unrelated
  `stock.test.js` failure ("and the sheet redraws with it") — confirmed
  via `git stash` to already fail on the pre-change baseline, so not
  caused here; worth its own pass another time.
- **Depends on the `maga-api` side being redeployed** — `push_subscribe`
  won't actually work against the live endpoint until that Edge Function
  ships the new `push` domain and both Supabase projects have
  `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` secrets set. See the backend
  repo's entry for exactly what's still pending there.

### Follow-up the same day: two real bugs from the first live notification, both fixed

The user enabled notifications, triggered a real daily-summary run, and got
a real push — which surfaced two bugs no amount of the earlier fake-backend
testing could have caught, plus a design gap in the status-bar icon.

- **Tapping the notification opened a plain browser tab at the WRONG URL**
  (`https://sbralg.github.io/hoje.html` — missing the `/maga-web/` prefix
  entirely) **instead of routing into the installed app's own window.**
  `notificationclick`'s `new URL(url, self.location.origin)` was the bug —
  `.origin` is just `https://sbralg.github.io`, dropping the path prefix
  a GitHub Pages **project** site (as opposed to a user/org site or a
  custom domain) always carries. Fixed to resolve against
  `self.registration.scope` instead, which correctly includes it.
  **The two symptoms were the same bug, not two**: Android matches a
  clicked URL against an installed WebAPK by checking whether it falls
  inside that app's registered scope; a URL outside `maga-web`'s scope
  can't be matched to anything, so Chrome fell back to an ordinary tab.
  Fixing the URL should fix the open-in-app behavior as a side effect,
  not as a separate change. **Verified directly** (not just reasoned
  about): a throwaway test served the repo under a real `/maga-web/`
  prefix (the existing test server serves at root, which would never
  have exercised this), confirming `self.registration.scope` resolves to
  `.../maga-web/` and `new URL("hoje.html", scope)` lands on
  `.../maga-web/hoje.html`.
- **The Android status-bar icon looked like a muddy blob of the full
  logo, not something anyone would have chosen on purpose.** The `badge`
  option in `showNotification()` is NOT a shrunk version of `icon` —
  Android keeps only its ALPHA channel and renders that as a small
  monochrome, OS-tinted silhouette. `sw.js` was reusing the same detailed
  circular badge (dashed ring, banner, wordmark) for both, and that much
  fine detail cannot survive being flattened to a ~24dp silhouette.
  **New `assets/badge-96.png`** — a single bold "M", solid white on
  transparent, rendered the same Playwright-SVG-to-PNG way the app icons
  were — is simple and high-contrast enough to actually read at that
  size. `icon-192.png` is unchanged and still used for `icon` (the
  full-color image inside the expanded notification).

## Status (2026-09-01, even later): the add-row calendar icon never actually grayed out — 📅 is a color emoji, and `color:` cannot touch one

Reported directly: "the calendar icon that allows users to set a date...
was supposed to be greyed out when no date is set." True in both states —
the icon looked identically (dark, saturated) colored whether or not a
date was picked, screenshot-confirmed before touching anything.

- **Root cause: `📅` renders as a full-color emoji glyph, and CSS `color`
  has no effect on a color emoji at all** — unlike the ☆/★ star (plain
  Unicode symbols that DO inherit `color`), a color-emoji font (Noto Color
  Emoji on Android/most Linux, Segoe UI Emoji on Windows, Apple Color Emoji
  on iOS) bakes its own palette into the glyph and ignores the text color
  entirely. `.date-btn{color:var(--muted)}` / `.date-btn.set{color:var(--accent)}` were both silently doing nothing to the glyph's appearance —
  only affecting properties that never mattered visually here.
- **Fix: `filter`, not `color`, is the CSS lever that actually reaches a
  color emoji.** `.date-btn` now carries `filter:grayscale(1) opacity(.55)`
  for the unset state (visibly muted/gray), and `.date-btn.set` clears it
  (`filter:none`) for the full-color icon once a date is picked. `color`
  is left in place too, harmless, in case a platform ever falls back to a
  monochrome text-style glyph for this character.
- **`test/tarefas.test.js` gained two assertions checking the actual
  computed `filter`, not just the `.set` class** — the class-only
  assertions already in the suite passed both before and after the fix,
  which is exactly the "check values could not have caught this" class of
  gap this repo's CLAUDE.md already flags for CSS-only bugs (the icon-btn
  hit-target entry, the scan-dialog price-field entry). Confirmed the new
  assertion actually fails against the pre-fix CSS (`git stash` the file,
  re-run) before trusting it. One timing wrinkle: reading `filter`
  synchronously right after the `.set` class is applied catches a
  mid-transition interpolated value (e.g. `grayscale(0.15) opacity(0.93)`)
  since the change is CSS-transitioned — fixed by `waitForFunction`-ing
  until the filter settles to `"none"` before asserting, rather than
  reading it immediately.
- Full 11-suite regression run green.

## Status (2026-09-01, later still): star glyph weight fix + a real horizontal-overflow bug on page load

Two more rounds of direct feedback against the redesign below, both against
real screenshots.

- **The outline star's stroke was too heavy; the filled star could take a
  touch more.** The entry below applied the SAME
  `-webkit-text-stroke:0.7px currentColor` + `font-weight:900` to both `☆`
  and `★` — wrong, because a stroke affects the two very differently. `☆`
  is already thin outline strokes, so any added stroke reads as
  heavy-handed; `★`'s filled body barely shows the same stroke width at
  all. Fixed by splitting the rule: `.star-btn` (the unstarred/`☆` state)
  now carries no stroke/weight override at all — just the browser default —
  and only `.star-btn.important` (the starred/`★` state) keeps a stroke,
  nudged to `0.8px` for a bit more boldness. Verified against a Microsoft
  To Do reference screenshot the user provided, side by side with a
  rendered screenshot of this page, before and after.
- **Real bug: the page loaded with a ~50px horizontal scrollbar and looked
  slightly zoomed out — reported as "it looks like it's opening with the
  same width as the 'Concluir selecionados' button."** That specific
  suspicion turned out to be a red herring (`#done-btn` measured a correct
  358px, fully inside the 390px viewport) — the actual overflow was on
  `.wrap` itself (`#root`), measuring 440.578px wide against a 390px
  viewport. **First theory tried and DISPROVEN by re-measuring: the classic
  flex `min-width:auto` trap.** Adding `min-width:0` to `.wrap` had zero
  effect on the measured overflow — proving `.wrap`'s width wasn't being
  floored by min-content at all.
  - **Real cause: `.wrap{margin:0 auto}`'s own auto left/right margins
    disable `align-items:stretch`.** `.page` is a column-direction flex
    container, which makes width `.wrap`'s CROSS axis — and per the
    flexbox spec, auto margins on a flex item's cross axis take that item
    out of stretch alignment entirely, falling back to shrink-to-fit/
    content-based sizing instead. `.wrap` had no explicit `width`, so once
    stretch was disabled it sized itself to its own content instead of
    `.page`'s width; an unshrinkable descendant (the add-row's fixed 40px
    date-icon button) was wide enough to push that content-based size past
    the viewport.
  - **Fix confirmed by runtime style injection before touching the file**:
    adding `width:100%` to `.wrap` (alongside the pre-existing
    `max-width:640px` and `margin:0 auto`) took the measured overflow from
    `scrollWidth:441` down to exactly `390` (matching the viewport), with
    `.wrap`'s own computed width also landing exactly on `390px`. Applied
    to `.wrap`'s real CSS rule in `tarefas.html` with the corrected
    reasoning in its comment (the old comment, from before this bug was
    properly diagnosed, wrongly blamed `min-width:auto`).
  - Full 11-suite regression run green after both fixes.

## Status (2026-09-01, later): follow-up round on the due date/star redesign — no more big badge, a gold ★/☆ star, async in-place star toggle

Direct feedback against the shipped redesign, from a real screenshot:

- **The big per-row badge emoji is gone from pending rows** — only the
  small `[emoji] [categoria]` in the meta line remains (the done-tasks
  section still shows its own `.badge`, untouched, since that section
  wasn't part of this feedback). `.badge`'s CSS rule stays (still used
  there); the pending-row markup (`pendingRowsHtml()`) just no longer
  emits the element.
- **Star styling reworked**: unstarred is now the outline glyph `☆` in
  muted gray; starred is the filled glyph `★` in gold (`#eab308` —
  deliberately not `var(--accent)`, since a starred/important marker reads
  as a universal gold star regardless of this app's own red brand color).
  Swapping the actual glyph (not just a color class on one fixed glyph) is
  what gives the two states distinct outline-vs-filled shapes, not just
  different colors. Both glyphs also carry
  `-webkit-text-stroke:0.7px currentColor` + `font-weight:900` — the bare
  character read as thin/spindly at 21px; a same-color stroke thickens the
  star's arms without needing a bitmap or inline-SVG icon.
- **The star toggle is now async/in-place, matching the rest of the app's
  convention, instead of triggering a full `load()` reload.** New
  `currentRows` (the pending list currently on screen) +
  `sortPendingRows()` (mirrors `maga-api`'s own `important desc, due_date
  asc nulls last, first_seen asc` order) + `redrawPendingCard()`
  (re-renders just `#pending-card`'s innerHTML from the re-sorted
  in-memory rows, no network re-fetch). The star click handler now:
  optimistically flips the glyph/color, calls `action_edit` in the
  background, and on success mutates `it.important` + re-sorts +
  redraws — no `"Carregando…"` flash, no `list` round trip. On failure it
  reverts the glyph/class/title exactly as before. Text/category/due-date/
  delete edits (via the modal) still go through the full `load()` reload —
  unchanged, since that wasn't part of this complaint and matches this
  page's existing done/undo/delete convention.
  - **Checked checkboxes survive the redraw.** A naive
    `innerHTML` replace of the whole card would silently un-check any
    other rows already ticked for the bulk "Concluir" bar; `redrawPendingCard()` captures the checked ids first and re-applies them
    after rebuilding the markup.
- `test/tarefas.test.js`: a `listCalls` counter on the fake's `list`
  action proves the star toggle does NOT trigger another fetch (the
  concrete regression test for "no more full reload"), plus assertions for
  the outline→filled glyph swap and the absence of `.badge` on pending
  rows. Full 11-suite run green.

## Status (2026-09-01): `tarefas.html` gains a due date + a star (important), replacing the row's ✎/🗑 icons

Backend half (schema + `maga-api` actions + the scheduled-task prompt) is
in `sbralg/maga-api`'s own CLAUDE.md entry — this one is the front-end
redesign, done against a mockup screenshot the user provided.

- **Row restructure.** The checkbox is now its own sibling element instead
  of wrapping the whole row in a `<label>` — the row body (badge + text +
  meta) is a separate `.rowbody` element that opens the edit modal on tap,
  so the two gestures ("mark done" vs. "edit") needed to be structurally
  separate elements, not nested one inside the other. The ✎ and 🗑 buttons
  are both gone from the row: tapping anywhere on the row body opens the
  edit modal (✎'s old job), and a ⭐ sits where 🗑 used to be.
- **⭐ star toggles `important` immediately**, no confirm dialog — cheap,
  reversible household data, same reasoning `mcp-server`'s
  `maga_add_task` already uses for its own no-confirm writes. Filled/
  accent-colored when important, muted gray otherwise. Toggling it triggers
  a full reload rather than an in-place DOM patch — the one deliberate
  exception to this repo's usual "patch in place" convention, because
  toggling importance changes SORT ORDER (important bumps to the top), and
  this page already reloads for done/undo/delete/edit, so it's consistent
  with itself rather than with the rest of the app.
- **The meta line now shows `[emoji] [categoria]` and, when set,
  `· 📅 [Hoje/Amanhã/"Qua, 02 Set 26"]`** — replacing the old "· desde
  DD/MM" text entirely (a deliberate drop, per the mockup's minimalism, not
  an oversight). Overdue (due date in the past, task still pending) turns
  the icon+text red — and **keeps showing**, every day, until the task is
  marked done: the user's explicit call over the more literal "hide once
  the date passes" reading of the original ask.
  - New page-local `parseDateOnly()`/`fmtDueLabel()`/`isOverdue()` in
    `tarefas.html` (not `shared-format.js` — single consumer, and the
    Hoje/Amanhã special-casing doesn't resemble anything `fmtDate()`/
    `fmtDateTime()` already do, per that file's own "look-alike but
    genuinely different" rule). **`parseDateOnly()` hand-parses the
    `YYYY-MM-DD` string instead of `new Date(str)`** — the latter reads a
    bare date as UTC midnight, which renders as the PREVIOUS day in
    Brazil's UTC-3 offset. Worth remembering if a due-date-off-by-one bug
    ever shows up here again.
- **The add row gained a 📅 icon button between the text field and
  "Adicionar"** — muted while no date is chosen for the task being typed,
  accent-colored the moment one is picked, resetting to muted after the
  task is added (free, since `render()` fully rebuilds the add form on
  every reload anyway). It drives a hidden native `<input type="date">` via
  `.showPicker()` (falling back to `.click()`), so setting a due date at
  creation time needs no custom picker UI — same "build for Chrome/Android
  first" tradeoff this app already made for the barcode scanner;
  `showPicker()` needs a fairly modern Chromium.
- **The edit modal gained a native date field ("Data de vencimento") with
  a "Limpar" link to null it out**, and a "Remover" button in the footer
  (danger-colored, left-aligned via `margin-right:auto` against
  `.modal-actions`' `justify-content:flex-end`) replacing the row's old 🗑
  — delete now always goes through the edit modal, with the same
  `confirmModal()` confirmation as before.
- **`test/tarefas.test.js`** extended for all of the above: the add-row
  icon's gray→colored transition and its reset after adding, a starred
  task landing first in the list, clicking the star/checkbox NOT opening
  the edit modal (the row restructure's whole point), the overdue red
  class after setting a past due date, "Limpar" clearing it, and delete
  now happening via the modal's Remover button rather than a per-row
  icon. The native date picker itself isn't drivable headlessly (same
  limitation as the camera/barcode tests) — the hidden `<input
  type="date">` is set directly via `page.evaluate` + a dispatched
  `change` event, exercising the exact same handler a real picker
  selection would. Due-date assertions use offsets from "today" computed
  with LOCAL date parts (not `toISOString()`, which is UTC) so the test
  can't drift a day off the page's own local-date math depending on
  timezone. **Full 11-suite run green.**

## Status (2026-08-31): step 3 — front end points at `maga-api`

- **`shared-api.js`**: the `API` const now hits
  `…/functions/v1/maga-api` (deployed and verified 2026-08-31; `checklist-api`
  still live in parallel until this ships + `mcp-server` cuts over).
- All 11 `test/*.test.js` route interceptors updated
  `**/functions/v1/checklist-api` → `…/maga-api` to match.
- Repo/function names swept through every page, comment, README and this
  file. **Kept:** `x-checklist-pass` header + `checklist_pass` localStorage
  key (wire contract — renaming them touches every page for no gain; the
  passphrase value the user types is unchanged).
- `hoje.html`'s report URL and any `sbralg.github.io/…` link now say
  `maga-web` — these resolve only once the GitHub repo is renamed (step 4).

## Status (2026-08-27, later): new `ingredientes.html` — the ingredient concept finally has a screen

Asked by the user: "how can I delete a ingrediente. Example, leite
condensado. It feels like we need a ingredientes.html page." They were
right, and it was worse than a missing page: **`ingredient_rename` and
`ingredient_delete` have been in `maga-api` since 2026-08-13 and
NOTHING in this front end ever called either one.** An ingredient created
by a typo in the insumo picker ("Leit Condesado") was permanent, and no
screen anywhere even listed what existed. The only ingredient UI was the
picker, which can create and link but never rename or remove.

- **Everything except creating/editing reads actions that already exist** —
  `ingredients` for the list and `insumos` (whose rows embed their
  ingredient) to resolve what is linked and what is in the cupboard — so
  the list, the rollup, rename and delete all work the moment Pages serves
  the page. **`ingredient_create`/`ingredient_update` are new and need the
  Edge Function redeploy** (see the create bullet below for how the page
  says so rather than failing generically).
- **The detail view is the payoff of the whole two-level model**, and the
  one thing neither Insumos nor Estoque can show, because both are
  organised by barcode: **"5 pacotes · 1,975 kg no total · somando 2
  insumos"** — how much of the THING is in the house, summed across every
  brand of it. That is literally the question ("tenho leite condensado?")
  the ingredient layer was built to answer, and until now nothing asked it.
  - The net total is shown **only when every linked insumo agrees on a unit
    and actually has a size recorded** — 3 × unknown is not a number, and
    adding grams to millilitres is not one either (the g-vs-ml problem the
    backend repo's 2026-08-11 audit documented). Packages always sum;
    the net line simply disappears when it would be a lie.
- **Search matches the BRAND, not just the ingredient's own name**, since
  someone holding a box looks for what is written on it.
- **An ingredient nothing points at is flagged "⚠️ sem insumo"** — that is
  exactly what a picker typo leaves behind, and being able to spot it down
  the list is what makes a cleanup pass possible at all.
- **Delete distinguishes its two outcomes, because they are genuinely
  different.** Deleting UNLINKS the insumos under it (their barcode, price
  history and pantry balance are untouched — being categorised is not part
  of what an insumo IS), and the confirm says how many will be unlinked
  before you commit. But a `receita_itens` or `produto_embalagens` row is a
  **live formula**, so the API refuses outright with no force option; the
  page turns that 400 into a dialog naming how many lines still reference
  it.
- **"+ Novo ingrediente" creates one BY HAND, with no insumo behind it.**
  This page first shipped WITHOUT that, on the reasoning that an ingredient
  exists because some insumo IS it, and a hand-made one prices every recipe
  using it as incomplete. **The user overruled it, and was right:** *"I
  don't want to keep the user from registering her recipes just because she
  didn't scan a bar code yet."* Recipes get written down long before every
  box gets scanned; refusing to store "450 g de farinha" until a barcode
  exists blocks the actual work to protect a number nobody asked for yet.
  An unknown cost was already a first-class, loudly-reported state
  everywhere it surfaces (never a silent 0) — so the right answer was to
  let the recipe be written and keep saying the cost isn't known.
  **The general lesson: this app's "unknown is never zero" rule is about
  never LYING about a number, not about refusing to store anything the
  number depends on.**
  - **Two NEW Edge Function actions**, `ingredient_create` and
    `ingredient_update` — the first backend change this page needed.
    No migration: `ingredients.kind` and `.base_unit` were already
    nullable, and the existing CHECK constraints already allow every value
    the dialog offers.
  - **The dialog asks for a unit, because a recipe line is meaningless
    without one** ("450" of what?) and the path that normally sets it —
    the first insumo linked — hasn't happened yet.
  - **`kind`/`base_unit` are editable only while NO insumo is linked.**
    Once one is, the INSUMO is the authority (that is exactly what
    `checkIngredientUnitAndKind` enforces on every link), so
    `ingredient_update` refuses and the dialog shows them locked with the
    reason. Letting this action move them would be the silent g-vs-ml
    mixing that check exists to prevent.
  - **A name-only edit still goes through `ingredient_rename`**, which has
    been deployed since 2026-08-13 — so fixing a typo keeps working even
    before the redeploy the two new actions need. Only a unit/kind change
    calls `ingredient_update`.
  - **The page degrades in words, not generically, when the Edge Function
    is behind**: `maga-api` answers an unknown action with a 400
    `{error:"bad action"}`, which — now that `api()` surfaces the parsed
    body — is told apart from a real validation failure and reported as
    "republish the Edge Function".
  - **The list badge names the CONSEQUENCE, "⚠️ sem custo", not the
    mechanism.** Someone scanning the list is there to find out why a
    recipe says "custo incompleto". The detail sheet then names which of
    the two causes it is (nothing linked, or linked but never bought),
    because the fix differs — and says plainly that the recipes using it
    *funcionam normalmente* meanwhile.
  - `receitas.html`'s wording moved with it: a line reads "⚠️ sem custo
    ainda" (not "nunca foi comprado", which is only one of the two causes),
    and the summary warning leads with "A receita está salva e completa"
    before naming what is missing. A recipe with an unpriced ingredient is
    a perfectly good recipe.
- `insumos.html`'s "Ingrediente" line now **links through** to it, and the
  page sits in the menu/dashboard's **Produção** group between Insumos and
  Receitas — which is the pipeline order (barcode → what it is → recipe →
  product).
- `test/ingredientes.test.js` covers the list, brand search, the kind
  filter, the "sem custo" badge, the rollup math, the duplicate-name
  refusal on create and on rename, the blocked delete, the unlink count,
  and the hand-create flow including unit/kind being editable while
  unlinked and locked once an insumo is. Its fake keeps insumos pointing
  at ingredients by id, so the rollup, the unlink count and the lock are
  computed from that graph rather than canned.
- **Not runtime-verified**: this sandbox has no Docker, so the local
  Supabase stack is unavailable, and the `http`-extension fallback only
  reaches the DEPLOYED function — which does not have the two new actions
  yet. They are syntax-clean (TypeScript parse, 0 diagnostics) and follow
  the file's existing conventions, but the first real exercise of them
  will be the user's own redeploy.

**Shared change riding along: `api()` now exposes the parsed error body as
`e.body`.** Several refusals carry STRUCTURED detail that every page was
throwing away — `ingredient_delete` reports how many receita/embalagem
lines block it, `receita_delete` NAMES the recipes and produtos using it.
Pages could previously only say "não foi possível". Parsed best-effort, so
a non-JSON body (a proxy error page) leaves `e.body` absent rather than
turning a clean 400 into a thrown `SyntaxError`. `receitas.html`'s delete
refusal now uses it too, listing what blocks it instead of a generic toast
— and its test assertion, which used to check only that `#root` had *some*
text (an assertion nothing could fail), now checks the blocker is named.

## Status (2026-08-27): UI/usability pass — the three reported bugs, a reordered Receitas detail, grouped navigation, and the FULL test suite green for the first time

Reported by the user against the live pages: "the recipe page [is]
confusing. I can't edit or delete ingredients. The insumos page ingredient
and category pills are not aligned, recipe edit and remove buttons are
overlapping the table below." All three were real and are fixed; each was
measured in a headless browser before and after rather than eyeballed.

- **"I can't edit or delete ingredients" was a HIT-TARGET bug, not a
  broken handler.** `.icon-btn` (shared-base.css) rendered at **25×28 /
  28×28 CSS px** — the ✎/🗑 on a recipe's ingredient rows were wired
  correctly the whole time and simply too small to hit on a phone. Now
  `min-width/min-height:40px` with the glyph centred via inline-flex; the
  visible ink is unchanged, only the hit area grew. This lands on every
  row-action button in the app (tarefas, compras, eventos, financeiro,
  insumos, receitas and the shared produto panel), not just Receitas.
  - **Regression this caused, and the fix — worth remembering.** Giving
    `.icon-btn` an explicit `display` made a class rule outrank the UA
    sheet's `[hidden]{display:none}`, so every hidden icon button silently
    reappeared — specifically compras.html's per-row camera, which is
    hidden once a row has a barcode. Caught by `compras.test.js` (4
    assertions), fixed with an explicit `.icon-btn[hidden]{display:none}`.
    Same specificity trap as the 2026-08-11 scan-dialog price field: **in
    this codebase, adding `display` to a shared class needs a `[hidden]`
    guard.**
- **"Edit and remove buttons overlapping the table below": `.detail-actions`
  had `margin:14px 0 0` and no bottom margin**, so the button row's bottom
  edge sat exactly on the following card's top edge — measured gap **0px**.
  Now `14px 0 18px` on all five detail pages that had it (receitas,
  produtos, clientes, eventos, fornecedores); measured gap 22px.
  `insumos.html` deliberately keeps no bottom margin — its actions row sits
  INSIDE a `.card.pad` and the next block's own border-top divider already
  separates it.
- **"Pills are not aligned" on insumos rows: the kind badge and the
  ingredient tag were bare inline-blocks** sharing a text baseline at
  different font sizes, and the kind badge carries an emoji (taller line
  box). Measured **6px apart vertically**. They now sit in a
  `<span class="tagrow">` flex row with `align-items:center` and one type
  scale; measured delta **0px**. Matching the font sizes alone would NOT
  have fixed it — the emoji still lifts its own line box, so the flex row
  is the load-bearing part.
- **Receitas detail reordered so it reads cause → effect.** It opened on
  the cost totals with the ingredient lines that produce them further down,
  which is why it read as a report rather than as something editable. Now:
  actions → **Ingredientes** (with the batch-scaling control directly above
  the list it affects) → **Custo** → Categoria. Also:
  - **A per-gram unit cost no longer renders as "R$ 0,00".** `fmtMoney`'s
    fixed two decimals turned every sub-centavo unit cost into something
    that reads as free — the exact failure this project's standing
    "unknown is never zero" rule exists to prevent. A page-local
    `fmtUnitMoney()` gives small values the digits they need
    (`R$ 0,0055/g`); LINE totals still use `fmtMoney`, since those really
    are a number of centavos.
  - **A line with no cost says so on the row** ("⚠️ sem custo — nunca foi
    comprado") instead of rendering blank and leaving only a summary
    warning further up the page to explain the gap.
  - **The batch-scaling control always states what it is doing** — "×2,5 —
    quantidades e custos abaixo ajustados para esta fornada" plus a "Voltar
    ao original" link — where before it was a bare input under a long
    parenthetical label with nothing confirming it had taken effect.
  - **The Custo card is deliberately NOT scaled, and now says so** when a
    scale is active ("valores da receita original (1200 g)"). Safety margin
    and prep labour do not scale linearly with the batch, so multiplying
    the server's number client-side would invent one; labelling it is what
    stops the card from silently disagreeing with the scaled lines above.
  - Empty states became actionable: the ingredient picker's dead end now
    links to Insumos (an ingredient only exists once an insumo is linked to
    one), and the empty item list explains that a line can be another
    receita too.
  - **The header was NOT changed.** An earlier pass here made the recipe
    name the h1 and it looked better in isolation — but all five detail
    pages share the "h1 = module, record name right-aligned beside the back
    link" shape, and the user tuned that shape on eventos across four
    commits (`d73492b`, `7414e40`, `bc3dfce`, `a812128`). One page
    departing from it reads as a bug, not a refinement, so it was reverted
    to match.
- **Navigation grouped into Dia a dia / Produção / Negócio**, in
  `shared-menu.js` (`MENU_GROUPS` + a `group` key per item) and rendered by
  both the drawer and the dashboard from that one source — twelve flat
  destinations gave no clue which belong to the same job, and the
  production chain (Insumos → Receitas → Produtos) only reads as a chain
  once its four pages sit under one heading. The dashboard adds a one-line
  hint per group. Group headings are `<p class="menu-group">` and
  deliberately never carry `.menu-item`, since every count/query over the
  drawer's destinations keys off that class. The drawer also gained
  `overflow-y:auto` — 12 items plus 3 headings can outgrow a short phone.

### The test suite is green end to end — first time

All ten suites pass. Before this session **six assertions across five
suites were failing**, logged in the backend repo's CLAUDE.md as
pre-existing and "worth a dedicated pass". A baseline run (`git stash`,
run, `git stash pop`) confirmed the same failure set before and after this
session's UI changes, so none of them were caused here. What each turned
out to be:

- **`compras.test.js` (timeout) was a REAL, live, user-facing bug.**
  `redrawItemText()` still called `productMeta(it)` — a function renamed to
  `insumoMeta` by the 2026-08-24 Produtos→Insumos rename (`8fe4bd7`). It
  threw a `ReferenceError` on every in-place row redraw, so **the brand/
  size line under a shopping-list item silently never updated after an
  edit or a barcode scan**. One-word fix; the rename's grep sweep missed
  this one call site.
- **`eventos.test.js` (timeout) was a test race.** It waited on
  `.evento-head` after a payment edit, but that element is present before
  the edit too, so `waitForSelector` resolved instantly while `#root` still
  held the "Carregando…" placeholder — the pay-row count then read 0 and
  the following `waitForFunction` could never be satisfied. It now waits
  for the edited amount to actually be on screen. A second assertion read
  `.evento-head .name`, stale since `d73492b` moved the name into the
  header (`#evento-name`).
- **`clientes.test.js` (2 failures) were stale expectations**, describing
  behaviour the user deliberately removed in `d2df750` (the WhatsApp button
  stays enabled and opens the contact when no message is typed; the
  "Histórico de mensagens" note was dropped). The assertions now describe
  what the page is meant to do.
- **`stock.test.js` carried a latent flake** (~1 run in 5) that only
  surfaced once the rest of the suite stopped failing: deleting a ledger
  movement also kicks a full detail reload, and the assertion re-read the
  DOM after its own `waitForFunction` had already settled — a `$$` landing
  inside the reload's "Carregando…" window counted 0 rows. It now asserts
  the fake's ledger, since the row count is what the wait just proved.
- **`hoje.test.js`/`tarefas.test.js` hard-coded "9 destinations"**, stale
  from the moment Receitas/Produtos/Fornecedores were added. Both now
  derive the expected count from `MENU_ITEMS.length`, so adding a page
  can't quietly break them again.

Node 20+/Playwright is available in this sandbox (`NODE_PATH=/opt/node22/
lib/node_modules`), so **there is no longer any excuse for shipping a
change here unrun** — the older entries below that say "could not be run
in this sandbox" reflect earlier sandboxes, not this one.

## Status (2026-08-24): Receitas + Produtos + Fornecedores modules shipped — the (Shopping List >) Insumos → Receita → Produto reshape is now complete end to end

Full plan and reasoning in `sbralg/maga-api`'s
`ROADMAP.md` and `CLAUDE.md` (the "Receita + Produto + Fornecedor" Status
entry has the full ported pricing formula) — this entry is the short,
front-end-focused version.

- **Three new pages: `receitas.html`, `produtos.html`, `fornecedores.html`**
  (the modules the 2026-08-24 Insumos rename was staged for), plus
  extensions to three existing pages. The whole pricing model was ported
  from the household's real spreadsheet (`Precificação Produtos Magá.xlsm`)
  rather than invented — see the backend repo's CLAUDE.md for the traced
  formula and the design decisions the user made across two review rounds.
  - **`receitas.html`**: list + a builder view. Adding an ingredient line
    opens a picker offering "🧂 Ingrediente" (filtered to insumos-catalogue
    ingredients, never packaging) or "📖 Receita" (a recipe can consume
    another recipe — e.g. a syrup inside a cake — with server-side cycle
    rejection), then a quantity step. The cost breakdown (batch cost →
    with safety margin → per prep-labor → cost per yield unit) is shown
    read-only, computed server-side every read — never cached. An
    ingredient that's never actually been stocked shows up BY NAME in an
    incomplete-cost warning rather than silently pricing as free.
    **"Rendimento Desejado" (batch scaling) is a real, live feature, not a
    stub** — an ephemeral input (never saved) that shows every line's
    quantity scaled to a bigger batch, recursing through nested sub-
    recipes, computed instantly client-side. Turning that into an actual
    shopping-list addition is deliberately deferred (see backend repo's
    Planned/future).
  - **`produtos.html`**: kind switch (manufaturado → a Receita picker;
    comprado → an Ingredient picker — a fornecedor-sourced item resold
    as-is costs itself the SAME way a recipe line does, no separate
    supplier-cost field) with embalagem lines filtered to `kind='embalagem'`
    ingredients, three margin tiers (atacado/distribuidor/varejo), the full
    computed pricing breakdown, and a reverse "if I want to sell at retail
    R$X" calculator that's pure client-side arithmetic on the margins
    already loaded — no round trip for that part.
  - **`fornecedores.html`**: name/phone/email/notes (phone doubles as the
    WhatsApp number, exact same `waPhoneDigits()`/`wa.me` pattern as
    `clientes.html`), and a purchase-history list read through
    `fornecedor_detail` — every inbound `stock_movements` row tagged with
    this fornecedor, joined to the insumo for its name. No separate
    history table; the tagging happens optionally when booking a stock
    movement (see `estoque.html` below).
  - **`eventos.html`**: `itemModal` gained an optional "🔗 Vincular
    Produto" picker. Picking one prefills description/cost/price from the
    produto's current `preço_atacado` — still fully manually editable
    before saving, per the user's explicit instruction that a sale typed
    in a hurry with no time to search a catalogue must keep working
    exactly as it did before.
  - **`insumos.html`**: a kind filter (chip row: Todos/🧂 Ingredientes/
    📦 Embalagens) + badge on every row, and kind + category editing added
    to the metadata editor (a lazily-created-category `<select>` — "+ Nova
    categoria…" creates one inline via `insumo_category_create`).
    Categories are purely organizational (browsing), separate from the
    load-bearing `kind` flag the recipe pickers filter on.
  - **`estoque.html`**: the shortfall-recovery dialog (booking an
    `unaccounted_purchase` when a consumption would cross zero — the one
    place that already asks for a price) gained an optional Fornecedor
    picker. **Deliberately NOT added to the fast one-tap `+` gesture** —
    that stepper stays dialog-free on purpose; see the 2026-08-09/08-12
    entries below on why its speed is load-bearing UX, not an oversight.
  - **`shared-menu.js`**: three new entries, plus two emoji swaps per
    direct user feedback — 🏷️ (price tag) moved from Insumos to Produtos
    since that's literally what it is; Insumos got 🥖; Eventos got 🥂
    (was 🧾, which the user didn't like).
  - **A real bug caught during review, before any test ran**:
    `receitas.html`'s batch-scaling redraw replaced `#itens-card`'s
    `outerHTML` with bare unwrapped rows on first use, which silently
    broke every *following* keystroke (the id was gone, so the redraw
    function found nothing to update). Fixed to patch `innerHTML` instead.
  - **`test/receitas.test.js`, `test/produtos.test.js`,
    `test/fornecedores.test.js` were written** following the established
    fake-backing-store-with-real-relational-math convention — the fakes
    reimplement the actual cost formulas line-for-line (nested-recipe
    recursion and the incomplete-cost cases included), not canned fixtures
    — **but could not be run in this sandbox (no Node 20+/Playwright)**.
    Run these three, plus `insumos.test.js`/`stock.test.js`/
    `eventos.test.js` as a regression check, before trusting this shipped
    cleanly.
  - **Not live-verified against the deployed function** — see the backend
    repo's CLAUDE.md for a same-session Edge Function deploy incident
    (self-inflicted, resolved by the user) that used the verification
    window this would otherwise have had.

- **Module renamed: Vendas → Eventos (2026-08-24).** `vendas.html`→
  `eventos.html` (plain `git mv`, no redirect stub — same convention as
  the earlier `index.html`/`shopping.html` renames below), `test/
  vendas.test.js`→`test/eventos.test.js`, the `MENU_ITEMS` entry, the
  dashboard tile, and every cross-link/label on `clientes.html`/
  `financeiro.html` updated to match. The underlying `maga-api`
  actions/tables were renamed too (`venda_*`→`evento_*`) — see the backend
  repo's `CLAUDE.md` for the full DB migration. **The live Edge Function
  had not been redeployed as of this rename** (the user redeploys it
  themselves, on purpose — see that repo's gotcha #20), so until that
  happens `eventos.html`'s API calls will 500. A mechanical find/replace
  also breaks Portuguese gender agreement (`venda` is feminine, `evento`
  is masculine) — swept for and fixed every "Nenhuma evento", "Nova
  evento", "-la" pronoun, etc. that the substitution introduced, rather
  than shipping it broken.

- **The refactor** replaced "duplicate everything verbatim across pages"
  with the `shared-*.js`/`shared-*.css` files described under "Shared
  files" below, renamed `index.html`→`tarefas.html` and
  `shopping.html`→`compras.html`, and added a new `index.html` as a
  module-tile dashboard. No redirect stubs at the old names — a deliberate
  choice, not an oversight.
  - **Disclosed behavior changes riding on the refactor, not hidden inside
    "just moved the code":** `tarefas.html` and `hoje.html` gained the
    richer `api()` (400-vs-other error classification) and the shared
    `handleAuthError()` re-login flow they didn't have before; and the
    date+time rendering used by `tarefas.html` ("desde…") and `hoje.html`
    ("gerado em…"/"concluída em…") changed from a space-separated format
    to the comma-separated one `insumos.html` already used
    (`fmtDateTime()` in `shared-format.js`), since two pages could not both
    keep their old `fmtDate` behavior once merged under one name.
  - `tarefas.html`/`hoje.html` had zero automated coverage before this —
    a real risk given they picked up real behavior changes — so
    `test/tarefas.test.js` and `test/hoje.test.js` were added alongside
    the refactor, not after.
- **Eventos + Financeiro** are new modules for the household's side
  business: `eventos.html` tracks one evento (sale/event/order) per row through a
  Lead→Orçamento→Confirmado→Entregue→Cancelado pipeline, with `clientes`,
  line items (produto/serviço), and an editable payment ledger.
  `financeiro.html` is the cost/revenue ledger that Eventos auto-posts
  confirmed payments into. Full schema + Edge Function action list are in
  the backend repo's `CLAUDE.md`; see "What this is" below for what each
  page covers.
- Deployed `maga-api` v26 and **live-verified** the whole Eventos/
  Financeiro action set against the real project via the `http`-extension
  trick (see the backend repo's `CLAUDE.md` for the full sequence) before
  building either page against it.
- **`clientes.html` (2026-08-24)** is the ninth page: the contact record
  behind an evento — full-field create/edit/delete (not just the by-name-
  only inline picker `eventos.html` already had), the eventos + pagamentos
  rollup for that cliente read through the new `cliente_detail` action
  (`maga-api` now v27, live-verified the same way as v26) and a
  "Enviar WhatsApp" composer that builds a `wa.me` deep link client-side —
  no backend, because this household's WhatsApp bridge is LAN-only and
  unreachable from the Edge Function (see the backend repo's `CLAUDE.md`
  for why). `eventos.html`'s cliente block gained a "Ver cliente" link into
  it. **Message/e-mail history per contact is deliberately not built** —
  the page says so under the composer rather than leaving a silent gap;
  see the backend repo's Planned/future for what a real one would need.
  `test/clientes.test.js` covers create/edit/delete, the totals rollup,
  the wa.me phone normalization (a Brazilian 10/11-digit number gets `55`
  prepended, an already-prefixed number is left alone), and the deep link.

- **Module renamed: Produtos → Insumos (2026-08-24), the first step of a
  bigger reshape: (Shopping List >) Insumos → Receita → Produto.** The
  barcode catalogue that used to be called "produtos" is being repurposed
  as raw materials/supplies bought and tracked in the pantry — "Produto"
  will become a NEW concept (a manufactured-via-recipe or supplier-bought
  item that gets sold, costed automatically either by its recipe or by its
  supplier cost), so the old name had to stop meaning two different things.
  This session only did the rename; Receita and the new Produto/Fornecedor
  modules are not built yet — see the backend repo's Planned/future.
  - `produtos.html`→`insumos.html` (plain `git mv`, no redirect stub, same
    convention as every other page rename here), the `MENU_ITEMS` entry, the
    dashboard tile, and every cross-link/label on `estoque.html`/
    `compras.html`/`shared-catalog.js`/`shared-catalog.css` updated to
    match — including internal identifiers (`productMeta`→`insumoMeta`,
    `openProduct`→`openInsumo`, `renderProduct`→`renderInsumo`,
    `productEditModal`→`insumoEditModal`, `.prod-head`/`.prod-title`→
    `.ins-head`/`.ins-title`, `#edit-product`/`#del-product`→
    `#edit-insumo`/`#del-insumo`), not just the Portuguese UI labels.
  - The underlying `maga-api` actions/tables were renamed too
    (`product_*`→`insumo_*` action names, `products`→`insumos` table,
    `product_prices`→`insumo_prices` table) — see the backend repo's
    `CLAUDE.md` for the full DB migration, applied live the same session.
    **The live Edge Function had not been redeployed as of this rename**
    (the user redeploys it themselves, on purpose — see that repo's
    gotcha #20), so until that happens `insumos.html`'s and `estoque.html`'s
    API calls will 500.
  - `ingredients`/`ingredientModal()` and the `.ing-*` naming are
    deliberately UNCHANGED — "ingredient" is a different concept (what a
    barcode IS, for a future recipe) from "insumo" (the raw-material
    catalogue itself), and this rename didn't touch it.
  - `eventos.html`'s `evento_itens.tipo` value `"produto"` (🎂 Produto, a
    sale line-item type) is DELIBERATELY untouched by this rename — it
    already means the NEW "Produto" concept this reshape is heading toward
    (a sold item), not the old barcode catalogue, so renaming it would have
    been backwards.
  - `test/stock.test.js` and `test/compras.test.js` updated to match
    (`PRODUCTS`→`INSUMOS`, `KNOWN_PRODUCTS`→`KNOWN_INSUMOS`, the renamed
    action names and response fields, `.prod-head`/`.prod-title`→
    `.ins-head`/`.ins-title`, `#edit-product`/`#del-product`→
    `#edit-insumo`/`#del-insumo`). **Not run from this session** (no
    `node`/Playwright in this sandbox) — run both once after the Edge
    Function is redeployed.

## What this is

The public GitHub Pages front end deployed from this repo's `main` branch,
served at https://sbralg.github.io/maga-web/. Thirteen pages sharing a
set of `shared-*.js`/`shared-*.css` files (see "Shared files" below), no
build step, no framework:

- `index.html` — the **dashboard**: module tiles, no live data. The
  landing page since the 2026-08-20 refactor (see the dated entry below);
  it used to be the daily-task checklist, which moved to `tarefas.html`.
- `tarefas.html` — the daily-task checklist (pending actions sorted
  important-first then soonest due date, done-tasks history with undo,
  manual task creation with an optional due date, a ⭐ star for importance,
  and an edit modal for text/category/due date/delete). Renamed from
  `index.html` when the dashboard took over that filename.
- `notas.html` — the user's own general-purpose notebooks by default, plus
  a global search across every note's text (object-backed notebooks
  included) for the ones that live on their own object's page instead;
  opening an object-backed notebook (cliente/evento/produto/receita/
  fornecedor/ingrediente/insumo) via search or a direct link back to that
  object's own page, opening a user-created one offers rename/delete.
  Env-gated like `hoje.html`/`tarefas.html` — this account's own personal
  data, hidden while looking at a different environment.
- `compras.html` — the shopping-list manager (multiple named lists,
  per-item price + quantity, purchased toggle, running totals, barcode
  scanning against the product catalogue). Renamed from `shopping.html`.
- `hoje.html` — "Hoje": the morning summary rendered for the browser,
  read from `public.daily_reports`.
- `estoque.html` — the pantry: how many packages of each insumo are in
  the cupboard, and changing that (− / + steppers, exact recount).
- `insumos.html` — the insumo catalogue: what a barcode means, its price
  history as a graph, the editor that corrects its metadata, and removal
  from the catalogue.
- `ingredientes.html` — what an insumo IS, as opposed to which SKU it is:
  the list of ingredients, which insumos are linked to each, the combined
  pantry total across every brand of the same thing, create/edit/remove.
  An ingredient can be created BY HAND with no barcode behind it, so a
  recipe can be written down before anything is scanned — it just carries
  a "sem custo" badge until a priced insumo is linked.
- `clientes.html` — the contact record behind an evento: full-field create/
  edit/delete, the eventos + pagamentos rollup for that cliente, and a
  `wa.me`-based "Enviar WhatsApp" composer.
- `eventos.html` — the evento pipeline: a `clientes` picker (with a
  "Ver cliente" link into the full record on `clientes.html`), the full
  Lead→Orçamento→Confirmado→Entregue→Cancelado status, line items
  (produto/serviço) with cost and price, and an editable payment ledger.
  Confirming a payment auto-posts a receita to Financeiro in the same
  request — the one integration point between the two modules.
- `financeiro.html` — the cost/revenue ledger: every receita and despesa,
  most arriving automatically from Eventos, some logged directly (rent,
  ingredients, marketing) for spending that never passed through an evento.
- `receitas.html` — a Receita formula: yield, safety margin, prep labor,
  ingredient/sub-recipe lines (a recipe can consume another recipe) with
  quantities, the computed cost breakdown, and an ephemeral batch-scaling
  input ("Rendimento Desejado" — never saved, just shows scaled quantities).
- `produtos.html` — a sellable Produto: manufaturado (via a Receita picker)
  or comprado (via an Ingredient picker — a fornecedor-sourced item resold
  as-is, costed the same way a recipe line is), embalagem lines, three
  margin tiers, the full cost→atacado→distribuidor→varejo pricing
  breakdown, and the reverse "sell at this retail price" calculator.
- `fornecedores.html` — who the household buys from: name/phone/email/
  notes, a `wa.me` WhatsApp composer, and the purchase history read
  through `fornecedor_detail` (every inbound stock movement tagged with
  this fornecedor, joined to the insumo — no separate history table).

**Renamed with no redirect stubs, on purpose (2026-08-20).** A stale
bookmark to the old `shopping.html` now 404s, and one to the old
`index.html` now silently shows the dashboard instead of the task list —
both a one-time surprise, chosen over maintaining a redirect forever.

**The ingredient is what an insumo IS, as opposed to which SKU it is** —
three brands of leite condensado are three barcodes and ONE ingredient, and
that link is what will let a recipe ask "tenho leite condensado?" across
brands. It is set BY HAND, from the detail sheet on `insumos.html` or the
chip on each `estoque.html` row, and that is a finding rather than laziness:
Open Food Facts' categories were measured against this catalogue and group
by supermarket shelf (creme de leite, leite em pó and leite condensado all
land under "milk and yogurt"), 8 of 19 insumos have no category at all, and
the two cremes de leite that genuinely ARE one ingredient get different
answers. A wrong link is worse than a blank one, because a recipe would
silently draw down the wrong insumo. The picker instead suggests from the
household's own catalogue — an existing ingredient whose words appear in the
insumo's name is floated up with a `provável` badge. Full reasoning in the
other repo's `CLAUDE.md`.

**The rule that shapes `estoque.html`, and must not be quietly undone:
stock never goes below zero.** Using something that isn't recorded doesn't
mean the pantry owes you one — it means a purchase was never written down,
and that purchase cost money a future finance module will want. So a
consumption that would cross zero is refused by the API (a 200 carrying
`ok:false` plus the shortfall and the last price, because it is an ordinary
outcome and not a transport error), and the page offers to book the
difference as a retroactive `unaccounted_purchase` before completing the
consumption. This was the user's call over both alternatives on the table;
the reasoning is in the other repo's `CLAUDE.md`.

All eight are data-free shells: no Supabase keys, no data baked in. Each
asks for a shared passphrase (stored in `localStorage`, prompted once per
device) and talks only to one Supabase Edge Function, `maga-api`
(deployed in project `opehbckfmfschpvbhxvo`), which holds the
service-role key and checks the passphrase server-side. See
`sbralg/maga-api`'s `CLAUDE.md` for the Edge
Function's source, the Supabase schema, the scheduled task that
populates `tarefas.html`/`hoje.html`'s data every morning, and this whole project's
full change history — that repo is the source of truth for the backend,
this one for the front end.

## Master-copy relationship

**Every page lives ONLY here — there are no mirrors anywhere.** All eight
pages, the shared files, and all six tests have exactly one copy, in this
repo. Edit them directly; there is nothing to sync and no master copy to
update first.

This is a deliberate reversal, not an accident of history. The pages
used to be mastered in `sbralg/maga-api` under
`web/` and copied here, and that arrangement failed exactly the way
duplication does: `shopping.html` was mirrored there on 2026-08-01, this
file went stale about it, and a change made by following the stale note
was one sync away from being silently overwritten. Mirroring traded a
stale-copy risk for a forgot-to-sync risk and collected on it within ten
days. **Do not recreate a mirror in the other repo** — that repo is the
backend (Edge Function, scheduled task, `release/`); this one is the
front end; no file exists in both.

What still lives in `sbralg/maga-api`, and is worth
reading before changing anything here: the `maga-api` Edge Function
source, the Supabase schema, the scheduled task, and the project's full
dated change history in its `CLAUDE.md`.

### Shared files (2026-08-20)

Logic and CSS more than one page needs now lives in `shared-*.js`/
`shared-*.css` files, loaded via plain `<script src>`/`<link>` tags — no
bundler, no build step, still fully data-free. This replaced the old
"duplicate everything verbatim" convention (see Conventions below for
what that changes and what stays the same).

- `shared-api.js` — `API`, `PASS_KEY`, `getPass()`, `api()`, `showLogin()`,
  `handleAuthError()`. A thrown `api()` error carries `unauthorized`,
  `badRequest`, and `body` (the parsed error JSON, when there is one) —
  `body` is how a refusal's structured detail reaches the page. Every page declares `const PAGE_LOGIN = {title,
  subtitle, onSuccess, beforeShow?}` *before* this script tag loads, so
  `showLogin()` can render the right copy without every call site passing
  it in.
- `shared-menu.js` — `MENU_ITEMS` (12 entries) + `MENU_GROUPS` (the three
  section headings the drawer AND `index.html`'s dashboard both render
  from) + the hamburger drawer.
  **This is the file that used to bite**: adding a page used to mean
  hand-editing this array in every other page's copy of it; now it's one
  edit.
- `shared-ui.js` — `esc()`, `confirmModal()`, `promptModal()`,
  `listToast()`/`hideListToast()`.
- `shared-format.js` — `fmtMoney()`, `fmtStockQty()` (0-aware — the
  pantry/catalogue variant), `fmtNetQty()`, `fmtDate()`, `fmtDateTime()`,
  `tidyShouted()`.
- `shared-inputs.js` — the cents-first price field and digits-only
  quantity field (`wirePriceInput()`/`wireQtyInput()` and their helpers),
  `.fields-row` layout, the package-size unit helpers
  (`PACK_UNITS`/`unitOptions()`/`netQtyToFields()`/`fieldsToNetQty()`), and
  the one-grapheme emoji `<input>` helper (`firstGrapheme()`/
  `limitToOneEmoji()`) shared by `compras.html`'s list emoji field and
  `notas.html`'s notebook emoji field.
- `shared-catalog.js`/`shared-catalog.css` — insumos/estoque-only:
  `thumbHtml()`, the ingredient-name matching helpers, and
  `ingredientModal()`. **Not loaded by eventos.html** — a cliente is a
  different entity with different fields, so its picker is its own small
  page-local implementation (`clientePickerModal` in `eventos.html`) rather
  than a forced generalization of the ingredient one.
- `shared-notes.js`/`shared-notes.css` — the notes panel dropped into all
  seven object detail pages (clientes/eventos/produtos/receitas/
  fornecedores/insumos/ingredientes) and reused by `notas.html` for a
  single already-known notebook: `noteTitle()`, `notesPanelHtml()`,
  `wireNotesPanel(container, kind, ref)` (lazily resolves/creates the
  object's notebook server-side — the calling page never handles a
  notebook id directly), and `noteEditModal()`.
- Matching CSS files (`shared-base.css`, `shared-menu.css`,
  `shared-modal.css`, `shared-toast.css`, `shared-inputs.css`) for the
  palette/reset, the menu, the modal shell, the toast, and the compact
  field+prefix control.

**What stays page-local, deliberately**: the `.wrap`/`.page` layout (real
per-page differences), each page's own row rendering and search-matching
(different data shapes), and — unchanged since before this refactor — the
barcode scanner, which lives only in `compras.html`.

Eleven headless Chromium tests, each next to the pages it guards. All serve
the repo root on an ephemeral port and answer `maga-api` from an
in-memory fake, so none touches Supabase nor holds a passphrase.
**There is no CI — run them by hand before pushing.**

- `test/compras.test.js` (renamed from `shopping.test.js`) — the scanner,
  the barcode validation, the scan confirm dialog (including its layout)
  and the add/edit/merge paths. Run it after changing `compras.html`.
- `test/stock.test.js` — the pantry steppers, the zero floor and its
  retroactive-purchase dialog, the recount, the per-insumo queue that
  keeps a double tap from outrunning the floor, search, the price graph,
  the insumo editor, the ingredient picker on both pages, the two-step
  insumo removal and the deep links between the two pages. Run it
  after changing `estoque.html` or `insumos.html`. Its fake keeps a
  **real ledger** and enforces the zero floor the same way the Edge
  Function does — that rule is the whole reason those pages look the way
  they do, so faking it away would leave the interesting half untested.
- `test/tarefas.test.js` / `test/hoje.test.js` — smoke tests added
  alongside the shared-files refactor, since both pages had zero coverage
  before it and the refactor changed real behavior on both (see the dated
  entry below). Cover the passphrase gate, the menu, and each page's core
  flow (create/edit/delete/done/undo for tarefas; day navigation and the
  live action-status overlay for hoje).
- `test/eventos.test.js` — the cliente picker (find-or-create inline), the
  full pipeline walk, line items, the payment ledger and its totals,
  editing/deleting a payment with the linked Financeiro lançamento
  following or surviving correctly, the refusal-then-force evento delete,
  the deep link, and a cliente delete that unlinks without breaking the
  detail sheet. Its fake keeps real relational state across all five
  tables, same reasoning as `stock.test.js`'s ledger.
- `test/financeiro.test.js` — standalone lançamento create/edit/delete,
  the tipo and período filters, and a seeded auto-posted entry's
  "automático" tag and 🔗 deep link back to its evento.
- `test/clientes.test.js` — full-field create/edit/delete (including the
  "N evento(s) unlinked" delete toast), search across name/organização/
  telefone/e-mail, the eventos + pagamentos rollup and its summed totals
  read through `cliente_detail`, the wa.me phone normalization and its
  href, and the deep link. Its fake keeps clientes/eventos/pagamentos as
  real relational state, same reasoning as `eventos.test.js`.
- `test/receitas.test.js` / `test/produtos.test.js` /
  `test/fornecedores.test.js` — the Insumos→Receita→Produto chain: recipe
  create/edit, ingredient and sub-recipe lines, the per-line and batch cost
  math, an ingredient with no purchase history reading as "incomplete"
  rather than a wrong 0, batch scaling (ephemeral, never saved), the
  refusal-first delete when a recipe is in use, the Categoria control that
  creates/removes a linked manufaturado Produto, the produto pricing panel
  and its reverse retail calculator, and a fornecedor's purchase history.
  Their fakes reimplement `receitaCostFor`/`produtoCostFor` line for line,
  same "don't fake away the interesting half" rule as the others.
- `test/ingredientes.test.js` — the list, search across brand names, the
  kind filter, the "sem custo" badge, the combined pantry rollup across
  brands, the duplicate-name refusal on both create and rename, the
  blocked delete while a receita line still references the ingredient, the
  unlink count on a successful one, and creating an ingredient by hand
  with unit/kind editable while unlinked and locked once an insumo is.

## Conventions

- **No build step.** Each `.html` file is a single, complete, static
  page — HTML/CSS/JS all inline in one file. Deploy is `git push` to
  `main`; GitHub Pages serves it directly, no CI.
- **Commit straight to `main` — no feature branches, no pull requests
  in THIS repo (decided 2026-08-12).** `main` is what Pages serves, so
  a change parked on a branch cannot be looked at on a phone; the only
  way to review a UI change here is to have it deployed. Routing that
  through a PR meant the user had to merge before seeing it and then do
  branch surgery whenever it needed another pass. Push the work, let
  them look at the live page, iterate with another commit.
  - Run ALL ELEVEN test files BEFORE pushing, every time — `for t in
    test/*.test.js; do node "$t"; done` (with
    `NODE_PATH=/opt/node22/lib/node_modules` if playwright is only
    installed globally). They all pass as of 2026-08-27; a single FAIL line
    is a real regression, not background noise.
    They are the only gate left between a broken page and the live site.
    Any change to a `shared-*.js`/`shared-*.css` file can touch every
    page that loads it, so run the FULL suite (not just the one page you
    edited) whenever a shared file changes.
  - `sbralg/maga-api` is the opposite — it keeps
    PRs. Nothing there is served straight from `main` to a browser, and
    its `CLAUDE.md` is the project's history, which reads better as
    reviewed changes.
- **Shared code lives in `shared-*.js`/`shared-*.css` files (see above),
  loaded via plain `<script src>`/`<link>` tags — not duplicated verbatim
  the way it was before 2026-08-20.** A function/CSS rule with 2+
  consumers and truly identical behavior belongs in a shared file; a
  function that looks similar but has a real behavioral difference (e.g.
  a floor-to-1 quantity formatter vs. a 0-aware one) stays two separately-
  named functions rather than being merged into one with a hidden
  branch — see the shared-format.js file comment for the worked example.
  A single-consumer helper that merely resembles a shared one (estoque's
  `parseCountInput`, a recount-can-be-zero variant of `parseQtyInput`)
  stays page-local; looking similar is not the same as being the same
  thing.
  - `MENU_ITEMS` lives in `shared-menu.js` now — adding a page means
    adding **one** entry, not hand-editing eight copies of the array.
  - What is still deliberately NOT shared: the barcode scanner. It lives
    only in `compras.html` — ~300 lines of camera, lens-picking and focus
    code that would be a genuine maintenance trap in a second copy.
    Estoque finds a product by search instead. Also not shared:
    `eventos.html`'s cliente picker, on purpose (see "Shared files" above).
- **Every mutating action should update the DOM in place and fire its
  API call in the background**, only reverting the change (or, for
  destructive actions, re-inserting the same detached DOM node) and
  showing an alert on failure. A full-page reload
  (`root.innerHTML = 'Carregando…'` + refetch) should be the exception,
  not the default — still used for full-screen transitions (loading a
  page, session expiry) but not for a single item's rename/delete/add/
  toggle.
- Native `prompt()`/`confirm()` dialogs for user *decisions* are
  replaced with in-page modals (`confirmModal()`, `promptModal()`,
  purpose-built ones like `openEditModal`/`openListEditModal`). Plain
  `alert()` is still used for simple one-button validation/error
  messages (e.g. "texto não pode ficar vazio", "não foi possível
  salvar") — that's an intentional distinction, not an inconsistency.
- Summary/UI language: pt-BR. Code/comments: English.
