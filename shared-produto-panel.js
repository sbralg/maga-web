// Shared Produto pricing panel — packaging list, cost breakdown, margins,
// and the reverse retail-price calculator. Used identically by
// produtos.html (rendering its own produto) and receitas.html (rendering a
// Receita's linked_produto), matching the household's spreadsheet, where
// every recipe tab carries this same panel regardless of what else is on
// the page. Genuinely shared UI (not a page-local entity), unlike most of
// this app's duplicated-on-purpose per-page logic — see CLAUDE.md.
//
// Depends on globals already loaded by both pages: api(), esc(),
// fmtStockQty(), fmtMoney(), wireQtyInput()/wirePriceInput(),
// parseQtyInput()/centsToPrice()/priceDigits(), promptModal()/
// confirmModal()/listToast(), handleAuthError().

let _produtoPanelIngredientCache = null;

async function embalagemPickerModal(){
  try{
    if(!_produtoPanelIngredientCache){
      _produtoPanelIngredientCache = (await api("ingredients")).ingredients || [];
    }
  }catch(e){
    if(e.unauthorized) throw e;
    listToast("Não foi possível carregar", true);
    return null;
  }
  const source = _produtoPanelIngredientCache.filter(i => i.kind === "embalagem");
  return new Promise(resolve => {
    let picked = null;
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal-card" id="emb-card"></div>';
    document.body.appendChild(backdrop);
    const card = backdrop.querySelector("#emb-card");
    const close = (result) => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };

    function drawPick(){
      card.innerHTML =
        '<h3>Embalagem</h3>' +
        '<input type="text" id="emb-q" placeholder="Buscar" autocomplete="off">' +
        '<div class="pick-list" id="emb-list"></div>' +
        '<div class="modal-actions"><button class="cancel" id="emb-cancel">Cancelar</button></div>';
      const qEl = card.querySelector("#emb-q");
      const listEl = card.querySelector("#emb-list");
      function draw(){
        const t = qEl.value.trim().toLowerCase();
        const shown = source.filter(x => !t || String(x.name).toLowerCase().indexOf(t) >= 0);
        let html = shown.map(x => '<button class="pick-opt" data-id="' + esc(x.id) + '">' +
          '<span class="nm">' + esc(x.name) + '</span>' +
          (x.base_unit ? '<span class="cnt">por ' + esc(x.base_unit) + '</span>' : '') +
        '</button>').join("");
        if(!html){
          html = '<p class="msg small">Nenhum ingrediente de embalagem ainda.<br>' +
            'Crie um em <a class="link" href="ingredientes.html">Ingredientes</a> ' +
            '(tipo "embalagem"), ou marque um insumo como embalagem em Insumos.</p>';
        }
        listEl.innerHTML = html;
        listEl.querySelectorAll("[data-id]").forEach(btn => {
          btn.addEventListener("click", () => {
            picked = source.find(x => x.id === btn.dataset.id);
            drawQty();
          });
        });
      }
      card.querySelector("#emb-cancel").addEventListener("click", () => close(null));
      qEl.addEventListener("input", draw);
      draw();
      qEl.focus();
    }
    function drawQty(){
      card.innerHTML =
        '<h3>Quantidade por pacote</h3>' +
        '<p class="who">' + esc(picked.name) + '</p>' +
        '<label for="emb-qty">Quantidade' + (picked.base_unit ? " (" + esc(picked.base_unit) + ")" : "") + '</label>' +
        '<span class="field"><input class="num-input" type="text" inputmode="decimal" id="emb-qty" value=""></span>' +
        '<div class="modal-actions">' +
          '<button class="cancel" id="emb-back">Voltar</button>' +
          '<button class="save" id="emb-ok">Adicionar</button>' +
        '</div>';
      const qtyEl = card.querySelector("#emb-qty");
      wireQtyInput(qtyEl);
      card.querySelector("#emb-back").addEventListener("click", drawPick);
      const ok = () => {
        const quantity = parseQtyInput(qtyEl.value);
        if(quantity === null){ fieldError(qtyEl, "Quantidade inválida."); return; }
        close({ ingredient_id: picked.id, quantity });
      };
      card.querySelector("#emb-ok").addEventListener("click", ok);
      qtyEl.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); ok(); } });
      qtyEl.focus();
    }
    function onKey(e){ if(e.key === "Escape") close(null); }
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", e => { if(e.target === backdrop) close(null); });
    drawPick();
  });
}

function embProdutoRowHtml(e, lineCost){
  const ing = e.ingredient;
  const costHtml = lineCost == null
    ? ''
    : '<p class="meta">' + fmtMoney(lineCost) + '</p>';
  return '<div class="item-row" data-emb="' + esc(e.id) + '">' +
    '<span class="badge">📦</span>' +
    '<span class="body">' +
      '<p class="txt">' + esc(ing ? ing.name : "?") + '</p>' +
      '<p class="meta">' + fmtStockQty(e.quantity) + ' ' + esc((ing && ing.base_unit) || "") + ' por pacote</p>' +
      costHtml +
    '</span>' +
    '<span class="row-actions">' +
      '<button class="icon-btn" data-edit-emb title="Editar quantidade">✎</button>' +
      '<button class="icon-btn danger" data-del-emb title="Remover">🗑</button>' +
    '</span>' +
  '</div>';
}

