import { describe, expect, test } from "vitest";
import { blank } from "../../public/js/eclipse-rules.js";
import { CORE_FIELDS, FIELD_BY_PATH, KINDS, LOG_FIELDS, pathGet, pathSet, rows, setListFields } from "../../public/js/sheet/fields.js";

// One sample input per kind: what a binder's input element would carry, and
// the stored value it must produce.
const SAMPLE = {
  text: { el: { value: "Sample text" }, stored: "Sample text" },
  number: { el: { value: "7" }, stored: 7 },
  blankNumber: { el: { value: "5" }, stored: 5 },
  checkbox: { el: { checked: true }, stored: true },
};

describe("CORE_FIELDS", () => {
  test("has no two fields sharing a path", () => {
    expect(FIELD_BY_PATH.size).toBe(CORE_FIELDS.length);
  });

  test.each(CORE_FIELDS.map((f) => [f.path, f]))("%s round-trips through the binder", (path, field) => {
    const sheet = blank();
    const sample = SAMPLE[field.kind];
    const stored = KINDS[field.kind].toStored(sample.el);
    expect(stored).toBe(sample.stored);
    if (field.apply) field.apply(sheet, stored);
    else pathSet(sheet, path, stored);
    expect(pathGet(sheet, path)).toBe(stored);
  });
});

describe("LOG_FIELDS (a growing list)", () => {
  test.each([0, 1, 3])("every field of every row round-trips through the binder, %i entries", (count) => {
    const sheet = blank();
    sheet.log = Array.from({ length: count }, () => ({ t: "", d: "", b: "" }));
    for (const field of rows("log", count, LOG_FIELDS)) {
      const sample = SAMPLE[field.kind];
      const stored = KINDS[field.kind].toStored(sample.el);
      pathSet(sheet, field.path, stored);
      expect(pathGet(sheet, field.path)).toBe(stored);
    }
  });

  test("setListFields matches FIELD_BY_PATH's log rows to the count last drawn", () => {
    setListFields("log", 2, LOG_FIELDS);
    const paths = rows("log", 2, LOG_FIELDS).map((f) => f.path);
    expect([...FIELD_BY_PATH.keys()].filter((k) => k.startsWith("log.")).sort()).toEqual([...paths].sort());

    setListFields("log", 0, LOG_FIELDS);
    expect([...FIELD_BY_PATH.keys()].some((k) => k.startsWith("log."))).toBe(false);
  });
});

describe("pathGet / pathSet", () => {
  test("read a missing path as undefined instead of throwing", () => {
    const sheet = blank();
    expect(pathGet(sheet, "weapons.9.name")).toBeUndefined();
  });

  test("make a missing row when a list is shorter than the path", () => {
    const sheet = blank();
    pathSet(sheet, "weapons.9.name", "Rusty pipe");
    expect(sheet.weapons[9].name).toBe("Rusty pipe");
  });
});
