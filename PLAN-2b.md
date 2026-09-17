# Phase 2b — new capabilities (approved plan, not yet built)

Part of the app-wide audit begun 2026-09-17. Phase 0, 1 and 2a are shipped and
written up in `CLAUDE.md`'s own `## Status` entries — **read those first**, they
are the authority on what exists. This file is the plan for what comes next, and
exists in the repo only because the session plan file it came from lives outside
all three repos and does not survive a new sandbox. **Delete this file once 2b
is shipped and its `## Status` entry is written.**

Sibling scope, for orientation: **2c** (error surfacing and in-place updates,
needs a `maga-api` redeploy) and **phases 3–5** (Confirmar compra, live
dashboard, test & tidy) are listed at the bottom of `CLAUDE.md`'s phase 2a entry.

**One loose end in the other repo, unrelated to 2b and not blocking it:**
`maga-api`'s commit `15f9834` ("Record audit phase 0 in CLAUDE.md") sits on
`claude/app-audit-improvements-n54adl` and is **not in that repo's `main`**. That
repo keeps PRs by its own convention, so the phase 0 backend write-up stays
invisible to anyone reading its `main` until one is opened and merged.
Documentation only — no code, no redeploy. Easiest path is to fold it into 2c's
PR, which needs a redeploy anyway.

## Context

2a made the app navigable. 2b makes it *capable*: it closes the gaps where the
backend already supports something the UI has no path to, and the one gap where
an ordinary task is outright impossible.

The sharpest of those: **an insumo can only come into existence by scanning a
barcode.** Bulk flour, loose produce, anything sold unbarcoded simply cannot be
entered, and a new user who opens Insumos first has no way forward at all.
Alongside it, `insumo_category_rename`/`_delete` have been deployed and callable
for weeks with **no caller anywhere** — a category can be created inline and then
never fixed or removed — and the shopping list is still an island nothing else in
the app links into.

Decided with the user: **ship all five items**, as four sequenced commits pushed
as each goes green (this repo's own convention, and the reason 2a reverted to it
— a capability has to be *felt* on the phone). **2b is front-end only: no
`maga-api` change, no migration, no redeploy.**

## What is NOT in 2b — "Usado em" (B7) moved to 2c

B7 was going to surface the reference lists the delete handlers already compute.
**It cannot be done front-end-only.** Each door was checked and is shut:

- `ingredient_delete` (`maga-api` `domains/insumos.ts:302`) returns **counts
  only** — `{error, receita_itens, produto_embalagens}` — never names.
- `receita_delete` (`domains/receitas.ts`) *does* return
  `used_by_receitas`/`used_by_produtos` as names, but only as a **400 refusal**.
  Calling it speculatively to read that list would **delete the recipe** whenever
  it happened to be unused. Not an option.
- No read action carries reverse references: `receita_detail` returns
  `{receita, itens, linked_produto, cost, incomplete}`, and the `receitas` list
  returns only `item_count`.

The one remaining front-end-only route is fetching every `receita_detail` to
build the graph client-side — N+1 calls to answer one question. So B7 needs a
backend field and belongs in **2c**, where it can ride the same redeploy as the
evento/cliente → financeiro cross-links, which are blocked on exactly the same
kind of missing field.

## The work

### 1. `+ Novo insumo` — a synthetic in-store EAN-13

**The decision, made with the user and not to be re-litigated:** a generated
EAN-13 in the **GS1 restricted-circulation range, prefix `2`** — the range GS1
reserves for store-internal codes, so a real retail barcode can never collide.
No schema change; `insumos.gtin` stays the primary key and everything downstream
(`insumo_prices`, `stock_movements`, the ingredient link, the shopping item FK)
is untouched.

**Why this needs no backend change — verified, not assumed:** `insumo_upsert`
(`maga-api` `domains/insumos.ts:22`) validates the gtin *only* through
`normalizeGtin` (`lib/gtin.ts`), which accepts 8/12/13/14 digits and, for ≥12,
requires a correct **GS1 mod-10 check digit**. A correctly-computed `2`-prefixed
13-digit code satisfies it. Everything else `insumo_upsert` reads — `name`,
`brand`, `kind`, `category_id`, `net_qty`, `net_unit` — is exactly what the edit
modal already collects.

- **New `synthGtin()` in `shared-inputs.js`**: `"2"` + 11 random digits + the
  mod-10 check digit. **`compras.html:239` already has `gtinCheckDigitOk()` — a
  *verifier*, not a generator**, and this needs the computation. Per this repo's
  2-consumers rule, put one `gtinCheckDigit(lead)` in `shared-inputs.js`, express
  `gtinCheckDigitOk()` in terms of it, and build `synthGtin()` on top. One copy
  of the weights, not three. (Both pages already load `shared-inputs.js`.)
