// shared-notes.js — the notes panel dropped into every object detail page
// (clientes, eventos, produtos, receitas, fornecedores, insumos,
// ingredientes) and reused by notas.html for a single already-known
// notebook. One notebook per object, lazily created server-side the first
// time a note is written against it (see maga-api's domains/notas.ts) —
// this file never needs to know a notebook_id up front, only the object's
// {kind, ref}.
//
// Usage: a page puts `<div class="notes-panel"></div>` where the card
// should render, then calls `wireNotesPanel(el, "cliente", c.id)` after
// its own detail render. Everything after that — load, add, edit, pin,
// delete — is self-contained inside that one element.

// title is optional server-side; when absent, this derives one from the
// first line/words of the body rather than persisting a computed value
// that could go stale the moment the body is edited later (see the
// migration's comment on notes.title). Backs off to a whole word so a
// long single-line note truncates cleanly rather than mid-word.
function noteTitle(note){
  if(note.title) return note.title;
  const first = String(note.body || "").split("\n")[0].trim();
  if(!first) return "(sem título)";
  if(first.length <= 60) return first;
  return first.slice(0, 60).replace(/\s+\S*$/, "") + "…";
}

function notesPanelHtml(){
  return (
    '<div class="note-list"><p class="note-empty">Carregando…</p></div>' +
    '<button class="primary note-add-btn">+ Adicionar</button>'
  );
}

// notebook_create/note_create are newer than a not-yet-redeployed
// maga-api may have — same "bad action" detection ingredientes.html
// already established, reused verbatim so every consumer of this panel
// explains the gap in words instead of a generic failure.
function notesNotDeployed(e){
  return !!(e && e.badRequest && e.body && e.body.error === "bad action");
}

// container: the element notesPanelHtml() was written into (or the panel
// IS the whole container — either works, since every selector below is
// scoped to it). kind/ref: e.g. ("cliente", c.id) or ("insumo", gtin).
async function wireNotesPanel(container, kind, ref){
  const addBtn = container.querySelector(".note-add-btn");
  const listEl = container.querySelector(".note-list");

  let notebookId = null;
  let notes = [];

  function noteRowHtml(n){
    const header = noteTitle(n);
    const body = String(n.body || "");
    // When there's no explicit title AND the derived header IS the whole
    // body (a short, single-line note), showing the body again below
    // would just repeat the same text — skip it. Anything longer or
    // multi-line, or with its own explicit title, gets the full body
    // shown underneath the header line.
    const headerIsFullBody = !n.title && body.trim() === header.trim();
    return (
      '<div class="note-row" data-note-id="' + esc(n.id) + '">' +
        '<div class="note-body-wrap">' +
          '<p class="note-title">' + (n.pinned ? "⭐ " : "") + esc(header) + '</p>' +
          (headerIsFullBody ? "" : '<p class="note-body">' + esc(body) + '</p>') +
          '<p class="note-date">' + esc(fmtDateTime(n.created_at)) +
            (n.updated_at && n.updated_at !== n.created_at
              ? " · editado em " + esc(fmtDateTime(n.updated_at))
              : "") +
          '</p>' +
        '</div>' +
        '<div class="note-actions">' +
          '<button class="icon-btn note-pin" title="' + (n.pinned ? "Desafixar" : "Fixar") + '">' +
            (n.pinned ? "⭐" : "☆") +
          '</button>' +
        '</div>' +
      '</div>'
    );
  }

  function redraw(){
    if(notes.length === 0){
      listEl.innerHTML = '<p class="note-empty">Nenhuma anotação ainda.</p>';
      return;
    }
    listEl.innerHTML = notes.map(noteRowHtml).join("");
    listEl.querySelectorAll("[data-note-id]").forEach(el => {
      const id = el.getAttribute("data-note-id");
      const note = notes.find(n => n.id === id);
      if(!note) return;
      el.querySelector(".note-body-wrap").addEventListener("click", () => openEdit(note));
      el.querySelector(".note-pin").addEventListener("click", (e) => {
        e.stopPropagation();
        togglePin(note);
      });
    });
  }

  // kind === "notebook" is the one exception: `ref` IS a notebook id
  // directly, used by notas.html to open a user-created notebook (which
  // has no {kind, ref} of its own — it isn't backed by any object).
  // Every other kind lazily creates the object's notebook on first load.
  async function load(){
    try{
      const params = kind === "notebook" ? { id: ref } : { kind, ref };
      const res = await api("notebook_detail", params);
      notebookId = res.notebook.id;
      notes = res.notes || [];
      redraw();
    }catch(e){
      listEl.innerHTML = notesNotDeployed(e)
        ? '<p class="note-empty">Anotações ainda não disponíveis — republique a Edge Function.</p>'
        : '<p class="note-empty">Não foi possível carregar as anotações.</p>';
    }
  }

  async function add(){
    const result = await noteAddModal();
    if(!result) return;
    const title = result.title || undefined;
    addBtn.disabled = true;
    try{
      // Once load() has run, notebookId is always known — sending it
      // directly means note_create never needs {kind, ref} at all here.
      const res = await api("note_create", { notebook_id: notebookId, title, body: result.body });
      notebookId = notebookId || res.note.notebook_id;
      notes.unshift(res.note);
      // A newly-added note is never pinned, so it belongs first among
      // its own kind (pinned notes still sort above it) — cheaper than a
      // full re-sort for the one insertion this causes.
      notes.sort((a, b) => (b.pinned - a.pinned) || 0);
      redraw();
    }catch(e){
      listToast(notesNotDeployed(e)
        ? "Anotações ainda não disponíveis — republique a Edge Function."
        : "Não foi possível salvar a anotação.", true);
    }finally{
      addBtn.disabled = false;
    }
  }

  async function togglePin(note){
    const wantPinned = !note.pinned;
    note.pinned = wantPinned; // optimistic
    notes.sort((a, b) => (b.pinned - a.pinned) || 0);
    redraw();
    try{
      await api("note_update", { id: note.id, pinned: wantPinned });
    }catch(_){
      note.pinned = !wantPinned;
      notes.sort((a, b) => (b.pinned - a.pinned) || 0);
      redraw();
      listToast("Não foi possível fixar a anotação.", true);
    }
  }

  async function openEdit(note){
    const result = await noteEditModal(note);
    if(!result) return;
    if(result.action === "delete"){
      const ok = await confirmModal("Excluir esta anotação?");
      if(!ok) return;
      try{
        await api("note_delete", { id: note.id });
        notes = notes.filter(n => n.id !== note.id);
        redraw();
      }catch(_){
        listToast("Não foi possível excluir a anotação.", true);
      }
      return;
    }
    try{
      const res = await api("note_update", {
        id: note.id, title: result.title || null, body: result.body, pinned: note.pinned,
      });
      const idx = notes.findIndex(n => n.id === note.id);
      if(idx >= 0) notes[idx] = res.note;
      notes.sort((a, b) => (b.pinned - a.pinned) || 0);
      redraw();
    }catch(e){
      listToast(e.badRequest ? "O texto da anotação não pode ficar vazio." : "Não foi possível salvar a anotação.", true);
    }
  }

  addBtn.addEventListener("click", add);
  await load();
}

