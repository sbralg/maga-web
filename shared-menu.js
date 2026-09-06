// shared-menu.js — the hamburger navigation, one array for every page.
// Each page still declares its own `const CURRENT_PAGE = "...";` before
// this script tag loads, matching one of MENU_ITEMS' `page` keys, so the
// active entry renders as a plain label instead of a link to itself.
//
// This is the file that used to bite: adding a page meant hand-editing
// this exact array in every other page's copy of it. Now it's one file.

// `group` is what the drawer (and the dashboard, which reads the same
// three names) prints as a heading before the first item carrying it.
// Twelve destinations in one flat column gave no clue which ones belong to
// the same job — the production chain in particular (Insumos → Receitas →
// Produtos) reads as a chain only once the four pages are sat together
// under one heading. Order still decides everything; the group is a label,
// not a nesting level, so nothing collapses or hides.
const MENU_GROUPS = {
  dia: "Dia a dia",
  producao: "Produção",
  negocio: "Negócio",
  conta: "Conta",
};

const MENU_ITEMS = [
  { page: "home", href: "index.html", emoji: "🏠", label: "Home" },
  { page: "hoje", href: "hoje.html", emoji: "☀️", label: "Hoje", group: "dia" },
  { page: "tarefas", href: "tarefas.html", emoji: "✓", label: "Tarefas", group: "dia" },
  { page: "compras", href: "compras.html", emoji: "🛒", label: "Compras", group: "producao" },
  { page: "estoque", href: "estoque.html", emoji: "📦", label: "Estoque", group: "producao" },
  { page: "insumos", href: "insumos.html", emoji: "🥖", label: "Insumos", group: "producao" },
  { page: "ingredientes", href: "ingredientes.html", emoji: "🧂", label: "Ingredientes", group: "producao" },
  { page: "receitas", href: "receitas.html", emoji: "📖", label: "Receitas", group: "producao" },
  { page: "produtos", href: "produtos.html", emoji: "🏷️", label: "Produtos", group: "producao" },
  { page: "eventos", href: "eventos.html", emoji: "🥂", label: "Eventos", group: "negocio" },
  { page: "clientes", href: "clientes.html", emoji: "👤", label: "Clientes", group: "negocio" },
  { page: "fornecedores", href: "fornecedores.html", emoji: "🚚", label: "Fornecedores", group: "negocio" },
  { page: "financeiro", href: "financeiro.html", emoji: "💰", label: "Financeiro", group: "negocio" },
  { page: "preferencias", href: "preferencias.html", emoji: "⚙️", label: "Preferências", group: "conta" },
];

// The "dia" group (Hoje, Tarefas) is this account's own personal daily
// data - the daily-summary triage and the task checklist - not something
// that belongs on screen while looking at a DIFFERENT, non-default
// environment (see shared-api.js's isDefaultEnv() comment: e.g. Bia opening
// "dev", which is Alexandre's real household data reused as dev data).
// Every menu-item consumer (the drawer here, index.html's dashboard tiles)
// reads through this instead of MENU_ITEMS directly, so the two can't drift.
function visibleMenuItems(){
  return isDefaultEnv() ? MENU_ITEMS : MENU_ITEMS.filter(item => item.group !== "dia");
}

function wireMenuButton(){
  const btn = document.getElementById("menu-btn");
  if(btn) btn.addEventListener("click", openMenu);
}

function openMenu(){
  // The heading is a plain <p class="menu-group">, deliberately NOT a
  // .menu-item: every count and every query over the drawer's destinations
  // keys off that class.
  let lastGroup = null;
  const itemsHtml = visibleMenuItems().map(item => {
    let head = "";
    if(item.group && item.group !== lastGroup){
      head = '<p class="menu-group">' + MENU_GROUPS[item.group] + '</p>';
    }
    lastGroup = item.group || null;
    const body = item.page === CURRENT_PAGE
      ? '<span class="menu-item active">' + item.emoji + ' ' + item.label + '</span>'
      : '<a class="menu-item" href="' + item.href + '">' + item.emoji + ' ' + item.label + '</a>';
    return head + body;
  }).join("");

  const backdrop = document.createElement("div");
  backdrop.className = "menu-backdrop";
  backdrop.innerHTML =
    '<div class="menu-panel" id="menu-panel">' +
      '<div class="menu-brand"><img src="assets/logo-badge.svg" alt="Magá"></div>' +
      itemsHtml +
      '<div class="menu-spacer"></div>' +
      '<button class="menu-item logout" id="menu-logout">🚪 Sair</button>' +
    '</div>';
  document.body.appendChild(backdrop);
  const panel = document.getElementById("menu-panel");
  requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add("open")));

  const close = () => {
    panel.classList.remove("open");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => backdrop.remove(), 250);
  };
  function onKey(e){ if(e.key === "Escape") close(); }
  document.addEventListener("keydown", onKey);
  backdrop.addEventListener("click", e => { if(e.target === backdrop) close(); });
  document.getElementById("menu-logout").addEventListener("click", () => {
    localStorage.removeItem(PASS_KEY);
    close();
    showLogin();
  });
}
