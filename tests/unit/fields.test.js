import { describe, expect, test } from "vitest";
import { blank } from "../../public/js/eclipse-rules.js";
import { CORE_FIELDS, FIELD_BY_PATH, KINDS, pathGet, pathSet } from "../../public/js/sheet/fields.js";

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
