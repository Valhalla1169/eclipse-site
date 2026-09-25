import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Sign-up is enabled for everyone, so the sign-up hook is the only gate (docs/adr/0014).
// It must be on in the project settings, and it must name the function a migration makes.
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const config = read("supabase/config.toml");
const migrations = readdirSync(new URL("../../supabase/migrations/", import.meta.url))
  .filter((name) => name.endsWith(".sql"))
  .map((name) => read(`supabase/migrations/${name}`))
  .join("\n");

// The lines of one [section], up to the next section header.
function section(name) {
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

describe("supabase/config.toml", () => {
  it("keeps sign-up enabled, because the hook is the gate", () => {
    expect(section("auth").enable_signup).toBe("true");
  });

  it("turns the before-user-created hook on, pointing at the function the migration makes", () => {
    const hook = section("auth.hook.before_user_created");
    expect(hook, "[auth.hook.before_user_created] is missing").not.toBeNull();
    expect(hook.enabled).toBe("true");
    const [, schema, name] = hook.uri.match(/^"pg-functions:\/\/postgres\/(\w+)\/(\w+)"$/) || [];
    expect(schema, `unexpected uri ${hook.uri}`).toBe("public");
    expect(migrations).toMatch(new RegExp(`create function public\\.${name}\\(event jsonb\\) returns jsonb`));
    expect(migrations).toMatch(new RegExp(`grant execute on function public\\.${name}\\(jsonb\\) to supabase_auth_admin;`));
  });
});
