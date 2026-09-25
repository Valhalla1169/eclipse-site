import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { devRewrites, refOf, stagingRef } from "../../scripts/projects.mjs";
import { LIVE, STAGING } from "../../scripts/supabase-target.mjs";

// Development uses the staging project; the published site names only live (ADR 0015).
const publicDir = new URL("../../public/", import.meta.url);
const read = (path) => readFileSync(new URL(path, publicDir), "utf8");
const rewrites = devRewrites(LIVE, STAGING);
const liveRef = refOf(LIVE.url);
const stagingRefName = refOf(STAGING.url);

function files(dir = "") {
  return readdirSync(new URL(dir, publicDir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name, "/")) : [join(dir, entry.name)],
  );
}

const connectSrc = (headers) => headers.match(/Content-Security-Policy:.* connect-src ([^;]+);/)[1].split(" ");

describe("the two projects", () => {
  it("are different projects", () => {
    expect(stagingRef(LIVE, STAGING)).toBe(stagingRefName);
    expect(stagingRefName).not.toBe(liveRef);
  });

  it("refuses a staging project that is the live one, or not a Supabase URL", () => {
    expect(() => stagingRef(LIVE, LIVE)).toThrow(/LIVE project/);
    expect(() => stagingRef(LIVE, { url: "https://example.com" })).toThrow(/not a Supabase project URL/);
  });

  // A service_role key here would bypass Row Level Security.
  it.each([
    ["live", LIVE],
    ["staging", STAGING],
  ])("the %s key is that project's anon key", (_name, project) => {
    const payload = JSON.parse(Buffer.from(project.anonKey.split(".")[1], "base64url").toString());
    expect(payload).toMatchObject({ role: "anon", ref: refOf(project.url) });
  });
});

describe("public/", () => {
  it("never names the staging project, in any file", () => {
    const all = files();
    const naming = all.filter((name) => {
      const bytes = readFileSync(new URL(name, publicDir));
      return bytes.includes(stagingRefName) || bytes.includes(STAGING.anonKey);
    });
    expect(all).toContain("_headers");
    expect(naming).toEqual([]);
  });
});

describe("the dev copy", () => {
  it("changes only _headers and js/config.js", () => {
    expect(Object.keys(rewrites)).toEqual(["_headers", "js/config.js"]);
  });

  it("lets the CSP connect only to the staging project", () => {
    const headers = rewrites["_headers"](read("_headers"));
    expect(connectSrc(read("_headers"))).toEqual([`https://${liveRef}.supabase.co`, `wss://${liveRef}.supabase.co`]);
    expect(connectSrc(headers)).toEqual([`https://${stagingRefName}.supabase.co`, `wss://${stagingRefName}.supabase.co`]);
    expect(headers).not.toContain(liveRef);
  });

  it("points js/config.js at the staging URL and key", () => {
    const config = rewrites["js/config.js"](read("js/config.js"));
    expect(config).toContain(`SUPABASE_URL = "${STAGING.url}"`);
    expect(config).toContain(`"${STAGING.anonKey}"`);
    expect(config).not.toContain(liveRef);
    expect(config).not.toContain(LIVE.anonKey);
  });

  // It must never serve the live project's policy or keys by mistake.
  it("fails when a file no longer names the live project", () => {
    const headers = read("_headers");
    expect(() => rewrites["_headers"](headers.replaceAll(liveRef, "abcdefghijklmnopqrst"))).toThrow(/does not contain https:\/\//);
    expect(() => rewrites["_headers"](headers.replace(`wss://${liveRef}`, "wss://other"))).toThrow(/does not contain wss:\/\//);
    expect(() => rewrites["js/config.js"](read("js/config.js").replace(LIVE.anonKey, "another-key"))).toThrow(/does not contain/);
  });

  it("fails when the live project is still named after the change", () => {
    const headers = read("_headers") + `\n# see http://${liveRef}.supabase.co\n`;
    expect(() => rewrites["_headers"](headers)).toThrow(/still names the live project/);
  });
});
