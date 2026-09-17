// shared-history.js — one router for the "list screen / detail screen"
// shape every module page in this app has.
//
// WHY THIS EXISTS. Every detail page used to carry the same four lines at
// the top of its load*(): read `?id=` off location.search, call
// history.replaceState() to ERASE it, open the detail, return. Erasing the
// URL is what made the app's two worst navigation bugs:
//
//   - The Android hardware Back button left the PWA from any detail
//     screen, because no page ever pushed a history entry to go back to.
//     Eight pages actively replaceState'd the URL away.
//   - A detail screen could not be bookmarked, shared or returned to. The
//     worst case was compras.html, the one screen used standing in a
//     supermarket aisle, which had no deep link at all — a list opened
//     purely in memory.
//
// So the URL becomes the source of truth for which screen is showing, and
// the three functions below are the only things allowed to change it.
//
// wireHistoryRoute({param, openDetail, renderList, notFound}) returns
// {routeFromUrl, navToDetail, navToList} and registers ONE popstate
// listener. Call it once at the top of a page.
//
//   param      — the query-string key this page routes on ("id", "gtin",
//                "list", "date"). One page, one param.
//   openDetail — (value) => void. Renders the detail screen. Must NOT
//                touch history itself.
//   renderList — () => void. Renders the list screen from whatever is
//                already in memory. Must NOT touch history, and must not
//                re-fetch — popstate calls it on every Back, and a network
//                round trip per Back is exactly the "Carregando…" flash
//                this app has been removing everywhere else.
//   notFound   — optional (value) => void, for an id that isn't there.
//                Defaults to falling back to the list.
function wireHistoryRoute(opts){
  const param = opts.param;

  // Reflects the URL onto the screen. NEVER pushes — it is what popstate
  // calls, and pushing from there would fight the browser's own history.
  function routeFromUrl(){
    const value = new URLSearchParams(location.search).get(param);
    if(value) opts.openDetail(value);
    else opts.renderList();
  }

  // pushState vs replaceState is the one decision here that matters.
  // Re-rendering the detail you are ALREADY on (saving an edit calls
  // open*() again to redraw) must not stack a second identical entry, or
  // Back would appear to do nothing. Same URL => replace, different URL
  // => push.
  function navToDetail(value){
    const url = location.pathname + "?" + param + "=" + encodeURIComponent(value);
    const current = new URLSearchParams(location.search).get(param);
    if(current === String(value)) history.replaceState({ [param]: value }, "", url);
    else history.pushState({ [param]: value }, "", url);
    opts.openDetail(value);
  }

  function navToList(){
    if(new URLSearchParams(location.search).get(param)){
      history.pushState(null, "", location.pathname);
    }else{
      history.replaceState(null, "", location.pathname);
    }
    opts.renderList();
  }

  // An id that no longer exists (a stale bookmark, a record deleted from
  // another device). One convention for the whole app: say so, show the
  // list, and CLEAN THE URL — leaving the bad ?id= in place would repeat
  // the same error on every reload, and re-running it on Back.
  function routeNotFound(message){
    history.replaceState(null, "", location.pathname);
    if(typeof listToast === "function" && message) listToast(message, true);
    opts.renderList();
  }

  window.addEventListener("popstate", routeFromUrl);

  return { routeFromUrl, navToDetail, navToList, routeNotFound };
}
