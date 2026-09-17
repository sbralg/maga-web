// shared-shopping.js — "which shopping list?" for pages whose own job is
// NOT the shopping list, but which now offer "adicionar à lista de
// compras": estoque.html, insumos.html, receitas.html. compras.html itself
// doesn't need this — it already IS the list screen.
//
// Depends on esc()/listToast() (shared-ui.js), foldSearchText()
// (shared-format.js) and api() (shared-api.js) being loaded first. Load
// shared-shopping.css alongside it for the picker's own classes
// (.pick-list/.pick-opt/...) — deliberately NOT shared-catalog.css's
// .ing-list/.ing-opt: those are documented as scoped to estoque/insumos
// only, and receitas.html is one of this file's three callers.

// A list picked once should not have to be picked again for the next five
// items added in the same visit — audit B3's own note: "adding six
// ingredients one at a time must not mean picking the same list six
// times." Prefixed per gotcha E9 (sbralg.github.io is shared across every
// page's localStorage; an unprefixed key is a real collision risk).
const LAST_SHOPPING_LIST_KEY = "maga_last_shopping_list_id";
function rememberLastShoppingList(id){
  try{ localStorage.setItem(LAST_SHOPPING_LIST_KEY, id); }catch(_){}
}
function lastShoppingListId(){
  try{ return localStorage.getItem(LAST_SHOPPING_LIST_KEY); }catch(_){ return null; }
}

let shoppingListsPickerCache = null;
// Cleared whenever a caller knows the list set changed under it (a create
// from inside this very picker already updates the in-memory array
// directly, so this is only for "reload from scratch next time").
function invalidateShoppingListsCache(){ shoppingListsPickerCache = null; }

// Resolves with the chosen/created list {id,name,emoji,...} or null on
// Cancel/Escape. Same find-or-create shape as shared-catalog.js's
// ingredientModal() (one input filters AND creates), with the
// last-used list sorted first instead of a name-similarity rank — there's
// no name to rank against here, just "which list".
function shoppingListPickerModal(){
  return new Promise(async resolve => {
    let lists;
    try{
      if(!shoppingListsPickerCache) shoppingListsPickerCache = (await api("shopping_lists")).lists || [];
      lists = shoppingListsPickerCache;
    }catch(e){
      listToast("Não foi possível carregar as listas", true);
      return resolve(null);
    }
    const remembered = lastShoppingListId();

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML =
      '<div class="modal-card">' +
        '<h3>Adicionar a qual lista?</h3>' +
        '<label for="slp-q">Lista existente ou nova</label>' +
        '<input type="text" id="slp-q" placeholder="ex: Mercado" autocomplete="off">' +
        '<div class="pick-list" id="slp-list"></div>' +
        '<div class="modal-actions">' +
          '<button class="cancel" id="slp-cancel">Cancelar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);
    const qEl = backdrop.querySelector("#slp-q");
    const listEl = backdrop.querySelector("#slp-list");

    const close = (result) => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };

    function draw(){
      const term = qEl.value.trim();
      const t = foldSearchText(term);
      const shown = lists
        .filter(l => !t || foldSearchText(l.name).indexOf(t) >= 0)
        // Only meaningful while nothing is typed — once there's a filter,
        // the user's own words rank the list, same rule ingredientModal()
        // follows for its likely-match ranking.
        .slice()
        .sort((a, b) => (t ? 0 : (b.id === remembered ? 1 : 0) - (a.id === remembered ? 1 : 0)));
      const exact = lists.some(l => foldSearchText(l.name) === t);

      let html = "";
      if(term && !exact){
        html += '<button type="button" class="pick-opt create" data-create>' +
          '<span class="nm">➕ Criar "' + esc(term) + '"</span></button>';
      }
      html += shown.map(l =>
        '<button type="button" class="pick-opt" data-pick="' + esc(l.id) + '">' +
          '<span class="nm">' + (l.emoji ? esc(l.emoji) + ' ' : '') + esc(l.name) + '</span>' +
          (!t && l.id === remembered ? '<span class="pick-badge">última</span>' : '') +
        '</button>').join("");
      if(!html){
        html = '<p class="msg small">Nenhuma lista ainda. Digite acima para criar a primeira.</p>';
      }
      listEl.innerHTML = html;

      const create = listEl.querySelector("[data-create]");
      if(create){
        create.addEventListener("click", async () => {
          const name = qEl.value.trim();
          if(!name) return;
          try{
            const res = await api("shopping_list_create", { name });
            lists.push(res.list);
            rememberLastShoppingList(res.list.id);
            close(res.list);
          }catch(e){
            listToast("Não foi possível criar a lista", true);
          }
        });
      }
      listEl.querySelectorAll("[data-pick]").forEach(btn => {
        btn.addEventListener("click", () => {
          const list = lists.find(l => l.id === btn.dataset.pick);
          if(list) rememberLastShoppingList(list.id);
          close(list || null);
        });
      });
    }

    function onKey(e){
      if(e.key === "Escape") close(null);
      // Enter takes the obvious action: the last-used list sorts first
      // when nothing is typed, so an empty-field Enter is "the usual one" —
      // the whole point of remembering it at all.
      if(e.key === "Enter"){
        e.preventDefault();
        const first = listEl.querySelector(".pick-opt");
        if(first) first.click();
      }
    }
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", e => { if(e.target === backdrop) close(null); });
    backdrop.querySelector("#slp-cancel").addEventListener("click", () => close(null));
    qEl.addEventListener("input", draw);
    draw();
    qEl.focus();
  });
}