- **Collision:** 11 random digits is ~1 in 10¹¹ per insert against a catalogue of
  tens of rows — but `insumo_upsert` upserts on conflict, so a collision would
  silently **overwrite** an existing insumo rather than error. So **check first**:
  the page already holds the whole `catalog` array in memory, so regenerate while
  the code is already present locally (bounded retry, then fail with a real
  message). Cheap, and it makes the one genuinely bad outcome impossible.
- **Reuse `insumoEditModal(p, categories)` (`insumos.html:849`) as-is** — handed
  `{}` it renders every field empty, and its `ok()` already validates the name
  and the qty/unit pair. That validation is load-bearing: **an amount with no
  unit is refused rather than defaulted to grams.** It needs only a new `opts`
  argument for the title ("Novo insumo") and a hint. **Do not fork it.**
- **Entry point:** a `+ Novo insumo` button in `renderCatalog()`
  (`insumos.html:381`) as `<button class="primary full addrow-btn">` below the
  list — the bottom-create pattern clientes/fornecedores/produtos/receitas
  already use. This also fixes audit C6's "nothing at all" case for this page and
  gives B15's `estoque.html` empty-state dead end somewhere to point.
- **On save:** `api("insumo_upsert", {gtin: synth, ...edited})`, then
  `listLoaded = false; route.navToDetail(gtin)` — the same
  invalidate-then-navigate the existing edit path uses at `insumos.html:727`, so
  the new insumo opens on its own detail sheet ready for an ingredient link.
- **Say what it is.** A hint in the modal: this insumo has no barcode, so a code
  was generated for it internally. Silent magic numbers are worse than explained
  ones, and the user will meet this gtin on the detail sheet.

### 2. Category CRUD

`insumo_categories` / `_create` / `_rename` / `_delete` are all live and deployed.
`_rename` takes `{id, name}` and returns the row; `_delete` takes `{id}` and
**already returns `insumos_unlinked`**, so the confirm can state the consequence
before committing, the way `ingredient_delete`'s does.

- Categories are themselves typed `ingrediente`/`embalagem` (`INSUMO_KINDS`), so
  any list **must show the kind** — a bare name list would render two different
  "Doces" as duplicates.
- Reachable from `insumos.html`, **not a new page**: a `🏷️ Categorias` control on
  the list screen opening a manage modal (list → rename / remove per row, plus
  create). One screen, no new route, no `MENU_ITEMS` entry.
- Deleting a category **unlinks** insumos rather than blocking — it is purely
  organizational (the load-bearing flag is `kind`, which the recipe pickers filter
  on), and `_delete` already behaves that way. The confirm says how many.
- **`categoryCache` (`insumos.html`) must be invalidated on every rename/delete**,
  or the edit modal keeps offering a category that no longer exists.

### 3. "Adicionar à lista de compras" (B3)

Ends the shopping list's isolation. **Two mechanisms, because the two sources
carry genuinely different things** — this is a real fork, not an inconsistency:

**From `estoque.html` and `insumos.html` — a real barcode.** Use
`shopping_item_scan` with **`remote: false`**, *not* `shopping_item_add`. It is
the merge-aware path: given `{list_id, gtin, quantity, remote:false}` it resolves
the insumo locally (no Open Food Facts round trip), and if the list already has a
row for that gtin it **increments that row instead of creating a duplicate** —
exactly right for "I need another one of these", and behaviour
`shopping_item_add` does not have. Its own comment
(`maga-api` `domains/compras.ts:313`) documents the unchecked-row-wins ordering.

**From `receitas.html` — an ingredient, no barcode.** A receita line carries
`it.ingredient = {id, name, base_unit, kind}` (`RECEITA_ITEM_COLS`); there is no
gtin anywhere on it, so these rows cannot merge by barcode and cannot carry a
price. **Decided with the user: name plus the amount in the size field** —
`shopping_item_add({list_id, name, net_text})`, where `net_text` is the line's
quantity and `base_unit` (e.g. `"450 g"`), which `parseNetText` turns into
`net_qty`/`net_unit`. It reads naturally in the aisle.
**Record the stretch honestly in the write-up:** on a scanned item `net_qty` means
"what comes in one package"; here it means "what I need". That is deliberate
reuse — a later session should not "fix" it.

- All three need a **list picker** (which list?). `shopping_lists` is already the
  list-screen read. Offer existing lists plus create-a-new-one — the
  find-or-create shape `eventos.html`'s cliente picker and `shared-catalog.js`'s
  ingredient picker both use.
- **Remember the last chosen list** in `localStorage` under a **`maga_`-prefixed**
  key (audit E9's lesson: `scan_camera_id` was unprefixed, and every page on
  `sbralg.github.io` shares one localStorage origin). Adding six ingredients one
  at a time must not mean picking the same list six times.
