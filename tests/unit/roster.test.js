import { describe, expect, it } from "vitest";
import { blank } from "../../public/js/eclipse-rules.js";
import { backupFile, backupFileName, buildRoster, newestDeparted } from "../../public/js/roster.js";

const row = (id, owner, name, data = blank(), extra = {}) => ({
  id,
  owner_id: owner,
  schema_version: 1,
  character_name: name,
  data,
  updated_at: "2026-09-19T12:00:00.000000+00:00",
  ...extra,
});
const copy = (id, player, name, data = blank(), extra = {}) => ({
  id,
  campaign_id: "c1",
  player_id: player,
  character_id: `ch-${id}`,
  character_name: name,
  schema_version: 1,
  data,
  reason: "left",
  kept_at: "2026-09-10T12:00:00.000000+00:00",
  ...extra,
});
const members = [
  { player_id: "p2", joined_at: "2026-09-02T00:00:00Z" },
  { player_id: "p1", joined_at: "2026-09-01T00:00:00Z" },
  { player_id: "p3", joined_at: "2026-09-03T00:00:00Z" },
];
const active = (playerId, characterId) => ({ player_id: playerId, character_id: characterId, assigned_at: "2026-09-01T00:00:00Z" });
const profiles = { p1: "Dana", p2: "Ravi", p4: "Zed" };
const roster = (parts) => buildRoster({ members, assignments: [], profiles, characters: {}, departed: {}, ...parts });

describe("buildRoster", () => {
  it("lists members in the order they joined, each with the summary of their active character", () => {
    const dana = blank();
    dana.id.prof = "Engineer";
    dana.cm.shock = 3;
    const { players } = roster({
      assignments: [active("p1", "a"), active("p2", "b")],
      characters: { a: row("a", "p1", "Marlo", dana), b: row("b", "p2", "Vex") },
    });
    expect(players.map((p) => p.playerName)).toEqual(["Dana", "Ravi", "Unknown player"]);
    expect(players[0].character).toMatchObject({ id: "a", name: "Marlo", unreadable: false, summary: { profession: "Engineer", monitors: { shock: { boxes: 3 } } } });
  });

  it("says which invite each member joined with, when it is known", () => {
    const withInvites = buildRoster({
      members: [
        { player_id: "p1", joined_at: "2026-09-01T00:00:00Z", invite_id: "i1" },
        { player_id: "p2", joined_at: "2026-09-02T00:00:00Z", invite_id: "i2" },
        { player_id: "p3", joined_at: "2026-09-03T00:00:00Z", invite_id: null },
      ],
      assignments: [],
      profiles,
      characters: {},
      departed: {},
      invites: { i1: "for Dana", i2: null },
    });
    expect(withInvites.players.map((p) => p.invite)).toEqual([{ label: "for Dana" }, { label: null }, null]);
  });

  it("keeps a member who has not chosen a character yet", () => {
    const { players } = roster();
    expect(players).toHaveLength(3);
    expect(players[0].character).toBeNull();
  });

  it("shows the character a player has active, not their other characters", () => {
    const { players } = roster({ assignments: [active("p1", "b")], characters: { b: row("b", "p1", "Second") } });
    expect(players[0].character.name).toBe("Second");
  });

  it("puts someone who left in `former`, with the copy kept when they left", () => {
    const { players, former } = roster({ departed: { 7: copy(7, "p4", "Old hand", blank(), { reason: "removed" }) } });
    expect(players.every((p) => p.character === null)).toBe(true);
    expect(former).toEqual([
      expect.objectContaining({ playerId: "p4", playerName: "Zed", member: false, character: expect.objectContaining({ name: "Old hand", copyId: 7, reason: "removed", updatedAt: "2026-09-10T12:00:00.000000+00:00" }) }),
    ]);
  });

  it("shows a sheet it cannot read without a summary, and never throws", () => {
    const { players } = roster({ assignments: [active("p1", "a")], characters: { a: row("a", "p1", "Marlo", { base: "nope" }) } });
    expect(players[0].character).toMatchObject({ unreadable: true, summary: null, name: "Marlo" });
  });

  it("marks a sheet from a newer version, and still summarizes it", () => {
    const { players } = roster({ assignments: [active("p1", "a")], characters: { a: row("a", "p1", "Marlo", blank(), { schema_version: 4 }) } });
    expect(players[0].character).toMatchObject({ newerVersion: true, schemaVersion: 4 });
    expect(players[0].character.summary).not.toBeNull();
  });
});

describe("newestDeparted", () => {
  const stamp = (id, player, keptAt) => ({ id, player_id: player, kept_at: keptAt });
  it("keeps the newest copy for each player who is not a member", () => {
    const stamps = [stamp(1, "p4", "2026-09-01"), stamp(2, "p4", "2026-09-05"), stamp(3, "p5", "2026-09-02"), stamp(4, "p1", "2026-09-03")];
    expect(newestDeparted(stamps, members).map((s) => s.id).sort()).toEqual([2, 3]);
  });

  it("breaks a tie by the later id", () => {
    expect(newestDeparted([stamp(1, "p4", "2026-09-01"), stamp(2, "p4", "2026-09-01")], members).map((s) => s.id)).toEqual([2]);
  });
});

describe("backupFile", () => {
  const now = new Date("2026-09-19T20:00:00Z");
  const campaign = { id: "c1", name: "Age of Eclipse!" };

  it("holds every sheet exactly as stored, including copies from players who left and unreadable ones", () => {
    const stored = { ...blank(), futureField: 1 };
    const characters = { a: row("a", "p1", "Marlo", stored) };
    const departed = { 7: copy(7, "p4", "Old", { base: "nope" }, { schema_version: 3, reason: "removed" }) };
    const file = backupFile({ campaign, members, profiles, characters, departed, now });
    const parsed = JSON.parse(file.text);
    expect(file.name).toBe("Age-of-Eclipse-sheets-2026-09-19.json");
    expect(parsed).toMatchObject({ app: "eclipse", kind: "campaign-sheets", exportedAt: "2026-09-19T20:00:00.000Z", campaign });
    expect(parsed.sheets.map((s) => [s.playerName, s.member, s.departed, s.schemaVersion])).toEqual([["Dana", true, false, 1], ["Zed", false, true, 3]]);
    expect(parsed.sheets[0].data).toEqual(stored);
    expect(parsed.sheets[1]).toMatchObject({ data: { base: "nope" }, reason: "removed", characterId: "ch-7", updatedAt: "2026-09-10T12:00:00.000000+00:00" });
  });

  it("is an empty list for a campaign with no sheets", () => {
    expect(JSON.parse(backupFile({ campaign, members: [], profiles: {}, characters: {}, departed: {}, now }).text).sheets).toEqual([]);
  });

  it("makes a safe file name", () => {
    expect(backupFileName("../../evil name", now)).toBe("evil-name-sheets-2026-09-19.json");
    expect(backupFileName("!!!", now)).toBe("campaign-sheets-2026-09-19.json");
  });
});
