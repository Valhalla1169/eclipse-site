// Checks the contract behind friendlyError (public/js/util.js): every `raise exception`
// message in supabase/migrations/*.sql that a real person can still trigger must get a
// friendly answer, not the generic fallback. See the comment above friendlyError.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { friendlyError } from "../../public/js/util.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "supabase", "migrations");
const GENERIC = "Something went wrong. Please try again.";

// ════════════════════════════════════════════════════════════════════
// A small parser: only the newest definition of each function counts. A later
// migration's `create or replace function name(` replaces an earlier one; `drop
// function` removes it. Within a function body it reads `raise exception '...'`
// (with or without a `%`-placeholder argument list — a placeholder is replaced
// with a sample value) and `raise ... using message = '...'`.
// ════════════════════════════════════════════════════════════════════
function functionBody(text, searchFrom) {
  const open = text.indexOf("$$", searchFrom);
  if (open === -1) return null;
  const close = text.indexOf("$$", open + 2);
  if (close === -1) return null;
  return text.slice(open + 2, close);
}

function extractMessages(body) {
  const messages = [];
  const patterns = [/raise\s+exception\s+'((?:[^']|'')*)'/gi, /raise\s+(?:exception\s+)?using\s+message\s*=\s*'((?:[^']|'')*)'/gi];
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      messages.push(match[1].replace(/''/g, "'").replace(/%/g, "X"));
    }
  }
  return messages;
}

// name (lower-case) -> { file, messages }. Functions are processed migration by
// migration, oldest first, and within a file in the order they appear, so a later
// `create or replace` always overwrites an earlier entry for the same name.
function collectActiveFunctions() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const functions = new Map();
  const createRe = /create\s+(?:or\s+replace\s+)?function\s+public\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gi;
  const dropRe = /drop\s+function\s+public\.([a-zA-Z_][a-zA-Z0-9_]*)/gi;

  for (const file of files) {
    const text = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const events = [];
    for (const match of text.matchAll(createRe)) {
      events.push({ kind: "create", name: match[1].toLowerCase(), index: match.index, bodyStart: match.index + match[0].length });
    }
    for (const match of text.matchAll(dropRe)) {
      events.push({ kind: "drop", name: match[1].toLowerCase(), index: match.index });
    }
    events.sort((a, b) => a.index - b.index);
    for (const event of events) {
      if (event.kind === "drop") {
        functions.delete(event.name);
        continue;
      }
      const body = functionBody(text, event.bodyStart);
      functions.set(event.name, { file, messages: body ? extractMessages(body) : [] });
    }
  }
  return functions;
}

const activeFunctions = collectActiveFunctions();
const allMessages = [...activeFunctions.values()].flatMap((f) => f.messages);
// The sign-up hook (migration 0011) refuses with a JSON error object, not a raise.
const HOOK_MESSAGE = "this email is not approved to make an account";
const uniqueMessages = [...new Set([...allMessages, HOOK_MESSAGE])];

describe("the migration parser", () => {
  it("finds every raise exception in the currently active functions", () => {
    // Hand count from reading supabase/migrations/*.sql on 2026-09-28 (superseded
    // definitions excluded): 49 raise statements across 20 functions. A much lower
    // count means the parser stopped matching real migration syntax.
    expect(allMessages.length).toBeGreaterThanOrEqual(45);
    expect([...activeFunctions.values()].filter((f) => f.messages.length > 0).length).toBeGreaterThanOrEqual(18);
  });

  it("keeps only the newest definition of a redefined function", () => {
    // characters_enforce_limits was 10 characters in 0009, replaced with 5 in 0011.
    expect(activeFunctions.get("characters_enforce_limits").messages).toContain("you already have 5 characters, the most one person can have");
    expect(activeFunctions.get("characters_enforce_limits").messages).not.toContain("you already have 10 characters, the most one person can have");
    // restore_character_version's 0008 "not a member of this campaign" check is gone in 0009.
    expect(activeFunctions.get("restore_character_version").file).toBe("0009_characters_belong_to_people.sql");
    expect(activeFunctions.get("restore_character_version").messages).not.toContain("you are not a member of this campaign");
  });
});

// ════════════════════════════════════════════════════════════════════
// Messages the page can never show a real person. Each needs a one-line reason;
// keep this list as short as honest reasoning allows.
// ════════════════════════════════════════════════════════════════════
const ALLOWED_GENERIC = {
  "a character's owner_id cannot be changed":
    "the app never sends an owner_id different from the row's own; only a forged direct API call could reach this trigger.",
  "an invite must allow between 1 and 50 uses":
    "the create-invite form's Uses field is a fixed select (1, 2, 5, 12); no UI path can submit an out-of-range value.",
  "an invite must last between 1 hour and 30 days":
    "the create-invite form's Lifetime field is a fixed select (24, 168, 720 hours); no UI path can submit an out-of-range value.",
};

