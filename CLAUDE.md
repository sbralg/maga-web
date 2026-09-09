# CLAUDE.md — maga-web

Context file for Claude Code / Claude sessions working on this repo.

> Renamed 2026-08-31 in the `cowork-*` → `maga-*` big-bang (umbrella:
> **Magá Assistant**; `RENAME.md` in the `maga-api` repo has the full plan).
> **In the dated `## Status` entries below, `maga-api` / `maga-web` /
> `maga-infra` were swept in by that rename — when those entries were written
> the names were `checklist-api` / `cowork-checklist` /
> `cowork-assistant-backend`.**

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
served at https://sbralg.github.io/maga-web/. Twelve pages sharing a
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
  `.fields-row` layout, and the package-size unit helpers
  (`PACK_UNITS`/`unitOptions()`/`netQtyToFields()`/`fieldsToNetQty()`).
- `shared-catalog.js`/`shared-catalog.css` — insumos/estoque-only:
  `thumbHtml()`, the ingredient-name matching helpers, and
  `ingredientModal()`. **Not loaded by eventos.html** — a cliente is a
  different entity with different fields, so its picker is its own small
  page-local implementation (`clientePickerModal` in `eventos.html`) rather
  than a forced generalization of the ingredient one.
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
