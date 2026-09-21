import { describe, expect, it } from "vitest";
import { MAX_CHARACTERS, UNNAMED, activeByCampaign, copyOfRow, describeCharacters, displayName } from "../../public/js/character-list.js";
import { blank } from "../../public/js/eclipse-rules.js";

const row = (id, name, extra = {}) => ({ id, character_name: name, schema_version: 1, updated_at: "2026-09-19T12:00:00Z", deleted_at: null, ...extra });
const campaigns = [{ id: "c1", name: "Age of Eclipse" }];

describe("describeCharacters", () => {
  it("says which campaign each character is active in", () => {
    const { live } = describeCharacters({ rows: [row("a", "Marlo"), row("b", "Vex")], assignments: [{ campaign_id: "c1", character_id: "a" }], campaigns });
    expect(live.map((c) => [c.name, c.campaign && c.campaign.name])).toEqual([["Marlo", "Age of Eclipse"], ["Vex", null]]);
  });

  it("keeps deleted characters apart, and they do not count toward the limit", () => {
    const rows = [...Array(MAX_CHARACTERS - 1).keys()].map((i) => row(`l${i}`, `C${i}`));
    const list = describeCharacters({ rows: [...rows, row("d", "Gone", { deleted_at: "2026-09-01T00:00:00Z" })], assignments: [], campaigns });
    expect(list.deleted.map((c) => c.name)).toEqual(["Gone"]);
    expect(list.full).toBe(false);
  });

  it("is full at the limit", () => {
    const rows = [...Array(MAX_CHARACTERS).keys()].map((i) => row(`l${i}`, `C${i}`));
    expect(describeCharacters({ rows, assignments: [], campaigns }).full).toBe(true);
  });

  it("names an unknown campaign and an unnamed character in plain words", () => {
    const { live } = describeCharacters({ rows: [row("a", "  ")], assignments: [{ campaign_id: "gone", character_id: "a" }], campaigns });
    expect(live[0]).toMatchObject({ name: UNNAMED, campaign: { id: "gone", name: "a campaign" } });
    expect(displayName(row("x", null))).toBe(UNNAMED);
  });
});

describe("copyOfRow", () => {
  it("copies the sheet, names the copy, and keeps the sheet's own name in step", () => {
    const data = { ...blank(), futureField: { keep: true } };
    data.id.name = "Marlo";
    const copy = copyOfRow({ ...row("a", "Marlo"), schema_version: 1, data });
    expect(copy.name).toBe("Marlo (copy)");
    expect(copy.data.id.name).toBe("Marlo (copy)");
    expect(copy.data.futureField).toEqual({ keep: true });
    expect(copy.schemaVersion).toBe(1);
    expect(data.id.name).toBe("Marlo");
  });

  it("keeps the name within the database limit and copes with an odd sheet", () => {
    expect(copyOfRow({ ...row("a", "x".repeat(100)), data: {} }).name).toHaveLength(100);
    expect(copyOfRow({ ...row("a", ""), data: { id: null } })).toMatchObject({ name: `${UNNAMED} (copy)`, data: { id: null } });
  });
});

describe("activeByCampaign", () => {
  it("maps each campaign to the player's character there", () => {
    const active = activeByCampaign([row("a", "Marlo"), row("b", "Vex")], [{ campaign_id: "c1", character_id: "b" }, { campaign_id: "c2", character_id: "unknown" }]);
    expect(active).toEqual({ c1: { id: "b", name: "Vex" } });
  });
});
