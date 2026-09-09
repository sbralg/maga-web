// shared-api.js — talking to maga-api, and the passphrase gate in
// front of it. Zero data, zero keys: API is a public endpoint URL, and the
// passphrase itself lives only in the user's own localStorage.
//
// Loaded first among the shared files, since api()/getPass() are used by
// almost everything else. Each page declares its own PAGE_LOGIN object
// BEFORE this script tag — {title, subtitle, onSuccess, beforeShow?} — so
// showLogin()/handleAuthError() can render the right copy and resume the
// right loader without every call site needing to pass that in.

// The maga-api endpoint. A public URL (no secret), but it selects WHICH
// dataset you reach - e.g. a per-person prod project - so it is overridable
// per browser in localStorage, next to the passphrase. Unset = the default.
const DEFAULT_API = "https://opehbckfmfschpvbhxvo.supabase.co/functions/v1/maga-api";
const API_KEY = "checklist_api";
function getApi(){ return localStorage.getItem(API_KEY) || DEFAULT_API; }
const PASS_KEY = "checklist_pass";
const ENV_CHOICE_KEY = "checklist_env_choice"; // which radio was picked (a real env id, or "padrao" before any account is known)
const ENV_ID_KEY = "checklist_env";            // resolved env id, informational
// The account's own environment list ({defaultEnv, environments:[{id,label}]}),
// cached from GET /web-config right after each OAuth login (see completeOAuth
// below) - the login screen has no way to know these BEFORE a login, since
// /web-config needs a bearer token. Different accounts on the same shared
// device (Alexandre/Bia) can have entirely different lists; this always
// reflects whichever account most recently completed the OAuth flow here.
const ENV_CACHE_KEY = "checklist_envs_cache";

// True unless we can positively tell the current login resolved to a
// NON-default environment for this account. "Can't tell" (no ENV_ID_KEY at
// all - the manual-passphrase "Opções avançadas" path never sets one, same
// as shared-push.js's VAPID lookup - or no cached defaultEnv yet) reads as
// default, on purpose: this only exists to keep one account's personal
// Hoje/Tarefas data from surfacing while looking at a DIFFERENT account's
// environment (e.g. Bia opening "dev", which is the household's real data
// reused as dev data - see maga-infra's people.json comment on
// webEnvironments), not to second-guess the household's own primary path.
function isDefaultEnv(){
  const envId = localStorage.getItem(ENV_ID_KEY);
  if(!envId) return true;
  let cache = null;
  try { cache = JSON.parse(localStorage.getItem(ENV_CACHE_KEY) || "null"); } catch(_){ cache = null; }
  if(!cache || !cache.defaultEnv) return true;
  return envId === cache.defaultEnv;
}

// The current environment's own "Aplicativo" preferences (phase 3 of the
// Preferências plan) - menu visibility and its VAPID public key, read from
// the SAME cache /web-config already populated at login (see completeOAuth
// below), so neither shared-menu.js nor shared-push.js needs a fetch of its
// own for something this basic. Returns null fields when nothing is cached
// yet, which every caller already treats as "nothing hidden"/"no override".
function currentEnvPrefs(){
  const envId = localStorage.getItem(ENV_ID_KEY);
  if(!envId) return { menuHidden: [], landingPage: null, vapidPublicKey: null };
  let cache = null;
  try { cache = JSON.parse(localStorage.getItem(ENV_CACHE_KEY) || "null"); } catch(_){ cache = null; }
  const env = cache && Array.isArray(cache.environments) ? cache.environments.find(e => e.id === envId) : null;
  return {
    menuHidden: (env && env.menuHidden) || [],
    landingPage: (env && env.landingPage) || null,
    vapidPublicKey: (env && env.vapidPublicKey) || null,
  };
}

