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

async function loadWhatsappGroups(){
  return await mcpFetch("/preferences/whatsapp/groups");
}
