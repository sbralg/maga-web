// shared-inputs.js — typing money and quantities in, as opposed to
// shared-format.js which renders values already fetched. Depends on
// shared-format.js being loaded first (netQtyToFields formats through
// fmtStockQty).
//
// A page-specific variant that ONLY that page needs stays local instead of
// coming here — e.g. estoque.html's parseCountInput (a recount can be
// exactly zero, ordinary quantities can't) has one caller and doesn't
// belong in a shared file just because it looks similar to parseQtyInput.

// Cents-first currency input: the user types digits only and they fill in
// from the right — 1 → 0,01, 12 → 0,12, 123 → 1,23 — so no separator key is
// ever needed, which is what makes it quick on a phone keypad. Everything
// that is not a digit is discarded, which also means the thousand
// separators the formatter adds are ignored on the way back in.
const PRICE_MAX_DIGITS = 9;
function priceDigits(raw){
  return String(raw ?? "")
    .replace(/\D/g, "")
    .slice(0, PRICE_MAX_DIGITS)
    // ALL leading zeros go, not just the ones followed by a digit: that is
    // what lets backspacing walk 0,01 down to an empty field instead of
    // getting stuck on 0,00. It also means a price of exactly zero can't be
    // typed, which is fine — blank already means "unknown".
    .replace(/^0+/, "");
}
// Blank stays blank: an unknown price is not the same as a free item.
function centsToPrice(digits){
  return digits === "" ? null : Number(digits) / 100;
}