// OAuth against the Magá MCP server: the front end runs the auth-code +
// PKCE flow, then GET /web-config hands back {apiUrl, passphrase} for the
// signed-in person + chosen environment. No secret lives here (public
// PKCE-only client). See the maga-web client in the mcp-server people.json.
const MCP_BASE = "https://mcp-jump-host.duiker-ghost.ts.net";
const OAUTH_CLIENT_ID = "maga-web";
// The access token from the OAuth login, kept for the pages that talk to the
// MCP server itself rather than to maga-api - today that is preferencias.html.
// sessionStorage, deliberately NOT localStorage: this token carries mcp:send,
// so it is a strictly bigger capability than the maga-api passphrase sitting
// in localStorage, and it should not outlive the tab. The cost is one extra
// login when the Preferências page is opened in a fresh tab, which is the
// right trade for a screen used about once a month.
const MCP_TOKEN_KEY = "maga_mcp_token";
function getMcpToken(){
  try { return sessionStorage.getItem(MCP_TOKEN_KEY) || ""; } catch(_){ return ""; }
}
const OAUTH_REDIRECT = new URL("oauth.html", location.href).href;

function b64url(bytes){
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randToken(n){ const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); }
async function pkceChallenge(verifier){
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(d);
}

function getPass(){ return localStorage.getItem(PASS_KEY) || ""; }

async function api(action, extra){
  const r = await fetch(getApi(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-checklist-pass": getPass() },
    body: JSON.stringify(Object.assign({ action }, extra || {}))
  });
  if(r.status === 401){ const e = new Error("unauthorized"); e.unauthorized = true; throw e; }
  if(!r.ok){
    // 400 means the API rejected the input itself (an unreadable
    // peso/volume, say), which deserves a different message from a
    // connection failure.
    const e = new Error("http " + r.status);
    e.badRequest = r.status === 400;
    // Several refusals carry STRUCTURED detail, not just a message —
    // ingredient_delete reports how many receita/embalagem lines still
    // reference it, receita_delete which recipes and produtos use it. That
    // detail was being thrown away here, so every page could only say
    // "não foi possível". Parsed best-effort: a body that isn't JSON (a
    // proxy error page, say) must not turn a clean 400 into a thrown
    // SyntaxError, so `e.body` is simply absent then.
    try{ e.body = await r.json(); }catch(_){ /* no structured detail */ }
    throw e;
  }
  return await r.json();
}

