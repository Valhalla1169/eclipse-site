// The live and the staging Supabase project (ADR 0015). Pure: supabase-target.mjs reads
// the two projects, and dev.mjs copies public/.
//
// A project is { url, anonKey }: public/js/config.js for live, supabase/staging.json for
// staging.

export const refOf = (url) => new URL(url).hostname.split(".")[0];

// The staging ref, after a check that it is a project ref and not the live one.
export function stagingRef(live, staging) {
  const ref = refOf(staging.url);
  if (!/^[a-z]{20}$/.test(ref)) throw new Error(`supabase/staging.json: ${staging.url} is not a Supabase project URL.`);
  if (ref === refOf(live.url)) throw new Error("supabase/staging.json names the LIVE project. Nothing was run.");
  return ref;
}

// Replaces each [from, to]. Every `from` must be there, and nothing of the live project
// may be left, so a changed live file stops the dev server instead of serving live.
function swap(file, text, pairs, live) {
  for (const [from, to] of pairs) {
    if (!text.includes(from)) throw new Error(`public/${file} does not contain ${from}, so the dev copy cannot point it at staging. public/_headers and public/js/config.js must name the same project.`);
    text = text.replaceAll(from, to);
  }
  if (text.includes(refOf(live.url)) || text.includes(live.anonKey)) throw new Error(`public/${file} still names the live project after the change to staging.`);
  return text;
}

const origins = (url) => [`https://${new URL(url).host}`, `wss://${new URL(url).host}`];

// The only two files the dev copy of public/ changes: path in public/ -> text -> text.
export function devRewrites(live, staging) {
  const [liveHttps, liveWss] = origins(live.url);
  const [stagingHttps, stagingWss] = origins(staging.url);
  return {
    "_headers": (text) => swap("_headers", text, [[liveHttps, stagingHttps], [liveWss, stagingWss]], live),
    "js/config.js": (text) => swap("js/config.js", text, [[live.url, staging.url], [live.anonKey, staging.anonKey]], live),
  };
}
