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

export function createRouter({ table, onRoute }) {
  const current = () => ({
    path: location.pathname,
    search: location.search,
    match: matchRoute(location.pathname, table),
  });

  function go(path, { replace = false, initial = false } = {}) {
    if (replace) history.replaceState({}, "", path);
    else history.pushState({}, "", path);
    onRoute({ ...current(), initial });
  }

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

  window.addEventListener("popstate", () => onRoute({ ...current(), initial: false }));

  // `initial` marks the render for the page the browser just loaded. The app uses it
  // to leave focus alone on first load (so Tab still starts at the skip link) and to
  // move focus to the new heading only on later navigations.
  return { start: () => onRoute({ ...current(), initial: true }), go, current };
}