function produtoCostCardsHtml(cost, incomplete){
  const costHtml = cost && cost.custo_total_por_unidade != null
    ? '<div class="card totals-card">' +
        '<div class="totals-grid">' +
          '<div><p class="lbl">Custo (ingredientes)</p><p class="val">' + fmtMoney(cost.custo_ingredientes_pacote) + '</p></div>' +
          '<div><p class="lbl">Custo (embalagem)</p><p class="val">' + fmtMoney(cost.custo_total_embalagem) + '</p></div>' +
          '<div class="t"><p class="lbl">Custo total por pacote</p><p class="val">' + fmtMoney(cost.custo_total_por_unidade) + '</p></div>' +
          '<div><p class="lbl">Preço atacado</p><p class="val">' + fmtMoney(cost.preco_atacado) + '</p></div>' +
          '<div><p class="lbl">Lucro atacado</p><p class="val">' + fmtMoney(cost.lucro_atacado) + '</p></div>' +
          '<div><p class="lbl">Preço distribuidor</p><p class="val">' + fmtMoney(cost.preco_distribuidor) + '</p></div>' +
          '<div><p class="lbl">Lucro distribuidor</p><p class="val">' + fmtMoney(cost.lucro_distribuidor) + '</p></div>' +
          '<div class="t"><p class="lbl">Preço sugerido varejo</p><p class="val">' + fmtMoney(cost.preco_varejo_sugerido) + '</p></div>' +
        '</div>' +
      '</div>'
    : '';
  const warnHtml = incomplete && incomplete.length > 0
    ? '<div class="warn-card"><p>⚠️ Custo incompleto — sem histórico de compra: ' + esc(incomplete.join(", ")) + '</p></div>'
    : '';
  return costHtml + warnHtml;
}

// Renders the whole packaging + cost + reverse-calculator panel into
// containerEl and wires every control. `onChanged` is called after any
// successful mutation (embalagem add/edit/delete) so the caller can
// refetch and re-render with fresh numbers.
function renderProdutoPanel(containerEl, { produto, embalagens, cost, incomplete, onChanged, onAuthError }){
  const embCosts = (cost && cost.custo_embalagens) || {};
  const embHtml = (embalagens || []).length === 0
    ? '<p class="msg small">Nenhuma embalagem ainda.</p>'
    : '<div class="card" id="pp-emb-list">' +
        embalagens.map(e => embProdutoRowHtml(e, embCosts[e.id])).join("") +
      '</div>';

  containerEl.innerHTML =
    produtoCostCardsHtml(cost, incomplete) +
    '<h3>Embalagem</h3>' + embHtml +
    '<button class="primary small alt addrow-btn" id="pp-add-emb">+ Embalagem</button>' +
    (cost
      ? '<h3>Análise final de preço</h3>' +
        '<div class="card reverse-card">' +
          '<label for="pp-rev-varejo">Se você quer vender a varejo por</label>' +
          '<span class="field"><span class="prefix">R$</span>' +
            '<input class="num-input" type="text" inputmode="numeric" id="pp-rev-varejo"></span>' +
          '<div class="reverse-out" id="pp-rev-out"></div>' +
        '</div>'
      : '');

  containerEl.querySelector("#pp-add-emb").addEventListener("click", async () => {
    let added;
    try{
      added = await embalagemPickerModal();
    }catch(e){
      if(e.unauthorized && onAuthError){ onAuthError(e); return; }
      throw e;
    }
    if(!added) return;
    try{
      await api("produto_embalagem_add", Object.assign({ produto_id: produto.id }, added));
      onChanged();
    }catch(e){
      if(e.unauthorized && onAuthError) return onAuthError(e);
      // The one server-only check the picker can't pre-empt: the embalagem
      // ingredient was removed (elsewhere) between opening the picker and
      // confirming it.
      const b = e.body || {};
      listToast(e.badRequest && b.error === "unknown ingredient_id"
        ? "Esse ingrediente de embalagem não existe mais — escolha outro."
        : "Não foi possível adicionar", true);
    }
  });
  containerEl.querySelectorAll("[data-edit-emb]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.closest(".item-row").dataset.emb;
      const e0 = embalagens.find(x => x.id === id);
      const val = await promptModal("Editar quantidade", "Quantidade por pacote", fmtStockQty(e0.quantity));
      if(val === null) return;
      const quantity = parseQtyInput(val);
      if(quantity === null){ listToast("Quantidade inválida", true); return; }
      try{
        await api("produto_embalagem_update", { id, quantity });
        onChanged();
      }catch(e){
        if(e.unauthorized && onAuthError) return onAuthError(e);
        listToast("Não foi possível salvar", true);
      }
    });
  });
  containerEl.querySelectorAll("[data-del-emb]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if(!(await confirmModal("Remover esta embalagem?"))) return;
      const id = btn.closest(".item-row").dataset.emb;
      try{
        await api("produto_embalagem_delete", { id });
        onChanged();
      }catch(e){
        if(e.unauthorized && onAuthError) return onAuthError(e);
        listToast("Não foi possível remover", true);
      }
    });
  });

  if(cost){
    const revEl = containerEl.querySelector("#pp-rev-varejo");
    wirePriceInput(revEl);
    const outEl = containerEl.querySelector("#pp-rev-out");
    revEl.addEventListener("input", () => {
      const target = centsToPrice(priceDigits(revEl.value));
      if(!target){ outEl.innerHTML = ""; return; }
      // Pure client-side arithmetic on the margins already loaded — no
      // round trip, matches the spreadsheet's reverse formula exactly.
      const precoAtacado = target * (1 - Number(produto.margin_varejo));
      const custoNecessario = precoAtacado * (1 - Number(produto.margin_atacado));
      outEl.innerHTML =
        '<p>Então o preço atacado deve ser: <b>' + fmtMoney(precoAtacado) + '</b></p>' +
        '<p>Então o custo do produto deve ser: <b>' + fmtMoney(custoNecessario) + '</b></p>';
    });
  }
}
