// A person's characters. Every call runs as the signed-in user; RLS and the column
// grants decide what is allowed (docs/adr/0002, 0006, 0011). A character belongs to a
// person, not a campaign. No delete function exists on purpose (docs/adr/0004):
// "deleting" hides a character and it can be brought back.
import { SCHEMA_VERSION, blank } from "./eclipse-rules.js";
import { sb } from "./supabase-client.js";

const COLUMNS = "id, owner_id, schema_version, character_name, data, updated_at, deleted_at";
const LIST_COLUMNS = "id, character_name, schema_version, updated_at, deleted_at";

// Newest change first. Without the sheet data, which can be large: read one with readCharacter.
export async function listCharacters(ownerId) {
  const { data, error } = await sb.from("characters").select(LIST_COLUMNS).eq("owner_id", ownerId).order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}

// Makes a new character. The database refuses an eleventh one that is not deleted.
export async function createCharacter(ownerId, { name = "", data = blank(), schemaVersion = SCHEMA_VERSION } = {}) {
  const { data: rows, error } = await sb
    .from("characters")
    .insert({ owner_id: ownerId, character_name: name, data, schema_version: schemaVersion })
    .select(COLUMNS);
  if (error) throw error;
  return rows[0];
}

export const readCharacter = async (id) => (await readCharacters([id]))[0] || null;

export async function readCharacters(ids) {
  if (!ids.length) return [];
  const { data, error } = await sb.from("characters").select(COLUMNS).in("id", ids);
  if (error) throw error;
  return data;
}

export async function deleteCharacter(id) {
  const { error } = await sb.rpc("delete_character", { p_character_id: id });
  if (error) throw error;
}

export async function undeleteCharacter(id) {
  const { error } = await sb.rpc("undelete_character", { p_character_id: id });
  if (error) throw error;
}

// ── Which character is active in which campaign (docs/adr/0011) ───────
// A player has one active character per campaign, and a character is active in at
// most one campaign at a time.

// The signed-in player's own: [{ campaign_id, character_id }].
export async function listMyAssignments(playerId) {
  const { data, error } = await sb.from("campaign_characters").select("campaign_id, character_id").eq("player_id", playerId);
  if (error) throw error;
  return data;
}

export async function chooseCharacter(campaignId, characterId) {
  const { error } = await sb.rpc("choose_character", { p_campaign_id: campaignId, p_character_id: characterId });
  if (error) throw error;
}

// ── Version history (docs/adr/0010) ───────────────────────────────────
// The database keeps a snapshot of a sheet before each change (docs/adr/0004). An
// owner can read theirs, and a DM can read the ones since the character became
// active in their campaign. Restoring goes through a function so that it is always
// snapshotted itself, and so it never overwrites a save the page has not seen.

// Newest first. Without the sheet data, which can be large: read one with readSnapshot.
export async function listHistory(characterId) {
  const { data, error } = await sb
    .from("character_history")
    .select("id, character_id, schema_version, character_name, reason, saved_at")
    .eq("character_id", characterId)
    .order("saved_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data;
}

export async function readSnapshot(historyId) {
  const { data, error } = await sb
    .from("character_history")
    .select("id, character_id, schema_version, character_name, data, reason, saved_at")
    .eq("id", historyId);
  if (error) throw error;
  return data[0] || null;
}

// Puts a snapshot back as the sheet. `expectedUpdatedAt` is the sheet's updated_at
// as this page last saw it. Resolves to the sheet's new updated_at.
export async function restoreVersion(historyId, expectedUpdatedAt) {
  const { data, error } = await sb.rpc("restore_character_version", { p_history_id: historyId, p_expected: expectedUpdatedAt });
  if (error) throw error;
  return data;
}

// Writes only if nobody saved since `expected` (the updated_at we last saw).
// Resolves to { status: "saved", updated_at }, { status: "conflict", current }
// when another device saved first, or { status: "blocked" } when the database
// refused the write (for example, the character was deleted).
export async function saveCharacter(id, expected, { name, data }) {
  const { data: rows, error } = await sb
    .from("characters")
    .update({ character_name: name, data, schema_version: SCHEMA_VERSION })
    .eq("id", id)
    .eq("updated_at", expected)
    .select("updated_at");
  if (error) throw error;
  if (rows.length) return { status: "saved", updated_at: rows[0].updated_at };

  const current = await readCharacter(id);
  if (current && current.updated_at !== expected) return { status: "conflict", current };
  return { status: "blocked" };
}
