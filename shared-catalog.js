// shared-catalog.js — helpers specific to the insumo/ingredient catalogue,
// loaded only by estoque.html and insumos.html (not hoje/tarefas/compras,
// and deliberately NOT by eventos.html either — a cliente is a different
// entity with different fields, and its picker is its own small page-local
// implementation rather than a forced generalization of this one).
//
// Depends on shared-ui.js (esc) and shared-format.js (PT_SMALL_WORDS) being
// loaded first — tidyShouted() itself lives in shared-format.js since
// compras.html needs it too (an insumo's brand is rendered the same tidied
// way on every page that shows one), not just the two catalogue pages.

// Insumo thumbnail: Open Food Facts' front-of-pack image, or a box emoji
// placeholder for a hand-registered insumo. `cls` is an optional extra
// class (insumos.html's detail sheet wants a bigger thumb than its list
// rows do; estoque.html never needs the second argument).
function thumbHtml(p, cls){
  const c = "thumb" + (cls ? " " + cls : "");
  return p.image_url
    ? '<img class="' + c + '" src="' + esc(p.image_url) + '" alt="" loading="lazy">'
    : '<span class="' + c + ' ph">📦</span>';
}

// ---- ingredients ----
//
// The catalogue answers "which SKU is this barcode"; the ingredient answers
// "what is it", which is the question a recipe asks. It is assigned by
// hand, deliberately — Open Food Facts' own categories group by dairy
// shelf rather than by what a recipe would substitute, and 8 of 19
// insumos have no category at all. A wrong link is worse than a blank
// one, so the household decides. The reasoning is in the API's own comment.
function ingredientName(p){
  return (p && p.ingredient && p.ingredient.name) ? p.ingredient.name : "";
}

// Words worth matching an insumo name against, for the picker's suggestion.
// Two characters or fewer is noise ("de", "e"), and digits are sizes.
function nameWords(s){
  return String(s || "").toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && PT_SMALL_WORDS.indexOf(w) < 0);
}

// An existing ingredient whose every word appears in this insumo's name is
// very likely the right answer — a second brand of creme de leite finds the
// first one's ingredient without typing. Only a suggestion: it reorders the
// list, it never picks for you.
function looksLikely(ingName, insumoName){
  const words = nameWords(ingName);
  if(words.length === 0) return false;
  const target = " " + nameWords(insumoName).join(" ") + " ";
  return words.every(w => target.indexOf(" " + w + " ") >= 0);
}

// The picker. One input doing double duty — it filters the existing
// ingredients as you type AND is the name of a new one, because those are
// the same question ("which ingredient is this?") and splitting them into
// two fields would make the common case (it already exists) the slower one.
//
// Resolves with {payload} ready to send to insumo_set_ingredient, or null.
// The list is fetched on first open rather than at page load: most visits
// to either page never touch it.
//
// `opts.showName` (default true) prints the insumo's own name as a `.who`
// line under the title — needed on estoque.html, where the picker opens
// from a chip inline in the row list and the name isn't otherwise visible
// in the dialog; skipped on insumos.html, where the picker opens from the
// insumo's own detail sheet with the name already on screen behind it.
// `opts.onAuthError(e)` is called instead of throwing on a 401, so each
// page can route it through its own handleAuthError/retry loader.
let ingredientCache = null;