// title/body creator for a brand-new note, opened by the panel's single
// "+ Adicionar" button — no inline fields sit on the page itself, so
// capture is a deliberate tap-then-type instead of always-visible real
// estate on every object detail page. No "Remover" button, since there's
// nothing to remove yet (that's noteEditModal's job, once a note exists).
// Resolves {title, body} | null.
function noteAddModal(){
  return new Promise(resolve => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML =
      '<div class="modal-card">' +
        '<h3>Nova anotação</h3>' +
        '<label for="note-new-title">Título (opcional)</label>' +
        '<input type="text" id="note-new-title" value="">' +
        '<label for="note-new-body">Anotação</label>' +
        '<textarea id="note-new-body" rows="6"></textarea>' +
        '<div class="modal-actions">' +
          '<button class="cancel" id="note-new-cancel">Cancelar</button>' +
          '<button class="save" id="note-new-save">Salvar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);
    const close = (result) => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };
    function onKey(e){ if(e.key === "Escape") close(null); }
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", e => { if(e.target === backdrop) close(null); });
    document.getElementById("note-new-cancel").addEventListener("click", () => close(null));
    document.getElementById("note-new-save").addEventListener("click", () => {
      const title = document.getElementById("note-new-title").value.trim();
      const body = document.getElementById("note-new-body").value.trim();
      if(!body) return; // caller's api() call will 400 on empty anyway, but this avoids the round trip
      close({ title, body });
    });
    document.getElementById("note-new-title").focus();
  });
}

// title/body/pinned editor, with a "Remover" button in the footer —
// mirrors tarefas.html's edit-modal shape (a .remove button pushed left
// via `.modal-actions .remove{margin-right:auto}`, already shared CSS).
// Resolves {action:"save", title, body} | {action:"delete"} | null.
function noteEditModal(note){
  return new Promise(resolve => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML =
      '<div class="modal-card">' +
        '<h3>Editar anotação</h3>' +
        '<label for="note-edit-title">Título (opcional)</label>' +
        '<input type="text" id="note-edit-title" value="' + esc(note.title || "") + '">' +
        '<label for="note-edit-body">Anotação</label>' +
        '<textarea id="note-edit-body" rows="6">' + esc(note.body || "") + '</textarea>' +
        '<div class="modal-actions">' +
          '<button class="remove" id="note-edit-delete">Remover</button>' +
          '<button class="cancel" id="note-edit-cancel">Cancelar</button>' +
          '<button class="save" id="note-edit-save">Salvar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);
    const close = (result) => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };
    function onKey(e){ if(e.key === "Escape") close(null); }
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", e => { if(e.target === backdrop) close(null); });
    document.getElementById("note-edit-cancel").addEventListener("click", () => close(null));
    document.getElementById("note-edit-delete").addEventListener("click", () => close({ action: "delete" }));
    document.getElementById("note-edit-save").addEventListener("click", () => {
      const title = document.getElementById("note-edit-title").value.trim();
      const body = document.getElementById("note-edit-body").value.trim();
      if(!body) return; // caller's api() call will 400 on empty anyway, but this avoids the round trip
      close({ action: "save", title, body });
    });
    document.getElementById("note-edit-body").focus();
  });
}
