// shared-ui.js — generic dialog/escaping helpers with no data-shape opinions:
// esc() for safe interpolation, openModal() for the shared accessible-modal
// mechanics (focus trap/restore, scroll lock, Escape/backdrop close) that
// confirmModal()/promptModal() and every purpose-built dialog build on,
// fieldError()/clearFieldError() for inline validation messages, and
// listToast()/hideListToast() for a transient status pill. Purpose-built
// modals (product editor, the ingredient/cliente pickers, etc.) stay
// page-local — these are only the pieces that are truly the same everywhere.

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

// ---- inline field validation ----------------------------------------
//
// ~29 of the app's ~52 alert() calls are VALIDATION ("O nome não pode
// ficar vazio.") — the same message repeated across 10+ files because
// there was no shared mechanism to hang it on the field it's about.
// fieldError() is that mechanism: later per-page passes replace an
// alert() with fieldError(inputEl, msg) one call site at a time.
//
// Idempotent by construction: it looks for an existing sibling
// `.field-error` (keyed by a stable id derived from the input's own id,
// so two different inputs never collide) and updates it in place rather
// than appending a second one on a repeat validation failure.
function fieldErrorIdFor(inputEl){
  // A bare index fallback for an id-less input — still stable across
  // repeated calls on the SAME element (same input, same position),
  // which is all idempotency requires here.
  const key = inputEl.id || 'f' + Array.prototype.indexOf.call(
    inputEl.parentNode ? inputEl.parentNode.children : [], inputEl);
  return 'field-error-' + key;
}

function fieldError(inputEl, message){
  const id = fieldErrorIdFor(inputEl);
  let p = document.getElementById(id);
  if(!p){
    p = document.createElement('p');
    p.id = id;
    p.className = 'field-error';
    inputEl.insertAdjacentElement('afterend', p);
  }
  p.textContent = message;
  inputEl.setAttribute('aria-invalid', 'true');
  inputEl.setAttribute('aria-describedby', id);
  inputEl.focus();
  // Auto-clears on the next edit — a stale "nome não pode ficar vazio"
  // sitting under a field the person has already started fixing is worse
  // than no message at all. { once: true } so this never stacks listeners
  // across repeated fieldError() calls on the same input.
  inputEl.addEventListener('input', () => clearFieldError(inputEl), { once: true });
}

function clearFieldError(inputEl){
  const id = fieldErrorIdFor(inputEl);
  const p = document.getElementById(id);
  if(p) p.remove();
  inputEl.removeAttribute('aria-invalid');
  inputEl.removeAttribute('aria-describedby');
}