// Written back as "5,50" / "1.234,56". This is why the field is type=text
// rather than type=number — a number input's value must be a dot-decimal
// float, so assigning "5,50" to one silently blanks it.
function fmtPriceInput(v){
  if(v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if(!Number.isFinite(n)) return "";
  return n.toLocaleString("pt-BR",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// The price and quantity fields behave the same wherever they appear —
// list row, scan dialog, sale-item modal — so the behaviour is attached by
// these two rather than written out per caller.
function wirePriceInput(el){
  // WHILE TYPING the caret belongs at the far right: digits shift left as
  // they are entered, so any other position edits a slot that is about to
  // mean something else.
  const caretToEnd = () => {
    // A real selection is left alone — collapsing it would turn a replace
    // into an append.
    if(el.selectionStart !== el.selectionEnd) return;
    const end = el.value.length;
    try{ el.setSelectionRange(end, end); }catch(_){ /* not focusable */ }
  };
  // ON TAP the whole amount is selected instead. With cents-first entry the
  // two agree rather than conflict: typing over the selection restarts the
  // amount from the right, so a tap always means "replace this".
  const selectAll = () => { try{ el.select(); }catch(_){ /* not focusable */ } };
  // Selected synchronously, NOT on a timer — click/pointerup fire after the
  // browser places the caret from a tap, so between focus/click/pointerup
  // the tap is fully covered without deferring. A deferred select was a
  // race: it could land after the first keystroke and wipe what had just
  // been typed.
  el.addEventListener("focus", selectAll);
  el.addEventListener("click", selectAll);
  el.addEventListener("pointerup", selectAll);
  el.addEventListener("input", () => {
    el.value = fmtPriceInput(centsToPrice(priceDigits(el.value)));
    caretToEnd();
  });
}

// Digits and at most ONE decimal separator, nothing else. type=number still
// let "e", "+" and "-" through on some browsers, which then read back as an
// empty value. Decimals stay allowed on purpose: "1,5 kg" is a normal
// amount.
function sanitizeQtyInput(raw){
  let s = String(raw ?? "").replace(/[^\d.,]/g, "").replace(/\./g, ",");
  const first = s.indexOf(",");
  if(first !== -1) s = s.slice(0, first + 1) + s.slice(first + 1).replace(/,/g, "");
  return s;
}
// Either separator in, a positive number or null out. Zero is rejected
// here — callers that need to accept a real zero (a pantry recount) use
// their own page-local variant instead of stretching this one.
function parseQtyInput(raw){
  const n = Number(String(raw ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}
function wireQtyInput(el){
  el.addEventListener("input", () => {
    const clean = sanitizeQtyInput(el.value);
    if(clean !== el.value) el.value = clean;
  });
  // Tapping selects what's there, so the next digit replaces the amount
  // instead of landing beside it. Synchronous for the same reason as the
  // price field.
  const selectAll = () => { try{ el.select(); }catch(_){ /* not focusable */ } };
  el.addEventListener("focus", selectAll);
  el.addEventListener("click", selectAll);
  el.addEventListener("pointerup", selectAll);
}

// The units a package-size field offers, and what each one means in the
// g/ml/un pair the catalogue stores. Deliberately shorter than the list
// maga-api's parseNetQuantity accepts (it also takes mg and cl): those
// two never appear on a supermarket package here.
const PACK_UNITS = [
  { value: "kg", label: "kg", mult: 1000, unit: "g"  },
  { value: "g",  label: "g",  mult: 1,    unit: "g"  },
  { value: "L",  label: "L",  mult: 1000, unit: "ml" },
  { value: "ml", label: "ml", mult: 1,    unit: "ml" },
  { value: "un", label: "un", mult: 1,    unit: "un" },
];

// The blank option is the default for a product nothing is known about, and
// it is deliberately NOT a silent "g": typing 1 while the box says 1 kg
// would store a gram of rice and nobody would notice until a recipe did
// the maths.
function unitOptions(selected){
  return '<option value=""' + (selected ? "" : " selected") + '>—</option>' +
    PACK_UNITS.map(u =>
      '<option value="' + u.value + '"' +
      (u.value === selected ? " selected" : "") + '>' + esc(u.label) + '</option>'
    ).join("");
}

// Returns just the first grapheme cluster of a string -- unlike a raw
// character/length check, this correctly treats a compound emoji (skin
// tone modifiers, ZWJ sequences, flags) as a single "character" instead
// of cutting it apart mid-sequence.
function firstGrapheme(str){
  if(!str) return "";
  if(typeof Intl !== "undefined" && Intl.Segmenter){
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const first = seg.segment(str)[Symbol.iterator]().next();
    return first.done ? "" : first.value.segment;
  }
  return Array.from(str)[0] || "";
}

// Live-truncates an emoji <input> to a single grapheme as the user types
// or pastes, instead of just capping length at submit time.
function limitToOneEmoji(input){
  input.addEventListener("input", () => {
    const limited = firstGrapheme(input.value);
    if(input.value !== limited) input.value = limited;
  });
}

// Stored pair -> the two fields, in the unit the packaging would use: 1500 g
// comes back as 1,5 + kg, not 1500 + g. Formats through fmtStockQty rather
// than a list-floored formatter — safe either way, since this only ever
// runs on a value already confirmed > 0 by the guard above it, but
// fmtStockQty is the one that actually exists in every page that loads
// this file.
function netQtyToFields(qty, unit){
  const n = Number(qty);
  if(!Number.isFinite(n) || n <= 0 || !unit) return { qty: "", unit: "" };
  if(unit === "g"  && n >= 1000) return { qty: fmtStockQty(n / 1000), unit: "kg" };
  if(unit === "ml" && n >= 1000) return { qty: fmtStockQty(n / 1000), unit: "L" };
  return { qty: fmtStockQty(n), unit: unit };
}

// The two fields -> the stored pair. Returns null when there is nothing
// usable to store, so "blank" and "invalid" are one case for the caller.
function fieldsToNetQty(rawQty, rawUnit){
  const n = parseQtyInput(rawQty);
  const u = PACK_UNITS.find(x => x.value === rawUnit);
  if(n === null || !u) return null;
  return { net_qty: n * u.mult, net_unit: u.unit };
}

// Standard GS1 mod-10 check digit — the same algorithm maga-api's
// normalizeGtin runs. `lead` is every digit of a GTIN EXCEPT the check
// digit itself (11 for an EAN-13, 7 for an EAN-8, ...). The one shared
// copy: compras.html's gtinCheckDigitOk() (a verifier) is expressed in
// terms of this, and synthGtin() below (a generator) is built on it too —
// one copy of the weights, not several kept in step by hand.
function gtinCheckDigit(lead){
  const d = String(lead).split("").map(Number);
  const sum = d.reverse().reduce((acc, n, i) => acc + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}

// A synthetic EAN-13 for an insumo that has no real barcode — bulk flour,
// loose produce, anything sold unbarcoded. Leads with "2": GS1's
// restricted-circulation range, reserved for exactly this (store-internal
// codes), so a generated code can never collide with a real retail barcode.
// The remaining 11 leading digits are random; the 13th is the check digit,
// so the result passes the same validation maga-api's insumo_upsert runs.
function synthGtin(){
  let lead = "2";
  for(let i = 0; i < 11; i++) lead += Math.floor(Math.random() * 10);
  return lead + gtinCheckDigit(lead);
}
