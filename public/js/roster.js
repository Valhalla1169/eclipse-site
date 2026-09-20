// The DM's roster as plain data: who is in the campaign, their sheet's summary, and
// the backup file. No DOM and no Supabase, so it is unit-testable in Node.
import { SheetFormatError, openSheet, summarizeSheet } from "./eclipse-rules.js";

const UNKNOWN_PLAYER = "Unknown player";

// Reads a stored row for the roster. A sheet that cannot be read still gets a
// place on the roster (and in the backup); it just has no summary.
function describeCharacter(row) {
  const base = { id: row.id, name: String(row.character_name || "").trim(), updatedAt: row.updated_at, schemaVersion: row.schema_version };
  try {
    const opened = openSheet(row);
    return { ...base, summary: summarizeSheet(opened.sheet), newerVersion: opened.readOnly, unreadable: false };
  } catch (error) {
    if (!(error instanceof SheetFormatError)) throw error;
    return { ...base, summary: null, newerVersion: false, unreadable: true };
  }
}

// members: campaign_players rows. profiles: { id: display_name }. characters: { id: row }.
// Players are in the order they joined. A character whose owner is no longer a
// member (they left or were removed) is kept, in `former`: the DM can still read it.
export function buildRoster({ members, profiles, characters }) {
  const byOwner = new Map(Object.values(characters).map((row) => [row.owner_id, row]));
  const nameOf = (playerId) => profiles[playerId] || UNKNOWN_PLAYER;
  const entry = (playerId, joinedAt, member) => {
    const row = byOwner.get(playerId);
    return { playerId, playerName: nameOf(playerId), joinedAt, member, character: row ? describeCharacter(row) : null };
  };
  const memberIds = new Set(members.map((m) => m.player_id));
  const players = [...members].sort((a, b) => String(a.joined_at).localeCompare(String(b.joined_at))).map((m) => entry(m.player_id, m.joined_at, true));
  const former = [...byOwner.keys()]
    .filter((ownerId) => !memberIds.has(ownerId))
    .map((ownerId) => entry(ownerId, null, false))
    .sort((a, b) => a.playerName.localeCompare(b.playerName));
  return { players, former };
}

// The whole campaign's sheets in one file, as stored (not cleaned or migrated), so
// it is a true backup. Each `data` with its schemaVersion is a valid .eclipse file.
export function backupFile({ campaign, members, profiles, characters, now = new Date() }) {
  const memberIds = new Set(members.map((m) => m.player_id));
  const sheets = Object.values(characters)
    .map((row) => ({
      characterId: row.id,
      playerId: row.owner_id,
      playerName: profiles[row.owner_id] || UNKNOWN_PLAYER,
      member: memberIds.has(row.owner_id),
      characterName: row.character_name,
      schemaVersion: row.schema_version,
      updatedAt: row.updated_at,
      data: row.data,
    }))
    .sort((a, b) => a.playerName.localeCompare(b.playerName) || a.characterId.localeCompare(b.characterId));
  return {
    name: backupFileName(campaign.name, now),
    text: JSON.stringify({ app: "eclipse", kind: "campaign-sheets", exportedAt: now.toISOString(), campaign: { id: campaign.id, name: campaign.name }, sheets }, null, 1),
  };
}

export function backupFileName(campaignName, now = new Date()) {
  const slug = String(campaignName).replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-") || "campaign";
  return `${slug}-sheets-${now.toISOString().slice(0, 10)}.json`;
}