// ---- accessible modal mechanics --------------------------------------
//
// confirmModal()/promptModal() below, and ~25 purpose-built modals across
// every page, all built a `.modal-backdrop` by copy-pasting the same
// template — with no role="dialog", no aria-modal, no focus trap, no
// focus restore and no background scroll lock. openModal() is the one
// place that mechanics now lives; a purpose-built dialog can call it
// directly with its own inner HTML instead of re-deriving all of this.
//
// html: the markup for the ".modal-card" (or any root — callers that
//   already build their own ".modal-card" wrapper just pass that markup).
// opts.onClose(result): called once, however the modal closes (Escape,
//   backdrop click, or a caller-triggered close()).
// Returns {backdrop, close(result)} — callers wire their own buttons to
// call close(result) with whatever value they need to resolve/react to.
function openModal(html, opts){
  opts = opts || {};
  const previouslyFocused = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.innerHTML = html;
  // aria-labelledby needs an id to point at — the dialog's own first <h3>
  // is the natural label wherever one exists (confirmModal has none, so
  // it's simply skipped rather than labelling by the message paragraph,
  // which would double as both the label and the described content).
  const heading = backdrop.querySelector('h3');
  if(heading){
    if(!heading.id) heading.id = 'modal-heading-' + Math.random().toString(36).slice(2);
    backdrop.setAttribute('aria-labelledby', heading.id);
  }
  document.body.appendChild(backdrop);
  // Background content must not be scrollable (or, on iOS, rubber-band
  // through) while a modal is open — this repo has never locked it before.
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  function focusableEls(){
    return Array.from(backdrop.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
      'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetParent !== null || el === document.activeElement);
  }

  let closed = false;
  function close(result){
    if(closed) return; // idempotent — Escape and a button click can race
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = prevOverflow;
    // Restore focus to whatever had it before the modal opened — a menu
    // button, a row, whatever triggered this. Guarded: the trigger element
    // can itself have been removed from the DOM by the action the modal
    // just confirmed (e.g. deleting the row that opened it).
    if(previouslyFocused && document.contains(previouslyFocused) && previouslyFocused.focus){
      previouslyFocused.focus();
    }
    if(opts.onClose) opts.onClose(result);
  }

  function onKey(e){
    if(e.key === 'Escape'){ close(opts.escResult); return; }
    if(e.key !== 'Tab') return;
    // Focus trap: Tab/Shift+Tab cycle within the dialog's own focusable
    // elements instead of escaping into the (scroll-locked, but still
    // focusable-by-keyboard) page behind it.
    const els = focusableEls();
    if(els.length === 0) return;
    const first = els[0], last = els[els.length - 1];
    if(e.shiftKey && document.activeElement === first){
      e.preventDefault(); last.focus();
    } else if(!e.shiftKey && document.activeElement === last){
      e.preventDefault(); first.focus();
    }
  }
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', e => { if(e.target === backdrop) close(opts.backdropResult); });

  // Move focus into the dialog on open — otherwise it silently stays on
  // whatever triggered it, behind a now-scroll-locked, now-inert page.
  const initial = focusableEls();
  if(initial.length) initial[0].focus();
  else backdrop.focus && (backdrop.tabIndex = -1, backdrop.focus());

  return { backdrop, close };
}

// confirmModal()/promptModal() keep their EXACT pre-existing signatures and
// resolve values — every page calls them, so neither may change — but now
// build on openModal() for role/aria-modal/focus-trap/focus-restore/scroll-
// lock instead of hand-rolling a second, unlabelled copy of the same thing.
function confirmModal(message, confirmLabel){
  return new Promise(resolve => {
    const html =
      '<div class="modal-card">' +
        '<p>' + esc(message) + '</p>' +
        '<div class="modal-actions">' +
          '<button class="cancel" id="confirm-cancel">Cancelar</button>' +
          '<button class="save danger" id="confirm-ok">' + esc(confirmLabel || "Excluir") + '</button>' +
        '</div>' +
      '</div>';
    // confirmModal has no <h3> to label the dialog with — its own <p> IS
    // the whole content, so aria-modal + the announced text on focus entry
    // (the Cancelar button, which is the first focusable element) is what
    // a screen reader has to go on; that's the same information a sighted
    // user gets, just in a different order.
    const { close } = openModal(html, { escResult: false, backdropResult: false, onClose: resolve });
    document.getElementById("confirm-cancel").addEventListener("click", () => close(false));
    document.getElementById("confirm-ok").addEventListener("click", () => close(true));
  });
}

function promptModal(title, label, currentValue){
  return new Promise(resolve => {
    const html =
      '<div class="modal-card">' +
        '<h3>' + esc(title) + '</h3>' +
        '<label for="prompt-input">' + esc(label) + '</label>' +
        '<input type="text" id="prompt-input" value="' + esc(currentValue || "") + '">' +
        '<div class="modal-actions">' +
          '<button class="cancel" id="prompt-cancel">Cancelar</button>' +
          '<button class="save" id="prompt-ok">Salvar</button>' +
        '</div>' +
      '</div>';
    const { close } = openModal(html, { escResult: null, backdropResult: null, onClose: resolve });
    const input = document.getElementById("prompt-input");
    const ok = () => close(input.value);
    document.getElementById("prompt-cancel").addEventListener("click", () => close(null));
    document.getElementById("prompt-ok").addEventListener("click", ok);
    input.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); ok(); } });
    // openModal() already focused the first focusable element (this input,
    // since it precedes both buttons in the markup) — .select() just adds
    // the pre-existing-value convenience this dialog always had.
    input.select();
  });
}

// Transient status pill, bottom of the screen. Lazily creates its own
// element so a page that never triggers a toast never pays for one.
// role="status" + aria-live="polite": a screen reader announces the new
// text without moving focus or interrupting whatever's being read — the
// right liveness level for "saved" / "removido" feedback that isn't an
// error requiring immediate attention.
let listToastTimer = null;
function listToast(msg, isErr){
  let el = document.getElementById("list-toast");
  if(!el){
    el = document.createElement("div");
    el.id = "list-toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
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