// PAGE_LOGIN is declared per-page before this script loads:
//   const PAGE_LOGIN = {
//     title: "...", subtitle: "...",
//     onSuccess: () => someLoader(),   // called after a passphrase is entered
//     beforeShow: () => { ... }        // optional, e.g. hiding a sticky bar
//   };
function showLogin(errText){
  if(PAGE_LOGIN.beforeShow) PAGE_LOGIN.beforeShow();
  // The env picker only shows real, known choices - see ENV_CACHE_KEY's
  // comment. Nothing cached yet (first login on this device) or an
  // account with just one environment (e.g. Bia's prod-only setup): no
  // fieldset at all, since there's nothing to choose between.
  let envCache = null;
  try { envCache = JSON.parse(localStorage.getItem(ENV_CACHE_KEY) || "null"); } catch(_){ envCache = null; }
  const envs = (envCache && Array.isArray(envCache.environments)) ? envCache.environments : [];
  const defaultEnvId = envCache ? envCache.defaultEnv : null;
  const choice = localStorage.getItem(ENV_CHOICE_KEY) || defaultEnvId || "padrao";
  const radio = (val, label) =>
    '<label><input type="radio" name="env" value="' + esc(val) + '"' + (choice === val ? " checked" : "") + '> ' + esc(label) +
    (val === defaultEnvId ? ' <span class="env-default">(padrão)</span>' : '') + '</label>';
  const envFieldset = envs.length > 1
    ? '<fieldset class="login-env"><legend>Ambiente</legend>' + envs.map(e => radio(e.id, e.label)).join("") + '</fieldset>'
    : "";
  root.innerHTML =
    '<div class="login">' +
      '<img class="login-logo" src="assets/logo-badge.svg" alt="Magá">' +
      '<h2>' + esc(PAGE_LOGIN.title) + '</h2>' +
      '<p>' + esc(PAGE_LOGIN.subtitle) + '</p>' +
      '<div class="loginerr">' + (errText ? esc(errText) : "") + '</div>' +
      '<button class="primary" id="oauth">Continuar</button>' +
      '<details class="login-adv">' +
        '<summary>Opções avançadas</summary>' +
        envFieldset +
        '<input type="password" id="pw" autocomplete="current-password" placeholder="Senha" />' +
        '<button class="primary" id="enter" disabled>Entrar com senha</button>' +
        '<a class="link" id="reset-mcp-session" href="#">Redefinir sessão salva (trocar de conta)</a>' +
      '</details>' +
    '</div>';
  const pickedEnv = () => (root.querySelector('input[name="env"]:checked') || {}).value || defaultEnvId || "padrao";
  document.getElementById("oauth").addEventListener("click", () => {
    localStorage.setItem(ENV_CHOICE_KEY, pickedEnv());
    startOAuth(pickedEnv());
  });
  const pw = document.getElementById("pw");
  const enterBtn = document.getElementById("enter");
  pw.addEventListener("input", () => { enterBtn.disabled = !pw.value.trim(); });
  const go = () => {
    const v = pw.value.trim();
    if(!v) return;
    localStorage.setItem(PASS_KEY, v);
    localStorage.setItem(ENV_CHOICE_KEY, pickedEnv());
    PAGE_LOGIN.onSuccess();
  };
  enterBtn.addEventListener("click", go);
  pw.addEventListener("keydown", e => { if(e.key === "Enter" && !enterBtn.disabled) go(); });
  document.getElementById("reset-mcp-session").addEventListener("click", (e) => {
    e.preventDefault();
    logoutMcpSession();
  });
}

// Clears every cached credential (this device's saved passphrase/API
// override/chosen environment/cached environment list) AND the MCP
// server's own short-lived mcp_login bridge cookie (see maga-infra's
// oauth/sessionCookie.js) - that cookie is what lets "Continuar" silently
// re-approve for up to 10 minutes after a login, skipping the account/
// password form. A plain "Sair" only clears the local cache (see
// shared-menu.js) and leaves that cookie alone, which is the point: it's
// the FAST path for "close this device's session", and the next OAuth
// login on it stays a one-tap "Continuar". This is the deliberately
// slower, explicit reset for switching accounts on a shared device or not
// trusting whatever just silently re-approved - ENV_CACHE_KEY has to go
// too, or the picker would keep showing the PREVIOUS account's
// environments/default until a full new login overwrote it. A real
// top-level navigation, not fetch() - the cookie is SameSite=Lax, so only
// a genuine top-level GET carries it; a cross-origin fetch() (even with
// credentials:"include") would not.
function logoutMcpSession(){
  localStorage.removeItem(PASS_KEY);
  localStorage.removeItem(API_KEY);
  localStorage.removeItem(ENV_CHOICE_KEY);
  try { sessionStorage.removeItem(MCP_TOKEN_KEY); } catch(_){}
  localStorage.removeItem(ENV_ID_KEY);
  localStorage.removeItem(ENV_CACHE_KEY);
  location.href = MCP_BASE + "/logout?return=" + encodeURIComponent(location.href);
}

// Standard "something went wrong" split: an expired/wrong passphrase goes
// back to the login screen; anything else gets a retry link. `retry` is a
// zero-arg function (its .toString() is inlined into an onclick handler, so
// it must not close over anything the string form would lose).
function handleAuthError(e, retry){
  if(e.unauthorized){
    localStorage.removeItem(PASS_KEY);
    showLogin("Sessão expirada, entre novamente.");
  }else{
    root.innerHTML = '<p class="msg err">Não foi possível carregar agora.</p>' +
      '<p class="msg"><button class="link" onclick="(' + retry.toString() + ')()">Tentar novamente</button></p>';
  }
}

