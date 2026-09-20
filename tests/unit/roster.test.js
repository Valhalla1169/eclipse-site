import { describe, expect, it } from "vitest";
import { blank } from "../../public/js/eclipse-rules.js";
import { backupFile, backupFileName, buildRoster } from "../../public/js/roster.js";

const row = (id, owner, name, data = blank(), extra = {}) => ({
  id,
  owner_id: owner,
  campaign_id: "c1",
  schema_version: 1,
  character_name: name,
  data,
  updated_at: "2026-09-19T12:00:00.000000+00:00",
  ...extra,
});
const members = [
  { player_id: "p2", joined_at: "2026-09-02T00:00:00Z" },
  { player_id: "p1", joined_at: "2026-09-01T00:00:00Z" },
  { player_id: "p3", joined_at: "2026-09-03T00:00:00Z" },
];
const profiles = { p1: "Dana", p2: "Ravi", p4: "Zed" };

describe("buildRoster", () => {
  it("lists members in the order they joined, each with their sheet's summary", () => {
    const dana = blank();
    dana.id.prof = "Engineer";
    dana.cm.shock = 3;
    const { players } = buildRoster({ members, profiles, characters: { a: row("a", "p1", "Marlo", dana), b: row("b", "p2", "Vex") } });
    expect(players.map((p) => p.playerName)).toEqual(["Dana", "Ravi", "Unknown player"]);
    expect(players[0].character).toMatchObject({ id: "a", name: "Marlo", unreadable: false, summary: { profession: "Engineer", monitors: { shock: { boxes: 3 } } } });
  });

  it("keeps a member who has not opened their sheet yet", () => {
    const { players } = buildRoster({ members, profiles, characters: {} });
    expect(players).toHaveLength(3);
    expect(players[0].character).toBeNull();
  });

  it("keeps the sheet of someone who is no longer a member, apart from the members", () => {
    const { players, former } = buildRoster({ members, profiles, characters: { z: row("z", "p4", "Old hand") } });
    expect(players.every((p) => p.character === null)).toBe(true);
    expect(former).toEqual([expect.objectContaining({ playerId: "p4", playerName: "Zed", member: false, character: expect.objectContaining({ name: "Old hand" }) })]);
  });

  it("shows a sheet it cannot read without a summary, and never throws", () => {
    const { players } = buildRoster({ members, profiles, characters: { a: row("a", "p1", "Marlo", { base: "nope" }) } });
    expect(players[0].character).toMatchObject({ unreadable: true, summary: null, name: "Marlo" });
  });

  it("marks a sheet from a newer version, and still summarizes it", () => {
    const { players } = buildRoster({ members, profiles, characters: { a: row("a", "p1", "Marlo", blank(), { schema_version: 4 }) } });
    expect(players[0].character).toMatchObject({ newerVersion: true, schemaVersion: 4 });
    expect(players[0].character.summary).not.toBeNull();
  });
});

describe("backupFile", () => {
  const now = new Date("2026-09-19T20:00:00Z");
  const campaign = { id: "c1", name: "Age of Eclipse!" };

  it("holds every sheet exactly as stored, including former players and unreadable ones", () => {
    const stored = { ...blank(), futureField: 1 };
    const characters = { a: row("a", "p1", "Marlo", stored), z: row("z", "p4", "Old", { base: "nope" }, { schema_version: 3 }) };
    const file = backupFile({ campaign, members, profiles, characters, now });
    const parsed = JSON.parse(file.text);
    expect(file.name).toBe("Age-of-Eclipse-sheets-2026-09-19.json");
    expect(parsed).toMatchObject({ app: "eclipse", kind: "campaign-sheets", exportedAt: "2026-09-19T20:00:00.000Z", campaign });
    expect(parsed.sheets.map((s) => [s.playerName, s.member, s.schemaVersion])).toEqual([["Dana", true, 1], ["Zed", false, 3]]);
    expect(parsed.sheets[0].data).toEqual(stored);
    expect(parsed.sheets[1].data).toEqual({ base: "nope" });
  });

  it("is an empty list for a campaign with no sheets", () => {
    expect(JSON.parse(backupFile({ campaign, members: [], profiles: {}, characters: {}, now }).text).sheets).toEqual([]);
  });

  it("makes a safe file name", () => {
    expect(backupFileName("../../evil name", now)).toBe("evil-name-sheets-2026-09-19.json");
    expect(backupFileName("!!!", now)).toBe("campaign-sheets-2026-09-19.json");
  });
});
