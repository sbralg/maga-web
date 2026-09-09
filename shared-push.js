// shared-push.js — Web Push subscribe/unsubscribe on top of the service
// worker shared-pwa.js already registers. Kept as its own file rather than
// folded into shared-pwa.js: not every page needs push (today only
// hoje.html does), and the VAPID public key below is per-environment (dev
// and prod are separate Supabase projects with separate key pairs — see
// maga-api's CLAUDE.md), which shared-pwa.js's service-worker registration
// has no reason to know about.
//
// A push subscription is permanently bound to whichever VAPID public key
// was active when it was created — the push service records it, and any
// future send has to be signed with the matching private key or gets
// rejected. So which key we hand to subscribe() has to match whichever
// project's maga-api will actually be doing the sending.

// Not secret — the whole point of VAPID is that only the matching PRIVATE
// key (held server-side, per project, never here) can sign a real push;
// the public key only tells the browser which server is allowed to try.
const VAPID_PUBLIC_KEYS = {
  dev: "BBK5wKXaPUbvBtHULL4tuVsUJC5C9RmT6ySwXHDUG1EWo5St0sx5PWbQ53kjDeguxI18zQ6sKC4FVBQ13sUmEqE",
  prod: "BCh2n1jvX3vwZqt9JRBcMXAJhU7pC6Q_05_ZkNDlx7I71SJe4B9igoRp4CvBa0lbnbRl8KUyUNseLlfAXescTAU",
};

// The server-provided key (phase 3's environment tier — see /web-config's
// per-environment vapidPublicKey, cached by shared-api.js's
// currentEnvPrefs()) is tried first: once every people.json webEnvironments
// entry sets one, this hardcoded pairing stops being load-bearing at all.
// ENV_ID_KEY (shared-api.js) is the resolved OAuth environment id
// ("dev"/"prod") and is the normal source of truth for the fallback map
// below. The manual-passphrase "Opções avançadas" login path never sets
// it, so as a LAST resort this matches the resolved API host against the
// two known project refs — same two projects either way, just a different
// way of naming which one.
function currentVapidPublicKey(){
  const fromServer = currentEnvPrefs().vapidPublicKey;
  if(fromServer) return fromServer;
  const envId = localStorage.getItem(ENV_ID_KEY);
  if(envId && VAPID_PUBLIC_KEYS[envId]) return VAPID_PUBLIC_KEYS[envId];
  let apiHost = "";
  try { apiHost = new URL(getApi()).host; } catch(_){ /* fall through */ }
  if(apiHost.indexOf("alhcfnhvpcqwpnztbmrx") === 0) return VAPID_PUBLIC_KEYS.prod;
  return VAPID_PUBLIC_KEYS.dev;
}

function b64urlToUint8Array(b64url){
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const base64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for(let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Whether THIS device currently holds a push subscription — read-only,
// used to decide what an opt-in control should say.
async function getPushSubscription(){
  if(!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.ready;
  return await reg.pushManager.getSubscription();
}

// Runs Notification.requestPermission() — a real native "Allow
// notifications?" prompt, which browsers only show in response to an
// actual user gesture (call this from a click handler, never on page
// load — see maga-web's CLAUDE.md on why an unprompted ask gets silently
// downgraded by Chrome's own abuse heuristics). Throws "unsupported" or
// "denied" on failure; the caller decides how to display that.
async function subscribeToPush(){
  if(!("serviceWorker" in navigator) || !("PushManager" in window)){
    throw new Error("unsupported");
  }
  const perm = await Notification.requestPermission();
  if(perm !== "granted") throw new Error("denied");
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: b64urlToUint8Array(currentVapidPublicKey()),
  });
  const subJson = sub.toJSON();
  await api("push_subscribe", { endpoint: subJson.endpoint, keys: subJson.keys });
  return sub;
}

async function unsubscribeFromPush(){
  const sub = await getPushSubscription();
  if(!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  // Best-effort: the subscription is already gone client-side either way,
  // and maga-api self-heals a stale row the next time a send 404s/410s it.
  try { await api("push_unsubscribe", { endpoint }); } catch(_){ /* ignore */ }
}
