// shared-ui.js — generic dialog/escaping helpers with no data-shape opinions:
// esc() for safe interpolation, confirmModal()/promptModal() for the two
// generic decision dialogs every page needs, listToast()/hideListToast()
// for a transient status pill. Purpose-built modals (product editor, the
// ingredient/cliente pickers, etc.) stay page-local — these are only the
// pieces that are truly the same everywhere.

function esc(s){
  return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
}

// hoje.html and tarefas.html are personal (a household's daily triage and
// task checklist) and refuse to load their data at all while the signed-in
// account is looking at a NON-default environment - see isDefaultEnv() in
// shared-api.js. Both pages render this instead of calling api(), so a
// direct link/bookmark to either page can't leak personal data into an
// environment it doesn't belong to.
function personalPageBlockedHtml(){
  return '<p class="msg">Esta página não está disponível para esta conta neste ambiente.</p>' +
    '<p class="msg"><a class="link" href="index.html">Voltar ao início</a></p>';
}

function confirmModal(message, confirmLabel){
  return new Promise(resolve => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML =
      '<div class="modal-card">' +
        '<p>' + esc(message) + '</p>' +
        '<div class="modal-actions">' +
          '<button class="cancel" id="confirm-cancel">Cancelar</button>' +
          '<button class="save danger" id="confirm-ok">' + esc(confirmLabel || "Excluir") + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);
    const close = (result) => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };
    function onKey(e){ if(e.key === "Escape") close(false); }
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", e => { if(e.target === backdrop) close(false); });
    document.getElementById("confirm-cancel").addEventListener("click", () => close(false));
    document.getElementById("confirm-ok").addEventListener("click", () => close(true));
  });
}

function promptModal(title, label, currentValue){
  return new Promise(resolve => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML =
      '<div class="modal-card">' +
        '<h3>' + esc(title) + '</h3>' +
        '<label for="prompt-input">' + esc(label) + '</label>' +
        '<input type="text" id="prompt-input" value="' + esc(currentValue || "") + '">' +
        '<div class="modal-actions">' +
          '<button class="cancel" id="prompt-cancel">Cancelar</button>' +
          '<button class="save" id="prompt-ok">Salvar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);
    const close = (result) => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };
    const ok = () => close(input.value);
    function onKey(e){
      if(e.key === "Escape") close(null);
      if(e.key === "Enter"){ e.preventDefault(); ok(); }
    }
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", e => { if(e.target === backdrop) close(null); });
    document.getElementById("prompt-cancel").addEventListener("click", () => close(null));
    document.getElementById("prompt-ok").addEventListener("click", ok);
    const input = document.getElementById("prompt-input");
    input.focus();
    input.select();
  });
}

// Transient status pill, bottom of the screen. Lazily creates its own
// element so a page that never triggers a toast never pays for one.
let listToastTimer = null;
function listToast(msg, isErr){
  let el = document.getElementById("list-toast");
  if(!el){
    el = document.createElement("div");
    el.id = "list-toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle("err", !!isErr);
  el.classList.add("show");
  clearTimeout(listToastTimer);
  listToastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
function hideListToast(){
  const el = document.getElementById("list-toast");
  if(el) el.classList.remove("show");
  clearTimeout(listToastTimer);
}
