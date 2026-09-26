import { describe, expect, it } from "vitest";
import { findLostValues, rehearseSheet, summaryLine } from "../../scripts/rehearse.mjs";

const SHEET = { id: { name: "Aria Vance", race: "human" }, base: { end: 3 }, notes: { shock: "steady hands" } };

describe("findLostValues", () => {
  it("finds nothing when every value from before is still somewhere in after", () => {
    expect(findLostValues(SHEET, { ...SHEET, extra: { copy: SHEET.id.name } })).toEqual([]);
  });

  it("does not mind a value moving to a new path, such as a rename", () => {
    const after = { id: { race: "human" }, renamed: { fullName: "Aria Vance" }, base: { end: 3 }, notes: { shock: "steady hands" } };
    expect(findLostValues(SHEET, after)).toEqual([]);
  });

  it("finds a value dropped with no trace", () => {
    const after = { id: { name: "Aria Vance", race: "human" }, base: { end: 3 } }; // notes.shock is gone, not moved
    expect(findLostValues(SHEET, after)).toEqual(["notes.shock"]);
  });

  it("ignores blanks, booleans and the small numbers 0 and 1", () => {
    expect(findLostValues({ a: "", b: true, c: 0, d: 1 }, {})).toEqual([]);
  });

  it("walks arrays too", () => {
    const before = { weapons: [{ name: "Rusty Knife" }, { name: "Pipe" }] };
    expect(findLostValues(before, { weapons: [{ name: "Pipe" }] })).toEqual(["weapons[0].name"]);
  });
});

describe("rehearseSheet", () => {
  const row = { source: "characters", id: "c1", name: "Aria Vance", schema_version: 1, data: { id: { name: "Aria Vance" } } };

  it("opens a current-version sheet cleanly", () => {
    expect(rehearseSheet(row)).toMatchObject({ status: "ok" });
  });

  it("flags a sheet that throws", () => {
    expect(rehearseSheet({ ...row, data: "not an object" })).toMatchObject({ status: "throws" });
  });

  it("flags a stored version newer than the code as read-only", () => {
    const result = rehearseSheet({ ...row, schema_version: 2 }, { current: 1, steps: {} });
    expect(result).toMatchObject({ status: "read-only" });
    expect(result.detail).toMatch(/newer/);
  });

  // The case ADR 0013 and this tool exist for: a migration step that quietly drops a field.
  it("catches a migration step that drops a key", () => {
    const steps = {
      1: (data) => {
        const { name, ...id } = data.id;
        return { ...data, id };
      },
    };
    const result = rehearseSheet({ ...row, schema_version: 1 }, { current: 2, steps });
    expect(result.status).toBe("lost-data");
    expect(result.detail).toContain("id.name");
  });

  it("does not flag a migration step that only renames a field", () => {
    const steps = {
      1: (data) => {
        const { name, ...id } = data.id;
        return { ...data, id, fullName: name };
      },
    };
    const result = rehearseSheet({ ...row, schema_version: 1 }, { current: 2, steps });
    expect(result.status).toBe("ok");
  });
});

describe("summaryLine", () => {
  it("counts sheets per source and per stored version, and the failures", () => {
    const results = [
      { source: "characters", schema_version: 1, status: "ok" },
      { source: "characters", schema_version: 1, status: "lost-data" },
      { source: "departed_sheets", schema_version: 1, status: "ok" },
    ];
    expect(summaryLine(results)).toBe("3 sheet(s) rehearsed - characters v1: 2; departed_sheets v1: 1; 1 failed.");
  });

  it("says none failed when every sheet is ok", () => {
    expect(summaryLine([{ source: "characters", schema_version: 1, status: "ok" }])).toMatch(/none failed/);
  });
});
