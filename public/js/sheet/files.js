// The .eclipse file: a character sheet as plain JSON. It works without a network
// and is a backup the player holds. The format is the sheet's inputs (the same
// shape the V4 and V5 sheets wrote) plus a schemaVersion.
import { SCHEMA_VERSION, SheetFormatError, openSheet } from "../eclipse-rules.js";

export const FILE_EXTENSION = ".eclipse";
// The database refuses a sheet above this size (migration 0006), so a bigger file could never be saved.
export const MAX_FILE_BYTES = 512 * 1024;

export function fileNameFor(sheet) {
  const name = (sheet.id.name || "").trim().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
  return `${name || "survivor"}${FILE_EXTENSION}`;
}

export const serializeSheet = (sheet) => JSON.stringify({ ...sheet, schemaVersion: SCHEMA_VERSION }, null, 1);

// Text from a file to a sheet. Throws SheetFormatError with words for the player.
export function parseSheetFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SheetFormatError("That file is not an Eclipse character.");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data) || data.base === null || typeof data.base !== "object") {
    throw new SheetFormatError("That file is not an Eclipse character.");
  }
  const { schemaVersion, ...rest } = data;
  const opened = openSheet({ data: rest, schema_version: schemaVersion });
  if (opened.readOnly) throw new SheetFormatError("That file was saved by a newer version of this sheet. Reload the page and try again.");
  return opened.sheet;
}

export async function readSheetFile(file) {
  if (file.size > MAX_FILE_BYTES) throw new SheetFormatError("That file is too big to be a character sheet.");
  return parseSheetFile(await file.text());
}

export function downloadText(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