// --- OAuth (auth-code + PKCE) against the Magá MCP server -----------------
// startOAuth kicks off the redirect; completeOAuth (run from oauth.html on
// the way back) trades the code for a token, calls /web-config, resolves
// the chosen environment to {apiUrl, passphrase}, stows both in
// localStorage exactly as the manual path does, and returns to the page
// the user started from.
async function startOAuth(envChoice){
  const verifier = randToken(48);
  const state = randToken(16);
  sessionStorage.setItem("maga_oauth", JSON.stringify({
    verifier, state, envChoice, returnTo: location.href
  }));
  const p = new URLSearchParams({
    response_type: "code",
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: "S256",
    scope: "mcp:read",
    state
  });
  location.assign(MCP_BASE + "/authorize?" + p.toString());
}

async function completeOAuth(){
  const say = (msg, isErr) => {
    const el = document.getElementById("oauth-status");
    if(el){ el.textContent = msg; el.className = isErr ? "err" : ""; }
  };
  const back = () => {
    const el = document.getElementById("oauth-status");
    if(el) el.insertAdjacentHTML("afterend", ' <a href="index.html">voltar</a>');
  };
  const q = new URLSearchParams(location.search);
  let st = {};
  try { st = JSON.parse(sessionStorage.getItem("maga_oauth") || "{}"); } catch(_){}
  sessionStorage.removeItem("maga_oauth");
  if(q.get("error")){ say("Falha na autenticação: " + q.get("error"), true); back(); return; }
  const code = q.get("code");
  if(!code || !st.state || q.get("state") !== st.state){ say("Resposta de login inválida.", true); back(); return; }
  try {
    const tr = await fetch(MCP_BASE + "/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: st.verifier,
        redirect_uri: OAUTH_REDIRECT,
        client_id: OAUTH_CLIENT_ID
      })
    });
    if(!tr.ok) throw new Error("token " + tr.status);
    const { access_token } = await tr.json();
    try { sessionStorage.setItem(MCP_TOKEN_KEY, access_token); } catch(_){ /* private mode - the prefs page just asks for a fresh login */ }
    const cr = await fetch(MCP_BASE + "/web-config", { headers: { Authorization: "Bearer " + access_token } });
    if(!cr.ok) throw new Error("web-config " + cr.status);
    const cfg = await cr.json();
    // Cached BEFORE resolving `wanted` below, so even a request for an
    // environment this account doesn't have still leaves the login
    // screen's picker knowing the real list for next time.
    try {
      localStorage.setItem(ENV_CACHE_KEY, JSON.stringify({
        defaultEnv: cfg.defaultEnv,
        // apiUrl/passphrase are deliberately NOT cached here - those stay
        // scoped to whichever ONE environment is actually chosen below
        // (API_KEY/PASS_KEY). menuHidden/landingPage/vapidPublicKey are
        // presentation-only (phase 3's own env-tier boundary), safe to
        // cache for every environment the picker lists.
        environments: (cfg.environments || []).map(e => ({
          id: e.id, label: e.label,
          menuHidden: e.menuHidden || [], landingPage: e.landingPage || null, vapidPublicKey: e.vapidPublicKey || null,
        }))
      }));
    } catch(_){ /* localStorage unavailable - the picker just falls back to nothing cached */ }
    const wanted = st.envChoice === "padrao" ? cfg.defaultEnv : st.envChoice;
    const env = (cfg.environments || []).find(e => e.id === wanted);
    if(!env){
      say("Sua conta não tem acesso ao ambiente \"" + wanted + "\".", true); back(); return;
    }
    localStorage.setItem(API_KEY, env.apiUrl);
    localStorage.setItem(PASS_KEY, env.passphrase);
    localStorage.setItem(ENV_ID_KEY, env.id);
    location.replace(st.returnTo || "index.html");
  } catch(e){
    say("Não foi possível concluir o login (" + e.message + ").", true); back();
  }
}
