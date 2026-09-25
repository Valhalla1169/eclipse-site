import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Sign-up is enabled for everyone, so the sign-up hook is the only gate (docs/adr/0014).
// It must be on in the project settings, and it must name the function a migration makes.
// config.toml is the live project; staging.config.toml is the staging one (ADR 0015).
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const live = read("supabase/config.toml");
const staging = read("supabase/staging.config.toml");
const migrations = readdirSync(new URL("../../supabase/migrations/", import.meta.url))
  .filter((name) => name.endsWith(".sql"))
  .map((name) => read(`supabase/migrations/${name}`))
  .join("\n");

// The lines of one [section], up to the next section header.
function section(config, name) {
  const lines = config.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `[${name}]`);
  if (start < 0) return null;
  const end = lines.findIndex((line, i) => i > start && /^\s*\[/.test(line));
  const values = {};
  for (const line of lines.slice(start + 1, end < 0 ? undefined : end)) {
    const match = line.match(/^\s*(\w+)\s*=\s*(.+?)\s*$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

const urls = (config) => {
  const auth = section(config, "auth");
  return [JSON.parse(auth.site_url), ...JSON.parse(auth.additional_redirect_urls)];
};

describe.each([
  ["supabase/config.toml", live],
  ["supabase/staging.config.toml", staging],
])("%s", (_name, config) => {
  it("keeps sign-up enabled, because the hook is the gate", () => {
    expect(section(config, "auth").enable_signup).toBe("true");
  });

  it("turns the before-user-created hook on, pointing at the function the migration makes", () => {
    const hook = section(config, "auth.hook.before_user_created");
    expect(hook, "[auth.hook.before_user_created] is missing").not.toBeNull();
    expect(hook.enabled).toBe("true");
    const [, schema, name] = hook.uri.match(/^"pg-functions:\/\/postgres\/(\w+)\/(\w+)"$/) || [];
    expect(schema, `unexpected uri ${hook.uri}`).toBe("public");
    expect(migrations).toMatch(new RegExp(`create function public\\.${name}\\(event jsonb\\) returns jsonb`));
    expect(migrations).toMatch(new RegExp(`grant execute on function public\\.${name}\\(jsonb\\) to supabase_auth_admin;`));
  });
});

describe("the live and staging settings", () => {
  it("send people only to the live site from live, and only to this computer from staging", () => {
    expect(urls(live).every((url) => url.startsWith("https://eclipse.deyderae.dev"))).toBe(true);
    expect(urls(staging).every((url) => /^http:\/\/(localhost|127\.0\.0\.1):8787(\/|$)/.test(url))).toBe(true);
  });

  it("use the same password rules, email rules and sign-up hook", () => {
    for (const name of ["auth.email", "auth.hook.before_user_created"]) {
      expect(section(staging, name), name).toEqual(section(live, name));
    }
    expect(section(staging, "auth").minimum_password_length).toBe(section(live, "auth").minimum_password_length);
  });

  // Staging uses Supabase's built-in mailer; the live SMTP key must never be needed there.
  it("give staging no custom SMTP", () => {
    expect(section(live, "auth.email.smtp")).not.toBeNull();
    expect(section(staging, "auth.email.smtp")).toBeNull();
    expect(staging).not.toContain("env(");
  });
});