function ingredientModal(p, opts){
  opts = opts || {};
  const showName = opts.showName !== false;
  return new Promise(async resolve => {
    let all;
    try{
      if(!ingredientCache) ingredientCache = (await api("ingredients")).ingredients || [];
      all = ingredientCache;
    }catch(e){
      if(e.unauthorized && opts.onAuthError){ opts.onAuthError(e); return resolve(null); }
      listToast("Não foi possível carregar os ingredientes", true);
      return resolve(null);
    }

    const currentId = p.ingredient ? p.ingredient.id : null;
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML =
      '<div class="modal-card">' +
        '<h3>Ingrediente</h3>' +
        (showName ? '<p class="who">' + esc(p.name) + '</p>' : '') +
        '<label for="ing-q">Buscar ou criar</label>' +
        '<input type="text" id="ing-q" placeholder="ex: leite condensado" autocomplete="off">' +
        '<p class="hint">O que este insumo É, para as receitas. Marcas ' +
          'diferentes da mesma coisa compartilham o ingrediente — é assim que ' +
          '"tenho leite condensado?" passa a ter resposta.</p>' +
        '<div class="ing-list" id="ing-list"></div>' +
        '<div class="modal-actions">' +
          '<button class="cancel" id="ing-cancel">Cancelar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);

    const qEl = backdrop.querySelector("#ing-q");
    const listEl = backdrop.querySelector("#ing-list");

    const close = (result) => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };

    function draw(){
      const term = qEl.value.trim();
      const t = foldSearchText(term);
      const shown = all.filter(i => !t || foldSearchText(i.name).indexOf(t) >= 0);
      // A likely match floats to the top only while nothing has been typed —
      // once there is a filter, the user's own words rank the list.
      const ranked = t ? shown : shown.slice().sort((a, b) =>
        (looksLikely(b.name, p.name) ? 1 : 0) - (looksLikely(a.name, p.name) ? 1 : 0));
      const exact = all.some(i => foldSearchText(i.name) === t);

      let html = "";
      if(term && !exact){
        html += '<button class="ing-opt create" data-create>' +
          '<span class="nm">➕ Criar "' + esc(term) + '"</span></button>';
      }
      if(currentId){
        html += '<button class="ing-opt clear" data-clear>' +
          '<span class="nm">✕ Sem ingrediente</span></button>';
      }
      html += ranked.map(i =>
        '<button class="ing-opt' + (i.id === currentId ? ' current' : '') + '" ' +
          'data-pick="' + esc(i.id) + '">' +
          '<span class="nm">' + (i.id === currentId ? '✓ ' : '') + esc(i.name) + '</span>' +
          (!t && i.id !== currentId && looksLikely(i.name, p.name)
            ? '<span class="hintbadge">provável</span>' : '') +
          // How many insumos already point at it — the difference between
          // "this is the one we use" and a near-duplicate typed by mistake.
          '<span class="cnt">' + (i.insumo_count || 0) +
            ((i.insumo_count === 1) ? ' insumo' : ' insumos') + '</span>' +
        '</button>').join("");
      if(!html){
        html = '<p class="msg small">Nenhum ingrediente ainda. Digite acima para criar o primeiro.</p>';
      }
      listEl.innerHTML = html;

      const create = listEl.querySelector("[data-create]");
      if(create){
        create.addEventListener("click", () =>
          close({ payload: { ingredient_name: qEl.value.trim() } }));
      }
      const clear = listEl.querySelector("[data-clear]");
      if(clear) clear.addEventListener("click", () => close({ payload: { ingredient_id: null } }));
      listEl.querySelectorAll("[data-pick]").forEach(btn => {
        btn.addEventListener("click", () => {
          // Picking the one already set is a no-op, not a write.
          if(btn.dataset.pick === currentId) return close(null);
          close({ payload: { ingredient_id: btn.dataset.pick } });
        });
      });
    }

    function onKey(e){
      if(e.key === "Escape") close(null);
      // Enter takes the obvious action: the first row of the list, which is
      // "create" when the typed name is new and the best match when it isn't.
      if(e.key === "Enter"){
        e.preventDefault();
        const first = listEl.querySelector(".ing-opt");
        if(first) first.click();
      }
    }
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", e => { if(e.target === backdrop) close(null); });
    backdrop.querySelector("#ing-cancel").addEventListener("click", () => close(null));
    qEl.addEventListener("input", draw);
    draw();
    qEl.focus();
  });
}
