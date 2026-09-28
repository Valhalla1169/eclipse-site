import { describe, expect, test } from "vitest";
import { blank } from "../../public/js/eclipse-rules.js";
import {
  ADV_FIELDS,
  CASTING_FIELDS,
  CONTAINER_FIELDS,
  CORE_FIELDS,
  EQUIPMENT_FIELDS,
  FIELD_BY_PATH,
  FLAW_FIELDS,
  ITEM_FIELDS,
  KINDS,
  LANG_FIELDS,
  LOG_FIELDS,
  PEOPLE_FIELDS,
  POWER_FIELDS,
  RITUAL_FIELDS,
  SPELL_FIELDS,
  TESTAMENT_FIELDS,
  VALUE_LISTS,
  lookupField,
  pathGet,
  pathSet,
  rows,
} from "../../public/js/sheet/fields.js";

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
    expect(FIELD_BY_PATH.size).toBe(CORE_FIELDS.length + TESTAMENT_FIELDS.length + EQUIPMENT_FIELDS.length + CASTING_FIELDS.length);
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

describe("TESTAMENT_FIELDS", () => {
  test.each(TESTAMENT_FIELDS.map((f) => [f.path, f]))("%s round-trips through the binder", (path, field) => {
    const sheet = blank();
    const sample = SAMPLE[field.kind];
    const stored = KINDS[field.kind].toStored(sample.el);
    pathSet(sheet, path, stored);
    expect(pathGet(sheet, path)).toBe(stored);
  });
});

describe("EQUIPMENT_FIELDS", () => {
  test.each(EQUIPMENT_FIELDS.map((f) => [f.path, f]))("%s round-trips through the binder", (path, field) => {
    const sheet = blank();
    const sample = SAMPLE[field.kind];
    const stored = KINDS[field.kind].toStored(sample.el);
    pathSet(sheet, path, stored);
    expect(pathGet(sheet, path)).toBe(stored);
  });
});

describe("CASTING_FIELDS", () => {
  test.each(CASTING_FIELDS.map((f) => [f.path, f]))("%s round-trips through the binder", (path, field) => {
    const sheet = blank();
    const sample = SAMPLE[field.kind];
    const stored = KINDS[field.kind].toStored(sample.el);
    pathSet(sheet, path, stored);
    expect(pathGet(sheet, path)).toBe(stored);
  });
});

