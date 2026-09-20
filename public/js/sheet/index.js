// The player's sheet at /campaign/:id/play: the tabs, the save bar, saving to the
// database, and loading or saving a .eclipse file.
//
// The sheet is drawn from `store.sheet`. Nothing is written before the sheet has
// loaded (the caller only builds this view from a row it read), edits are sent
// only if nobody else saved since (updated_at), and a sheet from a newer version
// of the app is shown read-only (docs/adr/0004).
import { createAutosave } from "../autosave.js";
import { h } from "../dom.js";
import { SheetFormatError, openSheet } from "../eclipse-rules.js";
import { friendlyError } from "../util.js";
import { bindSheet } from "./bindings.js";
import { buildPages } from "./build-pages.js";
import { createSheetDialogs } from "./dialogs.js";
import { downloadText, fileNameFor, readSheetFile, serializeSheet } from "./files.js";
import { rebuildCasting, rebuildWorn } from "./rebuild.js";
import { growAll } from "./render.js";

const TABS = [
  { id: "1", name: "Core" },
  { id: "2", name: "Equipment" },
  { id: "4", name: "Casting" },
  { id: "3", name: "Testament" },
  { id: "6", name: "Log" },
  { id: "5", name: "Reference" },
];

const STOPPED_STATES = ["conflict", "blocked"];
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// A sheet that is still shown but never changed or saved.
const LOCKED_PAGES = ["#page1", "#page2", "#page3", "#page4", "#page6"];

