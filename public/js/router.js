// Minimal History-API router. Real URLs, no hash routing, no library.
// The server side of deep links is `not_found_handling: "single-page-application"`
// in wrangler.jsonc, which serves index.html for unknown navigations.

function segments(path) {
  return path.split("?")[0].split("#")[0].split("/").filter(Boolean);
}

// Pure, so it is unit-testable in Node. Returns { name, params } or null.
// A pattern segment starting with ":" captures that segment.
export function matchRoute(pathname, table) {
  const parts = segments(pathname);
  for (const route of table) {
    const pattern = segments(route.pattern);
    if (pattern.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < pattern.length && ok; i++) {
      if (pattern[i].startsWith(":")) {
        try {
          params[pattern[i].slice(1)] = decodeURIComponent(parts[i]);
        } catch {
          ok = false; // malformed %-escape: not a match
        }
      } else if (pattern[i] !== parts[i]) {
        ok = false;
      }
    }
    if (ok) return { name: route.name, params };
  }
  return null;
}

// One check at a time: a leave() that starts while a check waits does nothing, so a
// double click or a second Back press neither asks twice nor moves twice.
export function createLeaveGate({ check, stay }) {
  let waiting = false;
  return async function leave(move, ...args) {
    if (waiting) return;
    waiting = true;
    let allowed;
    try {
      allowed = await check(...args);
    } finally {
      waiting = false;
    }
    if (allowed) await move();
    else stay();
  };
}

// beforeLeave(...args) runs before the view on screen is replaced, and resolves to
// false to keep it. Link clicks, go(), Back and Forward, and refresh() all ask it.
export function createRouter({ table, onRoute, beforeLeave = () => true }) {
  const address = () => location.pathname + location.search;
  let shown = null; // the address of the view on screen

  function render(initial) {
    shown = address();
    onRoute({ path: location.pathname, search: location.search, match: matchRoute(location.pathname, table), initial });
  }

  // Back and Forward change the address before they are checked, so a view that
  // stays puts its own address back.
  const leave = createLeaveGate({
    check: beforeLeave,
    stay: () => {
      if (address() !== shown) history.pushState({}, "", shown);
    },
  });

  const go = (path, { replace = false, initial = false } = {}) =>
    leave(() => {
      if (replace) history.replaceState({}, "", path);
      else history.pushState({}, "", path);
      render(initial);
    });

  // Take over ordinary same-origin link clicks. Leave everything else to the
  // browser: modified clicks, new-tab links, downloads, other origins, and
  // in-page "#" anchors (the skip link).
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link || link.target || link.hasAttribute("download")) return;
    if ((link.getAttribute("href") || "").startsWith("#")) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    event.preventDefault();
    go(url.pathname + url.search);
  });

  // Moving between anchors on one page (the skip link, then Back) keeps the view. So
  // does Back, then Forward, while the check waits.
  const renderIfMoved = () => {
    if (address() !== shown) render(false);
  };
  window.addEventListener("popstate", () => {
    if (address() !== shown) leave(renderIfMoved);
  });

  return {
    // `initial` marks the render for the page the browser just loaded. The app uses it
    // to leave focus alone on first load (so Tab still starts at the skip link) and to
    // move focus to the new heading only on later navigations.
    start: () => render(true),
    go,
    refresh: (...args) => leave(() => render(false), ...args),
    leave,
  };
}
