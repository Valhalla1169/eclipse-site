import { campaign, expect, ids, open, players, seed, test } from "./helpers.js";
import { expect as baseExpect, test as baseTest } from "@playwright/test";

const { dana } = players;

// These use the raw request client: no fake backend, just what the server sends.
baseTest.describe("what the server publishes", () => {
  const PRIVATE_PATHS = [
    "/DESIGN.md",
    "/CLAUDE.md",
    "/package.json",
    "/wrangler.jsonc",
    "/.git/config",
    "/.env",
    "/supabase/config.toml",
    "/supabase/migrations/0001_initial.sql",
    "/legacy/index.html",
    "/docs/adr/0001-eclipse-supabase-data-model.md",
    "/node_modules/vitest/package.json",
    "/tests/e2e/fake-supabase.js",
  ];

  for (const path of PRIVATE_PATHS) {
    baseTest(`${path} answers with the app shell, never the file`, async ({ request }) => {
      const response = await request.get(path);
      const body = await response.text();
      baseExpect(response.status()).toBe(200);
      baseExpect(body).toContain("<title>Eclipse</title>");
      baseExpect(body).not.toMatch(/eclipse-site|\[auth\]|service_role|\[core\]/);
    });
  }

  baseTest("every response carries the security headers", async ({ request }) => {
    for (const path of ["/", "/login", "/style.css", "/js/app.js", "/campaign/x/play"]) {
      const headers = (await request.get(path)).headers();
      const csp = headers["content-security-policy"];
      baseExpect(csp, path).toContain("default-src 'none'");
      baseExpect(csp, path).not.toMatch(/unsafe-inline|unsafe-eval/);
      baseExpect(csp, path).toContain("frame-ancestors 'none'");
      baseExpect(headers["x-content-type-options"], path).toBe("nosniff");
      baseExpect(headers["x-frame-options"], path).toBe("DENY");
      baseExpect(headers["referrer-policy"], path).toBe("no-referrer");
      baseExpect(headers["x-robots-tag"], path).toContain("noindex");
    }
  });

  baseTest("the app shell has no inline script, style or handler", async ({ request }) => {
    const html = await (await request.get("/")).text();
    baseExpect(html).not.toMatch(/<script(?![^>]*\ssrc=)/i);
    baseExpect(html).not.toMatch(/<style/i);
    baseExpect(html).not.toMatch(/\son[a-z]+\s*=/i);
    baseExpect(html).not.toMatch(/\sstyle\s*=/i);
    baseExpect(html).not.toMatch(/data:/i);
  });

  baseTest("only the public anon key is in the published scripts", async ({ request }) => {
    const roles = [];
    for (const path of ["/js/config.js", "/js/app.js", "/js/auth.js", "/js/data.js"]) {
      const text = await (await request.get(path)).text();
      baseExpect(text, path).not.toMatch(/sb_secret_|postgres(ql)?:\/\//i);
      for (const [, payload] of text.matchAll(/eyJ[\w-]+\.([\w-]+)\.[\w-]+/g)) {
        roles.push(JSON.parse(Buffer.from(payload, "base64url").toString()).role);
      }
    }
    baseExpect(roles).toEqual(["anon"]);
  });
});

test.describe("what the page does with hostile text", () => {
  const evil = `<img src=x onerror="window.__pwned=1">`;

  test("names from the database are shown as text, never as markup", async ({ page }) => {
    await seed(page, {
      mock: {
        profile: { id: ids.player, display_name: evil },
        campaigns: [{ ...campaign, name: "<script>window.__pwned=1</script>Age" }],
      },
      user: dana,
    });
    await open(page, "/");
    await expect(page.locator("#account-name")).toHaveText(evil);
    await expect(page.getByRole("heading", { name: "<script>window.__pwned=1</script>Age" })).toBeVisible();
    expect(await page.locator("#main img, #main script, header img[src='x']").count()).toBe(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });

  test("a code in the URL is shown as text or refused", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile }, user: dana });
    await open(page, "/join/%3Cimg%20src=x%20onerror=alert(1)%3E");
    await expect(page.getByText("That invite link does not look right.")).toBeVisible();
    expect(await page.locator("#main img").count()).toBe(0);
  });
});

test.describe("the policy really is enforced", () => {
  test("an inline script is blocked and reported", async ({ page }) => {
    await seed(page);
    await open(page, "/login");
    await page.addScriptTag({ content: "window.__ran = true;" }).catch(() => {});
    expect(await page.evaluate(() => window.__ran)).toBeUndefined();
    const violations = await page.evaluate(() => JSON.parse(localStorage.getItem("__viol") || "[]"));
    expect(violations.length).toBeGreaterThan(0);
    await page.evaluate(() => localStorage.setItem("__viol", "[]"));
  });

  test("a request to any other origin is blocked", async ({ page }) => {
    await seed(page);
    await open(page, "/login");
    const result = await page.evaluate(() => fetch("https://example.com/").then(() => "sent", () => "blocked"));
    expect(result).toBe("blocked");
    await page.evaluate(() => localStorage.setItem("__viol", "[]"));
  });
});
