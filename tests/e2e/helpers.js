import { expect, test as base } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REF = "eosnplpgzqahwgaytauu";

export const ids = {
  player: "00000000-0000-4000-8000-0000000000a1",
  dm: "00000000-0000-4000-8000-0000000000d1",
  campaign: "10000000-0000-4000-8000-000000000001",
};
export const players = {
  dana: { id: ids.player, email: "dana@example.com", profile: { id: ids.player, display_name: "Dana Voss" } },
  dm: { id: ids.dm, email: "dm@example.com", profile: { id: ids.dm, display_name: "The DM" } },
};
export const campaign = { id: ids.campaign, name: "Age of Eclipse", dm_id: ids.dm, created_at: "2026-09-01T00:00:00Z" };
export const GOOD_PASSWORD = "correct horse battery staple";

// Every test runs against the fake Supabase, and fails if the page breaks its own
// Content-Security-Policy or throws.
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.addInitScript({ path: path.join(here, "fake-supabase.js") });
    await use(page);
    const violations = await page.evaluate(() => JSON.parse(localStorage.getItem("__viol") || "[]")).catch(() => []);
    expect(violations, "CSP violations").toEqual([]);
    expect(errors, "uncaught page errors").toEqual([]);
  },
});
export { expect };

// Reset the app's storage, then plant a scenario and (optionally) a signed-in session.
// `mock` is documented at the top of fake-supabase.js.
export async function seed(page, { mock = {}, user = null } = {}) {
  await page.goto("/logo.svg");
  await page.evaluate(
    ({ mock, user, ref }) => {
      localStorage.clear();
      localStorage.setItem("__mock", JSON.stringify({ ...(user && user.profile ? { profile: user.profile } : {}), ...mock }));
      if (user) {
        localStorage.setItem(
          `sb-${ref}-auth-token`,
          JSON.stringify({
            access_token: "fake." + btoa(JSON.stringify({ sub: user.id })).replace(/=/g, "") + ".sig",
            refresh_token: "fake-refresh",
            token_type: "bearer",
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 86400 * 30,
            user: { id: user.id, aud: "authenticated", role: "authenticated", email: user.email, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
          }),
        );
      }
    },
    { mock, user, ref: REF },
  );
}

export const patchMock = (page, patch) =>
  page.evaluate((patch) => {
    const mock = JSON.parse(localStorage.getItem("__mock") || "{}");
    localStorage.setItem("__mock", JSON.stringify({ ...mock, ...patch }));
  }, patch);

export async function open(page, url) {
  await page.goto(url);
  await expect(page.locator("#main h1, #main .notice, #main article, #main form").first()).toBeVisible();
}

export const calls = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("__calls") || "[]"));
export const clearCalls = (page) => page.evaluate(() => localStorage.setItem("__calls", "[]"));
export const callsTo = async (page, pathname, method) =>
  (await calls(page)).filter((c) => c.path === pathname && (!method || c.method === method));
export const storedSession = (page) => page.evaluate((ref) => localStorage.getItem(`sb-${ref}-auth-token`), REF);
