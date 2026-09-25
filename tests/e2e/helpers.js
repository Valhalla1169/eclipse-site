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
  dm: { id: ids.dm, email: "dm@example.com", profile: { id: ids.dm, display_name: "The Keeper" } },
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
// `mock` is documented at the top of fake-supabase.js. `character` is shorthand for one
// more row in `characters`.
export async function seed(page, { mock = {}, user = null } = {}) {
  await page.goto("/logo.svg");
  await page.evaluate(
    ({ mock, user, ref }) => {
      localStorage.clear();
      const scenario = { ...(user && user.profile ? { profile: user.profile } : {}), ...mock };
      if (scenario.character) {
        scenario.characters = [scenario.character, ...(scenario.characters || [])];
        delete scenario.character;
      }
      localStorage.setItem("__mock", JSON.stringify(scenario));
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

// Another tab in the same browser: it shares the session and the fake database.
export async function anotherTab(page) {
  const tab = await page.context().newPage();
  await tab.addInitScript({ path: path.join(here, "fake-supabase.js") });
  return tab;
}

export async function open(page, url) {
  await page.goto(url);
  await expect(page.locator("#main h1, #main .notice, #main article, #main form").first()).toBeVisible();
}

export const calls = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("__calls") || "[]"));
export const clearCalls = (page) => page.evaluate(() => localStorage.setItem("__calls", "[]"));
export const callsTo = async (page, pathname, method) =>
  (await calls(page)).filter((c) => c.path === pathname && (!method || c.method === method));
export const storedSession = (page) => page.evaluate((ref) => localStorage.getItem(`sb-${ref}-auth-token`), REF);

export const CHARACTER_ID = "40000000-0000-4000-8000-000000000001";
export const FIRST_STAMP = "2026-09-19T11:00:00.000123+00:00";

// The row the fake database holds for Dana's character.
export const characterRow = (data, extra = {}) => ({
  id: CHARACTER_ID,
  owner_id: ids.player,
  schema_version: 1,
  character_name: (data.id && data.id.name) || "",
  data,
  updated_at: FIRST_STAMP,
  deleted_at: null,
  ...extra,
});

// A character being active in the test campaign.
export const assignmentRow = (characterId = CHARACTER_ID, extra = {}) => ({
  campaign_id: ids.campaign,
  player_id: ids.player,
  character_id: characterId,
  assigned_at: "2026-09-01T00:00:00Z",
  ...extra,
});

export const sheetPath = (id = CHARACTER_ID) => `/characters/${id}`;

// Another device saves the sheet: the stored data and updated_at change behind the page's back.
export const otherDeviceSaves = (page, data, id = CHARACTER_ID) =>
  page.evaluate(
    ({ data, id }) => {
      const mock = JSON.parse(localStorage.getItem("__mock"));
      const row = mock.characters.find((r) => r.id === id);
      row.data = data;
      row.character_name = data.id.name;
      row.updated_at = "2026-09-19T12:30:00.000789+00:00";
      localStorage.setItem("__mock", JSON.stringify(mock));
    },
    { data, id },
  );

export const storedCharacter = (page, id = CHARACTER_ID) =>
  page.evaluate((id) => JSON.parse(localStorage.getItem("__mock")).characters.find((r) => r.id === id), id);

export const storedMock = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("__mock")));
