// shared-prefs.js — the client for the MCP server's /preferences endpoint.
//
// Everything here talks to the jump host (MCP_BASE in shared-api.js), NOT to
// maga-api: preferences are per-person and gated by the OAuth login, while
// maga-api's passphrase is one flat per-environment secret. Two different
// authorities, so two different endpoints.
//
// Reads are cached in localStorage. That is not a speed optimisation - the
// jump host is a VM on a desktop that sleeps at night, so a page that needed
// a live call to know its own settings would break every evening. Writes are
// the only thing that genuinely requires the host to be awake.

const PREFS_CACHE_KEY = "maga_prefs_cache";

class PrefsAuthError extends Error {
  constructor(message){ super(message); this.name = "PrefsAuthError"; }
}

// A 428 is NOT a failure and not a permissions problem: the request was
// legitimate and well-formed, and the only thing missing is a step the
// person can complete and retry. Typed separately so the page offers
// "confirme sua senha" instead of an error.
class PrefsReauthError extends Error {
  constructor(message){ super(message); this.name = "PrefsReauthError"; }
}

function cachedPreferences(){
  try { return JSON.parse(localStorage.getItem(PREFS_CACHE_KEY) || "null"); } catch(_){ return null; }
}

function cachePreferences(data){
  try { localStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(data)); } catch(_){ /* private mode - reads just go live every time */ }
}

// A 401 here means the token expired or the server restarted, NOT that the
// person lacks access - the page turns it into "sign in again", never into a
// generic failure that leaves someone wondering what they did wrong.
async function mcpFetch(path, options = {}){
  const token = getMcpToken();
  if(!token) throw new PrefsAuthError("Sem sessão ativa.");
  const res = await fetch(MCP_BASE + path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: "Bearer " + token,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if(res.status === 401) throw new PrefsAuthError("Sessão expirada.");
  let body = null;
  try { body = await res.json(); } catch(_){ /* a proxy error page, not JSON */ }
  if(res.status === 428) throw new PrefsReauthError((body && body.message) || "Confirme sua senha.");
  if(!res.ok){
    const err = new Error((body && body.message) || ("Erro " + res.status));
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/**
 * Live preferences, falling back to the cached copy when the jump host is
 * unreachable. Returns {data, stale} so the page can say so out loud rather
 * than showing month-old values as if they were current.
 */
async function loadPreferences(){
  try {
    const data = await mcpFetch("/preferences");
    cachePreferences(data);
    return { data, stale: false };
  } catch(e){
    if(e instanceof PrefsAuthError) throw e;
    const cached = cachedPreferences();
    if(cached) return { data: cached, stale: true, reason: e.message };
    throw e;
  }
}

/** Save one section. The server answers with the new effective values, and
 *  the page renders THOSE rather than what it just sent - so a value the
 *  server normalised (a phone number typed with spaces, say) shows up the
 *  way it was actually stored. */
async function savePreferenceSection(section, body){
  const data = await mcpFetch("/preferences/person/" + encodeURIComponent(section), {
    method: "PUT",
    body: JSON.stringify(body),
  });
  const cached = cachedPreferences();
  if(cached){
    cachePreferences({ ...cached, effective: data.effective, overrides: data.overrides });
  }
  return data;
}

/** Save one section of ONE environment's "Aplicativo" settings (menu
 *  visibility, landing page - phase 3). Unlike savePreferenceSection, the
 *  cache update is scoped to just that environment's entry inside
 *  prefs.environments, not the whole cached blob. */
async function savePreferenceEnvironmentSection(envId, section, body){
  const data = await mcpFetch(
    "/preferences/environment/" + encodeURIComponent(envId) + "/" + encodeURIComponent(section),
    { method: "PUT", body: JSON.stringify(body) }
  );
  const cached = cachedPreferences();
  if(cached && Array.isArray(cached.environments)){
    cachePreferences({
      ...cached,
      environments: cached.environments.map(e => e.id === envId ? { ...e, effective: data.effective } : e),
    });
  }
  // The load-bearing part of this fix: PREFS_CACHE_KEY above is only ever
  // read by THIS page on its own next load - it does nothing for the menu
  // shared-menu.js renders on every page. ENV_CACHE_KEY is what the menu
  // actually reads (see shared-api.js's currentEnvPrefs()), and nothing
  // else refreshes it after login - so without this call, a hidden page
  // kept showing until the next full login (real bug, reported live).
  updateCachedEnvPrefs(envId, data.effective);
  return data;
}

async function loadWhatsappGroups(){
  return await mcpFetch("/preferences/whatsapp/groups");
}

/** The 1:1 conversations this person's WhatsApp has actually seen recently -
 *  the excludedUsers counterpart to loadWhatsappGroups() above, same shape
 *  ({contacts:[{jid,label,avgPerDay}], reachable}). */
async function loadWhatsappRecentContacts(){
  return await mcpFetch("/preferences/whatsapp/recent-contacts");
}

/** Who a number belongs to, so an allow-list entry can be checked before it
 *  is committed. A wrong digit is otherwise invisible until a message
 *  reaches a stranger. */
async function lookupWhatsappContact(number){
  return await mcpFetch("/preferences/whatsapp/contact?number=" + encodeURIComponent(number));
}

/** Find a contact by name instead of a number - the other half of Verificar
 *  for someone whose number you don't have memorized. Backed by whatsmeow's
 *  own synced contacts, so it can only ever find someone the household has
 *  already exchanged a phone-number-based JID with - not WhatsApp's newer
 *  @username handles, which this stack has no way to resolve at all. */
async function searchWhatsappContacts(name){
  return await mcpFetch("/preferences/whatsapp/contact-search?name=" + encodeURIComponent(name));
}

async function changePassword(currentPassword, newPassword){
  return await mcpFetch("/preferences/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

async function loadSessions(){
  return await mcpFetch("/preferences/sessions");
}

async function revokeOtherSessions(){
  return await mcpFetch("/preferences/sessions/revoke-others", { method: "POST", body: "{}" });
}

async function exportPreferences(){
  return await mcpFetch("/preferences/export");
}

async function importPreferences(payload){
  return await mcpFetch("/preferences/import", { method: "POST", body: JSON.stringify(payload) });
}

// Forces the login form to appear again. /logout clears the short-lived
// mcp_login bridge cookie, WITHOUT which /authorize would silently re-approve
// from the existing session and hand back a token whose authTime is just as
// old as the one that was refused. Deliberately not logoutMcpSession(): that
// also drops the maga-api passphrase and environment cache, signing the
// person out of the whole app to change one setting.
function startPreferencesReauth(){
  const back = new URL(location.href);
  back.searchParams.set("reauth", "1");
  location.href = MCP_BASE + "/logout?return=" + encodeURIComponent(back.href);
}
