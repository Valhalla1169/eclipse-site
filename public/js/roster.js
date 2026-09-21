// The DM's roster as plain data: who is in the campaign, their sheet's summary, and
// the backup file. No DOM and no Supabase, so it is unit-testable in Node.
import { SheetFormatError, openSheet, summarizeSheet } from "./eclipse-rules.js";

const UNKNOWN_PLAYER = "Unknown player";

// Reads a stored sheet for the roster. A sheet that cannot be read still gets a
// place on the roster (and in the backup); it just has no summary. `sheet` is a
// characters row, or a departed_sheets row (which has the same sheet columns).
function describeSheet({ id, savedAt, sheet, ...rest }) {
  const base = { id, name: String(sheet.character_name || "").trim(), updatedAt: savedAt, schemaVersion: sheet.schema_version, row: sheet, ...rest };
  try {
    const opened = openSheet(sheet);
    return { ...base, summary: summarizeSheet(opened.sheet), newerVersion: opened.readOnly, unreadable: false };
  } catch (error) {
    if (!(error instanceof SheetFormatError)) throw error;
    return { ...base, summary: null, newerVersion: false, unreadable: true };
  }
}

// Of the copies kept from players who are no longer members, the newest one per player.
// stamps: [{ id, player_id, kept_at }].
export function newestDeparted(stamps, members) {
  const memberIds = new Set(members.map((m) => m.player_id));
  const newest = new Map();
  for (const stamp of stamps) {
    if (memberIds.has(stamp.player_id)) continue;
    const best = newest.get(stamp.player_id);
    if (!best || stamp.kept_at > best.kept_at || (stamp.kept_at === best.kept_at && stamp.id > best.id)) newest.set(stamp.player_id, stamp);
  }
  return [...newest.values()];
}

// See syncRoster in data.js for the shape. Players are in the order they joined; one
// with no active character has `character: null`. Someone who left or was removed is
// in `former` with the copy kept then, which is what the DM can still read.
export function buildRoster({ members, assignments, profiles, characters, departed }) {
  const nameOf = (playerId) => profiles[playerId] || UNKNOWN_PLAYER;
  const activeOf = new Map(assignments.map((a) => [a.player_id, characters[a.character_id]]));
  const players = [...members]
    .sort((a, b) => String(a.joined_at).localeCompare(String(b.joined_at)))
    .map((m) => {
      const row = activeOf.get(m.player_id);
      return {
        playerId: m.player_id,
        playerName: nameOf(m.player_id),
        joinedAt: m.joined_at,
        member: true,
        character: row ? describeSheet({ id: row.id, savedAt: row.updated_at, sheet: row }) : null,
      };
    });
  const former = Object.values(departed)
    .map((copy) => ({
      playerId: copy.player_id,
      playerName: nameOf(copy.player_id),
      joinedAt: null,
      member: false,
      character: describeSheet({ id: copy.character_id, savedAt: copy.kept_at, sheet: copy, copyId: copy.id, reason: copy.reason }),
    }))
    .sort((a, b) => a.playerName.localeCompare(b.playerName));
  return { players, former };
}

// The whole campaign's sheets in one file, as stored (not cleaned or migrated), so
// it is a true backup. Each `data` with its schemaVersion is a valid .eclipse file.
// A player who left is included with the copy kept then (`departed: true`).
export function backupFile({ campaign, members, profiles, characters, departed, now = new Date() }) {
  const memberIds = new Set(members.map((m) => m.player_id));
  const live = Object.values(characters).map((row) => ({
    characterId: row.id,
    playerId: row.owner_id,
    playerName: profiles[row.owner_id] || UNKNOWN_PLAYER,
    member: memberIds.has(row.owner_id),
    departed: false,
    characterName: row.character_name,
    schemaVersion: row.schema_version,
    updatedAt: row.updated_at,
    data: row.data,
  }));
  const left = Object.values(departed).map((copy) => ({
    characterId: copy.character_id,
    playerId: copy.player_id,
    playerName: profiles[copy.player_id] || UNKNOWN_PLAYER,
    member: false,
    departed: true,
    reason: copy.reason,
    characterName: copy.character_name,
    schemaVersion: copy.schema_version,
    updatedAt: copy.kept_at,
    data: copy.data,
  }));
  const sheets = [...live, ...left].sort((a, b) => a.playerName.localeCompare(b.playerName) || a.characterId.localeCompare(b.characterId));
  return {
    name: backupFileName(campaign.name, now),
    text: JSON.stringify({ app: "eclipse", kind: "campaign-sheets", exportedAt: now.toISOString(), campaign: { id: campaign.id, name: campaign.name }, sheets }, null, 1),
  };
}

export function backupFileName(campaignName, now = new Date()) {
  const slug = String(campaignName).replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-") || "campaign";
  return `${slug}-sheets-${now.toISOString().slice(0, 10)}.json`;
}