// options: {
//   campaign, opened (from openSheet), row ({ id, updated_at }),
//   persist(id, expectedUpdatedAt, { name, data }) -> saveCharacter's result,
//   viewer: "owner" (default), or "dm" to show a player's sheet read-only (ADR 0009),
//   playerName: whose sheet it is, for the DM
// }
// Returns { element, flush, update, dispose }. update(opened) shows a newer copy of a
// sheet the DM is watching; dispose removes the page-wide listeners.
export function createSheetView({ campaign, opened, row, persist, viewer = "owner", playerName = "" }) {
  const isDm = viewer === "dm";
  const store = { sheet: opened.sheet, token: row.updated_at, lastSavedAt: null, tab: "1" };
  const readOnly = isDm || opened.readOnly;

  // Starts as a placeholder; mountPages swaps in the real pages.
  let pages = h("div", { class: "pages" });
  let binding = null;
  const notices = h("div", { id: "notices" });
  const stateEl = h("span", { class: "save-state", id: "saveState" });
  const fileNote = h("span", { class: "file-note", id: "footFile" });
  const fileInput = h("input", { type: "file", accept: ".eclipse,.json,application/json", hidden: true, "aria-label": "Character file to load" });
  const dropVeil = h("div", { id: "dropVeil" }, h("div", { class: "dropcard" }, "Drop the character file to load it"));
  const dialogs = createSheetDialogs();

  /* ── saving ───────────────────────────────────────────── */
  const autosave = createAutosave({
    save: async () => {
      const name = (store.sheet.id.name || "").trim().slice(0, 100);
      const result = await persist(row.id, store.token, { name, data: store.sheet });
      if (result.status === "saved") {
        store.token = result.updated_at;
        store.lastSavedAt = result.updated_at;
      }
      return result;
    },
    onState: (state, detail) => paintState(state, detail),
  });

  const button = (label, onclick, { primary = false, attrs = {} } = {}) => h("button", { class: `sbtn${primary ? " primary" : ""}`, type: "button", onclick, ...attrs }, label);
  const saveNow = button("Save now", () => autosave.flush(), { primary: true, attrs: { hidden: isDm } });
  const copyButton = button("Save a copy", () => saveCopy(store.sheet));
  const loadButton = button("Load file", () => fileInput.click(), { attrs: { hidden: isDm } });

  function saveCopy(sheet) {
    downloadText(fileNameFor(sheet), serializeSheet(sheet));
  }

  function setNotice(kind, ...content) {
    notices.replaceChildren(content.length ? h("div", { class: `sheet-notice ${kind}`, role: kind === "error" ? "alert" : "status" }, ...content) : "");
  }

  function paintState(state, detail) {
    const label = {
      saved: store.lastSavedAt ? `Saved ${clock(store.lastSavedAt)}` : "Saved",
      dirty: "Unsaved changes",
      saving: "Saving...",
      error: "Not saved. Trying again",
      conflict: "Not saved. Saved elsewhere",
      blocked: "Not saved. Refused",
    }[state];
    stateEl.textContent = readOnly ? "Read only" : label;
    stateEl.className = `save-state${state === "saved" ? " good" : ""}${["error", "conflict", "blocked"].includes(state) ? " warn" : ""}`;
    fileNote.textContent = readOnly ? "read only" : label;
    const locked = readOnly || state === "conflict" || state === "blocked";
    loadButton.disabled = locked;
    saveNow.disabled = readOnly || state === "saved" || locked;

    if (state === "error") {
      setNotice("error", h("p", {}, "Your sheet could not be saved. Your changes are still on this page, and saving will try again. ", detail ? friendlyError(detail) : ""));
    } else if (state === "conflict") showConflict(detail.current);
    else if (state === "blocked") showBlocked();
    else if (state === "saved" && !readOnly) setNotice("");
  }

  function showConflict(current) {
    setNotice(
      "error",
      h("p", {}, `This sheet was saved somewhere else at ${clock(current.updated_at)} (another device or tab). Saving here now would replace that version. Nothing has been lost yet.`),
      h(
        "div",
        { class: "actions" },
        button("Keep my version", () => {
          store.token = current.updated_at;
          autosave.resume({ edited: true });
        }),
        button("Use their version", () => useTheirs(current)),
        button("Save copies of both", () => {
          saveCopy(store.sheet);
          downloadText(`${fileNameFor(store.sheet).replace(/\.eclipse$/, "")}-other-version.eclipse`, JSON.stringify({ ...current.data, schemaVersion: current.schema_version }, null, 1));
        }),
      ),
    );
  }

  function useTheirs(current) {
    try {
      const theirs = openSheet(current);
      if (theirs.readOnly) throw new SheetFormatError("That version was saved by a newer version of this sheet. Reload the page and try again.");
      const next = theirs.sheet;
      store.token = current.updated_at;
      store.lastSavedAt = current.updated_at;
      autosave.resume();
      replaceSheet(next);
    } catch (error) {
      setNotice("error", h("p", {}, error instanceof SheetFormatError ? error.message : friendlyError(error)));
    }
  }

  function showBlocked() {
    setNotice(
      "error",
      h("p", {}, "The database refused to save this sheet. You may have left the campaign, or your sign-in may have ended. Your changes are still on this page."),
      h("div", { class: "actions" }, button("Try again", () => autosave.resume({ edited: true })), button("Save a copy", () => saveCopy(store.sheet))),
    );
  }

  /* ── the pages ────────────────────────────────────────── */
  function mountPages() {
    const next = buildPages(store.sheet);
    pages.replaceWith(next);
    pages = next;
    binding = bindSheet({ root: pages, sheet: () => store.sheet, edited: () => !readOnly && autosave.edit() });
    for (const selector of LOCKED_PAGES) pages.querySelector(selector).inert = readOnly;
    showTab(store.tab);
  }

  function replaceSheet(next) {
    store.sheet = next;
    mountPages();
  }

  const tabButtons = TABS.map(({ id, name }) =>
    h("button", { id: `tab${id}`, type: "button", role: "tab", "aria-selected": "false", "aria-controls": `page${id}`, tabindex: "-1" }, name),
  );
  const subtitle = h("div", { class: "sub", id: "sheetSub" });

  function showTab(id) {
    store.tab = id;
    for (const tab of TABS) {
      const selected = tab.id === id;
      pages.querySelector(`#page${tab.id}`).classList.toggle("active", selected);
      const el = tabButtons[TABS.indexOf(tab)];
      el.setAttribute("aria-selected", String(selected));
      el.tabIndex = selected ? 0 : -1;
    }
    subtitle.textContent = `Survivor's Record  ·  ${TABS.find((t) => t.id === id).name}`;
    // Rows that depend on other pages are rebuilt when their page is shown.
    if (id === "2") rebuildWorn(pages, store.sheet);
    if (id === "4") rebuildCasting(pages, store.sheet);
    binding.redraw();
    growAll(pages);
  }

  tabButtons.forEach((el, index) => {
    el.addEventListener("click", () => {
      showTab(TABS[index].id);
      if (TABS[index].id === "5") pages.querySelector("#refSearch").focus();
    });
    el.addEventListener("keydown", (event) => {
      const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: TABS.length - 1 }[event.key];
      if (target === undefined) return;
      event.preventDefault();
      const next = (target + TABS.length) % TABS.length;
      showTab(TABS[next].id);
      tabButtons[next].focus();
    });
  });

  /* ── loading a file ───────────────────────────────────── */
  async function loadFile(file) {
    if (readOnly || STOPPED_STATES.includes(autosave.state)) return;
    try {
      const loaded = await readSheetFile(file);
      const choice = await dialogs.confirmLoad(file.name);
      if (choice === "cancel") return;
      if (choice === "copy") saveCopy(store.sheet);
      replaceSheet(loaded);
      autosave.edit();
    } catch (error) {
      setNotice("error", h("p", {}, error instanceof SheetFormatError ? error.message : friendlyError(error)));
    }
  }
  fileInput.addEventListener("change", () => {
    const [file] = fileInput.files;
    fileInput.value = "";
    if (file) loadFile(file);
  });

  let dragDepth = 0;
  const hasFiles = (event) => event.dataTransfer && [...event.dataTransfer.types].includes("Files");
  const onDragEnter = (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    dropVeil.classList.add("show");
  };
  const onDragOver = (event) => {
    if (hasFiles(event)) event.preventDefault();
  };
  const onDragLeave = () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropVeil.classList.remove("show");
  };
  const onDrop = (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    dropVeil.classList.remove("show");
    if (event.dataTransfer.files[0]) loadFile(event.dataTransfer.files[0]);
  };

  /* ── leaving the page ─────────────────────────────────── */
  const onKeydown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      autosave.flush();
    }
  };
  const onBeforeUnload = (event) => {
    if (!autosave.hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = "";
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") autosave.flush();
  };
  document.addEventListener("dragenter", onDragEnter);
  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragleave", onDragLeave);
  document.addEventListener("drop", onDrop);
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("beforeunload", onBeforeUnload);

  /* ── assemble ─────────────────────────────────────────── */
  const element = h(
    "div",
    { class: "sheet" },
    h(
      "header",
      { class: "masthead" },
      h("div", { class: "mast-top" }, h("div", {}, h("h1", {}, "Age of ", h("em", {}, "Eclipse")), subtitle), stateEl),
      h("div", { class: "tabs", role: "tablist", "aria-label": "Sheet pages" }, tabButtons),
    ),
    h(
      "div",
      { class: "savebar" },
      saveNow,
      copyButton,
      loadButton,
      h("span", { class: "sep" }),
      button("How to use", () => dialogs.help()),
      fileNote,
      fileInput,
    ),
    notices,
    dropVeil,
    pages,
    h("footer", { class: "sheet-foot" }, h("span", {}, "AGE OF ECLIPSE · SURVIVOR'S TESTAMENT · PLAYER RECORD"), h("span", {}, campaign.name)),
    dialogs.elements,
  );
  mountPages();

  if (isDm) {
    setNotice("info", h("p", {}, `You are viewing ${playerName || "a player"}'s sheet as the DM. It is read only, and it updates when they make changes.`));
  } else if (readOnly) {
    setNotice(
      "error",
      h("p", {}, "This sheet was saved by a newer version of the app. Editing is off, so nothing is overwritten. Reload the page to get the newer version."),
      h("div", { class: "actions" }, button("Reload", () => window.location.reload())),
    );
  }
  paintState("saved");
  if (readOnly && !isDm) stateEl.className = "save-state warn";

  return {
    element,
    // Saves what is waiting. Resolves to false when something could not be saved.
    async flush() {
      await autosave.flush();
      return !autosave.hasUnsavedChanges();
    },
    update(next) {
      if (!readOnly) return;
      store.sheet = next.sheet;
      mountPages();
    },
    dispose() {
      document.removeEventListener("dragenter", onDragEnter);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("drop", onDrop);
      document.removeEventListener("keydown", onKeydown);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Best effort: the request outlives the view. Then no more retries.
      autosave.flush().finally(() => autosave.stop());
    },
  };
}