- Receitas should offer **"adicionar todos os ingredientes"** as well as per-line
  — one line at a time is the wrong granularity for planning a bake. Report
  per-item outcomes; a partial failure must not read as total success.

### 4. Search on compras / tarefas / financeiro (B11)

Canonical pattern to copy: `clientes.html:256` for the `.searchrow` markup, and
`clientes.html:228` `matchesSearch()` + `foldSearchText()` — **fold accents on
both sides**, per the 2026-09-06 entry.

- **`financeiro.html` is nearly free.** `render()`/`redraw()` already compute
  `shown = lancamentos.filter(...)` and re-wire rows (`financeiro.html:188`,
  `:236`) — add a term to that predicate and a `.searchrow` above the chips.
- **`tarefas.html`** has `currentRows` + `redrawPendingCard()` (`:338`), the same
  shape. Search filters the pending card; **leave the done-tasks section alone**
  unless it reads oddly, and say in the write-up which was chosen.
- **`compras.html` is the one that must NOT re-render.** Item rows carry deep
  per-row wiring — checkbox, qty stepper, scan-merge, edit modal — attached
  individually via `items.forEach(wireItemRow)` (`:1570`), with newly-added items
  appended and wired one at a time (`:1601`, `:1653`). Re-rendering the card would
  **silently drop all of it**. **Filter by toggling `row.hidden` instead.** Safe
  because `rowForGtin()` (`:1332`) reads the `items` **array**, not the DOM, so
  the scanner's merge logic is unaffected by what is hidden.
  - **Totals stay unfiltered.** `recomputeTotals()` (`:1308`) is about the list,
    not the view; a search box must not appear to change what the trip costs.

### 5. "Limpar comprados" (B12)

There is no bulk-delete action, so this is N × `shopping_item_delete` — fine at
household scale, but build it honestly:

- Shown **only when at least one item is purchased** (the lesson of audit C13's
  permanently half-visible "Concluir selecionados" bar).
- `confirmModal()` naming the count — destructive and not undoable.
- **Report partial failure.** Remove each row as its call succeeds and keep the
  rest on screen; a toast claiming success while three rows survive is worse than
  the error. Recompute totals after.
- **Do not** route a failure through `handleAuthError` unless `e.unauthorized` —
  that exact over-reach was phase 0's A5 bug on this very page.

## Verification

- **Full suite by exit code**, never by grepping stdout (the lesson `1032c51`
  paid for — `compras.test.js` is the one file that pushes a bare label instead of
  `'FAIL: ' + label`, so a real failure printed and still read as green):

  ```
  cd /home/user/maga-web && export NODE_PATH=/opt/node22/lib/node_modules && \
    for t in test/*.test.js; do node "$t" >/dev/null 2>&1 || echo "FAILING: $t"; done
  ```

  **20/20 must exit 0** (that is the current baseline).
- **`synthGtin()` gets a real unit test** — the densest new logic, and pure
  arithmetic: every generated code is 13 digits, starts with `2`, and passes the
  same mod-10 algorithm the backend applies. **Also assert `gtinCheckDigit()`
  against known-good real EAN-13s**, so a broken *test* cannot look like a broken
  generator.
- **Behaviour, not class names**: creating an insumo with no barcode lands it in
  the catalogue and opens its detail; renaming a category updates the edit modal's
  options without a reload; **adding the same insumo to a list twice produces one
  row with quantity 2, not two rows** (the whole reason `shopping_item_scan` was
  chosen over `_add`, so it is the assertion that matters); a receita ingredient
  lands with its amount in the size line; search on compras hides rows **without**
  breaking a checkbox or the qty stepper on a still-visible row; "limpar comprados"
  leaves unpurchased rows and correct totals.
- **Confirm each new assertion fails against the pre-change file** (`git stash`,
  re-run) before trusting it.
- **Geometry**: `scrollWidth === innerWidth` on all 16 pages at 360px and 390px —
  the new `.searchrow`s and create button are new flex children, which is exactly
  the shape of the 2026-09-01 overflow bug.
- **On the phone after each push**: create an insumo for something unbarcoded and
  find it in Estoque; add it to a shopping list twice from two different pages.

## Sequencing

Four commits, pushed as each goes green:

1. `gtinCheckDigit()`/`synthGtin()` in `shared-inputs.js` + `+ Novo insumo` on
   `insumos.html`, with its unit test.
2. Category management on `insumos.html`.
3. "Adicionar à lista de compras" on estoque / insumos / receitas + the shared
   list picker.
4. The three search boxes and "limpar comprados".

Sonnet subagents do the page edits, partitioned by file ownership so no two touch
the same file; verify by exit code independently of what they report. **A subagent
contradicting an assumption is data, not noise** — the phase 1 lesson.
