// shared-format.js — display formatting for values already fetched, as
// opposed to shared-inputs.js which handles typing them in.
//
// fmtQty had two genuinely different behaviors hiding under one name before
// this file existed: a shopping-list quantity can't be zero (an empty line
// isn't "0 of something", it's nothing), so it floored at 1; a pantry/
// catalogue quantity legitimately CAN be zero (an empty shelf), so it had to
// render "0" rather than lie and say "1". Those stay two different
// functions on purpose — fmtStockQty here (0-aware, pantry/catalogue), and
// a small list-only floor-to-1 formatter that stays local to compras.html,
// since it has exactly one caller and doesn't need to be "shared" at all.

// Folds a string for SEARCH COMPARISON ONLY — never for display, and never
// written back to storage. Lowercases and strips accents/diacritics, so
// "Café"/"cafe" and "Iván"/"Ivan" match each other regardless of which
// spelling was typed or which was stored. `.normalize("NFD")` splits a
// precomposed accented character into its plain base letter plus a
// separate combining mark (U+0300-U+036F); the regex then drops just the
// marks, leaving the base letters untouched. Every page's own search/
// filter function runs BOTH the typed term and the stored value through
// this before comparing — a lone side folded (only the term, or only the
// haystack) would silently stop matching the exact case it exists for.
function foldSearchText(s){
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function fmtMoney(v){
  return new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL" }).format(Number(v) || 0);
}

// Quantity for display: "2", not "2,00" — but "1,5" stays "1,5". Zero is a
// real, ordinary answer here (an out-of-stock product, or a fresh catalogue
// row), so it's rendered as "0" rather than floored up to something untrue.
function fmtStockQty(q){
  const n = Number(q);
  if(!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toLocaleString("pt-BR");
}

// Package size as stored: normalized to g / ml / un by the API, shown back
// in whichever unit reads naturally.
function fmtNetQty(qty, unit){
  const n = Number(qty);
  if(!Number.isFinite(n) || n <= 0 || !unit) return "";
  if(unit === "g" && n >= 1000) return (n / 1000).toLocaleString("pt-BR") + " kg";
  if(unit === "ml" && n >= 1000) return (n / 1000).toLocaleString("pt-BR") + " L";
  return n.toLocaleString("pt-BR") + " " + unit;
}

// Date only, with year — "20/08/2026".
function fmtDate(iso){
  if(!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric" });
}

// Date + time, no year (recent-activity timestamps never need one) —
// "20/08, 14:30". This is the one deliberate, disclosed behavior change
// from this refactor: index.html/hoje.html used to build this by
// concatenating two separate calls with a plain space ("20/08 14:30"), and
// insumos.html used a single combined toLocaleString call, which Intl
// renders with a comma. This file keeps the single-call version — simpler
// code, and insumos.html was the more recently written of the two — so
// tarefas.html's "desde"/"concluída em" lines and hoje.html's "gerado em"/
// report timestamps now show a comma where they used to show a space.
function fmtDateTime(iso){
  if(!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
}

// Same SHOUTED-name rule maga-api applies to product names, used here
// for the BRAND ("LEITE PO NINHO" -> "Leite Po Ninho"). Brands are tidied at
// render rather than on the way in because, unlike the name, a brand is
// never copied onto an editable row and never typed by the user — so the
// stored value can stay exactly as Open Food Facts supplied it. Lives here
// (not shared-catalog.js) since compras.html renders a product's brand too,
// not just the two catalogue pages.
const PT_SMALL_WORDS = ["de","da","do","das","dos","e","com","em","no","na",
  "nos","nas","a","o","as","os","ao","aos","para","sem","por","um","uma"];
function tidyShouted(raw){
  const s = String(raw || "").trim().replace(/\s+/g, " ");
  if(!s || /\p{Ll}/u.test(s)) return s;
  return s.toLowerCase().replace(/\S+/gu, (word, offset) =>
    (offset > 0 && PT_SMALL_WORDS.indexOf(word) >= 0)
      ? word
      : word.charAt(0).toUpperCase() + word.slice(1));
}