describe("friendlyError covers every message a real person could see", () => {
  for (const message of uniqueMessages) {
    const reason = ALLOWED_GENERIC[message];
    if (reason) {
      it(`allows the generic message for "${message}" (${reason})`, () => {
        expect(friendlyError(new Error(message))).toBe(GENERIC);
      });
    } else {
      it(`gives a specific message for "${message}"`, () => {
        expect(friendlyError(new Error(message))).not.toBe(GENERIC);
      });
    }
  }

  it("only allows messages that are actually unreachable", () => {
    expect(Object.keys(ALLOWED_GENERIC).sort()).toEqual(
      [...uniqueMessages].filter((m) => ALLOWED_GENERIC[m]).sort(),
    );
    // Anything in the allowlist must really be a message the parser still finds today.
    for (const message of Object.keys(ALLOWED_GENERIC)) {
      expect(uniqueMessages).toContain(message);
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// One friendlyError pattern must not shadow another: each message gets the
// friendly text meant for it, not one meant for a different raise.
// ════════════════════════════════════════════════════════════════════
const EXPECTED_TEXT = {
  "must be signed in": "You are signed out. Sign in, then try again.",
  "must be signed in to join a campaign": "You are signed out. Sign in, then try again.",
  "schema_version can only increase": "This tab has an old copy of the app open. Reload the page and try again.",
  "invalid invite code": "That invite code is not valid. Check it with your Keeper.",
  "you run this campaign": "You are the Keeper of this campaign, so you cannot join it as a player.",
  "only the DM of this campaign can create invites": "Only the Keeper of this campaign can do that.",
  "only the DM of this campaign can remove a player": "Only the Keeper of this campaign can do that.",
  "this campaign already has 50 active invites. Revoke one first": "This campaign already has 50 active invites. Revoke one first.",
  "this campaign has made 500 invites, the most it can keep": "This campaign has made 500 invites, the most it can keep.",
  "that invite is not active, or is not yours": "That invite is no longer active.",
  "invite not found, already revoked, or not yours": "That invite could not be revoked. It may already be revoked.",
  "this email is not approved to make an account": "Only an email a site admin has approved can make an account.",
  "only a site admin can approve an email": "Only a site admin can do that.",
  "only a site admin can revoke an approval": "Only a site admin can do that.",
  "only a site admin can list the accounts": "Only a site admin can do that.",
  "only a site admin can list the approvals": "Only a site admin can do that.",
  "only a site admin can list the purges": "Only a site admin can do that.",
  "that is not an email address": "That is not an email address.",
  "there are already 20 approved emails with no account. Revoke one first": "20 approved emails are already waiting for an account. Revoke one first.",
  "that email already has an account, so its approval cannot be revoked": "That email already has an account, so its approval cannot be revoked.",
  "that email is not approved": "That email is not approved, so there is nothing to revoke.",
  "the sheet changed since you opened it": "Your sheet was changed somewhere else since you opened this page. Reload the page and try again.",
  "that version was not found": "That version could not be found, so it cannot be restored.",
  "that version cannot be restored because its character no longer exists": "That version could not be found, so it cannot be restored.",
  "you are not a member of this campaign": "You are not in this campaign.",
  "that character is already active in another campaign. Choose a different character there first":
    "That character is active in another campaign. Choose a different character there first, or make a copy of this one.",
  "that character is active in a campaign. Choose a different character there first": "That character is active in a campaign. Choose a different character there first.",
  "that character is deleted. Bring it back first": "That character is deleted. Bring it back first.",
  "that character was not found": "That character could not be found.",
  "you have already purged 10 characters in the last 24 hours. Wait a day and try again.":
    "You have deleted 10 characters forever in the last day, the most for one day. Wait a day and try again.",
  "that character cannot be purged": "That character cannot be deleted forever right now. Reload the page and try again.",
  "you have made 30 characters, the most one person can keep, including deleted ones":
    "You have made 30 characters, counting deleted ones. That is the most one person can keep. Delete an archived one forever to make room.",
};

describe("friendlyError gives the message meant for each raise, not a neighbour's", () => {
  for (const [message, expected] of Object.entries(EXPECTED_TEXT)) {
    it(`"${message}"`, () => {
      expect(friendlyError(new Error(message))).toBe(expected);
    });
  }

  it("gives the 5-character limit its own note (FULL_NOTE)", () => {
    expect(friendlyError(new Error("you already have 5 characters, the most one person can have"))).toMatch(/most one person can have/);
  });
});
