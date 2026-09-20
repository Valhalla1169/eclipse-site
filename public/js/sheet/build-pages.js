// All six pages of the sheet, in one container that can be replaced as a whole.
import { h } from "../dom.js";
import { buildCastingPage } from "./casting-page.js";
import { buildCorePage } from "./core-page.js";
import { buildEquipmentPage } from "./equipment-page.js";
import { buildLogPage, buildReferencePage } from "./log-reference-pages.js";
import { buildTestamentPage } from "./testament-page.js";

export const buildPages = (sheet) =>
  h("div", { class: "pages" }, buildCorePage(sheet), buildEquipmentPage(sheet), buildCastingPage(sheet), buildTestamentPage(sheet), buildLogPage(sheet), buildReferencePage());
