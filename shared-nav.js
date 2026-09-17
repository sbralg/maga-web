// shared-nav.js — navHeader()/wireNav(), replacing 11 hand-written
// navHeader() copies and 9 byte-identical wireNav() copies. Load this
// AFTER shared-menu.js (wireNav() calls wireMenuButton(), defined there).
//
// The per-page signature had already drifted four ways before this file
// existed: navHeader(title, backAction) (most detail pages),
// navHeader(title, backAction, emoji) (compras.html's list-emoji badge),
// navHeader(title, backAction, icon) (notas.html's notebook icon),
// navHeader(title) (estoque.html, no subheader ever), and navHeader()
// (financeiro.html, no subheader, no title argument at all). One
// signature below covers all five call shapes via an options object.
//
// navHeader(title, opts) — opts is optional:
//   backLabel   — text after "← " in the subheader's back button
//                 (e.g. "Clientes"). Only rendered when opts is given.
//   backAction  — if present, wireNav() will attach this as the back
//                 button's click handler. Presence of `opts` (not
//                 specifically backAction) is what decides whether a
//                 subheader renders at all — a page mid-load with no
//                 record yet (e.g. "not found") still wants the back row.
//   titleClass  — CSS class for the right-hand <h2>. Defaults to
//                 "detail-title" (shared-page.css). Pass a page-local
//                 class only if a page's title needs bespoke styling.
//   icon        — optional emoji/icon rendered before the title, wrapped
//                 in .detail-title-wrap/.nb-icon (shared-page.css).
//   listTitle   — the module name shown in the h1 while a subheader is
//                 present (e.g. "Clientes" while looking at one cliente).
//                 Without opts, the h1 is just esc(title).
//
// With no opts: renders just the top <header> row (hamburger, h1, brand
// mark) — the plain list-screen case (estoque.html, financeiro.html).
//
// With opts: the h1 becomes esc(opts.listTitle) and a .subheader follows,
// carrying the back button (id="back") and, when `title` is truthy, the
// record's own name as the right-hand <h2 id="detail-title">.
function navHeader(title, opts){
  const topRow = '<header><div class="hleft">' +
    '<button class="menu-btn" id="menu-btn" aria-label="Menu">☰</button>' +
    '<h1>' + esc(opts ? opts.listTitle : title) + '</h1>' +
    '</div><a class="brand-mark" href="index.html"><img src="assets/logo-badge.svg" alt="Magá"></a></header>';
  if(!opts) return topRow;

  const titleClass = opts.titleClass || "detail-title";
  const iconHtml = opts.icon ? '<span class="nb-icon">' + esc(opts.icon) + '</span>' : "";
  const titleHtml = title
    ? '<span class="detail-title-wrap">' + iconHtml +
      '<h2 class="' + titleClass + '" id="detail-title">' + esc(title) + '</h2></span>'
    : "";
  return topRow + '<div class="subheader">' +
    '<button class="link" id="back">← ' + esc(opts.backLabel || "") + '</button>' +
    titleHtml +
  '</div>';
}

// Byte-identical across the 9 pages that had it. `backAction` is the
// function to run when the back button is tapped — omitted (or falsy)
// for a plain list-screen render with no subheader/back button in the DOM.
function wireNav(backAction){
  wireMenuButton();
  if(backAction) document.getElementById("back").addEventListener("click", backAction);
}