describe("the Equipment page's growing lists", () => {
  test.each([
    ["wornExtra", ITEM_FIELDS],
    ["containers", CONTAINER_FIELDS],
  ])("%s: every field of every row round-trips through the binder", (list, fields) => {
    for (const count of [0, 1, 3]) {
      const sheet = blank();
      sheet[list] = Array.from({ length: count }, () => ({}));
      for (const field of rows(list, count, fields)) {
        const sample = SAMPLE[field.kind];
        const stored = KINDS[field.kind].toStored(sample.el);
        pathSet(sheet, field.path, stored);
        expect(pathGet(sheet, field.path)).toBe(stored);
      }
    }
  });

  test.each([0, 1, 3])("a container's own items round-trip through the binder, %i items", (count) => {
    const sheet = blank();
    sheet.containers = [{ items: Array.from({ length: count }, () => ({})) }, { items: [{}] }];
    for (const field of rows("containers.0.items", count, ITEM_FIELDS)) {
      const sample = SAMPLE[field.kind];
      const stored = KINDS[field.kind].toStored(sample.el);
      pathSet(sheet, field.path, stored);
      expect(pathGet(sheet, field.path)).toBe(stored);
    }
    // A second container's own items are a separate list at the same field paths.
    pathSet(sheet, "containers.1.items.0.n", "Other container's item");
    expect(pathGet(sheet, "containers.0.items.0.n")).not.toBe("Other container's item");
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
});

describe("the Testament page's growing lists", () => {
  test.each([
    ["adv", ADV_FIELDS],
    ["flaw", FLAW_FIELDS],
    ["lang", LANG_FIELDS],
    ["people", PEOPLE_FIELDS],
  ])("%s: every field of every row round-trips through the binder", (list, fields) => {
    for (const count of [0, 1, 3]) {
      const sheet = blank();
      sheet[list] = Array.from({ length: count }, () => ({}));
      for (const field of rows(list, count, fields)) {
        const sample = SAMPLE[field.kind];
        const stored = KINDS[field.kind].toStored(sample.el);
        pathSet(sheet, field.path, stored);
        expect(pathGet(sheet, field.path)).toBe(stored);
      }
    }
  });
});

describe("the Casting page's growing lists", () => {
  test.each([
    ["spells", SPELL_FIELDS],
    ["powers", POWER_FIELDS],
    ["rituals", RITUAL_FIELDS],
  ])("%s: every field of every row round-trips through the binder", (list, fields) => {
    for (const count of [0, 1, 3]) {
      const sheet = blank();
      sheet[list] = Array.from({ length: count }, () => ({}));
      for (const field of rows(list, count, fields)) {
        const sample = SAMPLE[field.kind];
        const stored = KINDS[field.kind].toStored(sample.el);
        pathSet(sheet, field.path, stored);
        expect(pathGet(sheet, field.path)).toBe(stored);
      }
    }
  });
});

describe("the Casting page's value lists (school pickers)", () => {
  test.each(VALUE_LISTS.map(({ list, kind }) => [list, kind]))("%s: every row round-trips through the binder", (list, kind) => {
    for (const count of [0, 1, 3]) {
      const sheet = blank();
      sheet[list] = Array.from({ length: count }, () => "");
      for (let i = 0; i < count; i += 1) {
        const path = `${list}.${i}`;
        const sample = SAMPLE[kind];
        const stored = KINDS[kind].toStored(sample.el);
        pathSet(sheet, path, stored);
        expect(pathGet(sheet, path)).toBe(stored);
        expect(lookupField(path)).toMatchObject({ path, kind });
      }
    }
  });
});

describe("lookupField", () => {
  test("resolves a growing list's field with no rows drawn", () => {
    expect(lookupField("log.7.t")).toMatchObject({ path: "log.7.t", kind: "text" });
  });

  test("resolves a value list's row with no rows drawn", () => {
    expect(lookupField("vSchools.3")).toMatchObject({ path: "vSchools.3", kind: "text" });
  });

  test("resolves a container's own item with neither index drawn yet", () => {
    expect(lookupField("containers.5.items.9.n")).toMatchObject({ path: "containers.5.items.9.n", kind: "text" });
  });

  test.each([
    "log.x.t",
    "log.1.nope",
    "log.-1.t",
    "adv.x.n",
    "adv.1.nope",
    "adv.-1.n",
    "wornExtra.x.n",
    "wornExtra.-1.n",
    "wornExtra.1.nope",
    "containers.x.name",
    "containers.0.nope",
    "containers.x.items.0.n",
    "containers.-1.items.0.n",
    "containers.0.items.x.n",
    "containers.0.items.-1.n",
    "containers.0.items.0.nope",
    "containers.constructor.items.0.n",
    "containers.0.items.constructor.n",
    "spells.x.n",
    "spells.-1.n",
    "spells.1.nope",
    "powers.x.n",
    "rituals.x.tt",
    "rituals.-1.tt",
    "rituals.1.nope",
    "vSchools.x",
    "vSchools.-1",
    "vSchools.constructor",
    "pSchools.x",
    "constructor",
    "__proto__.x",
  ])("finds nothing for a bad path: %s", (path) => {
    expect(lookupField(path)).toBeUndefined();
  });

  test("two sheets with different log lengths resolve their own fields, in either order", () => {
    const short = blank();
    short.log = [{ t: "Short A", d: "", b: "" }];
    const long = blank();
    long.log = [{ t: "1", d: "", b: "" }, { t: "2", d: "", b: "" }, { t: "3", d: "", b: "" }];

    // Resolving the long sheet's rows first must not change what the short
    // sheet's own path resolves to.
    for (const field of rows("log", long.log.length, LOG_FIELDS)) lookupField(field.path);
    const field0 = lookupField("log.0.t");
    expect(pathGet(short, field0.path)).toBe("Short A");
    expect(pathGet(long, field0.path)).toBe("1");

    // A row past the short sheet's own length still resolves; it just reads
    // as undefined there.
    const field2 = lookupField("log.2.t");
    expect(pathGet(short, field2.path)).toBeUndefined();
    expect(pathGet(long, field2.path)).toBe("3");
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
