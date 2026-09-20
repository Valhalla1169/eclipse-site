// The player's own character row. Every call runs as the signed-in user; RLS and
// the column grants decide what is allowed (docs/adr/0002, 0006). No delete
// function exists on purpose (docs/adr/0004).
import { SCHEMA_VERSION, blank } from "./eclipse-rules.js";
import { sb } from "./supabase-client.js";

const COLUMNS = "id, owner_id, campaign_id, schema_version, character_name, data, updated_at";
const UNIQUE_VIOLATION = "23505";

async function readRow(campaignId, ownerId) {
  const { data, error } = await sb.from("characters").select(COLUMNS).eq("campaign_id", campaignId).eq("owner_id", ownerId);
  if (error) throw error;
  return data[0] || null;
}

// The sheet must load successfully before anything is written (ADR 0004): a failed
// read throws here and the caller shows no editor. A first visit creates a blank
// row with only the columns a client may write.
export async function loadCharacter(campaignId, ownerId) {
  const existing = await readRow(campaignId, ownerId);
  if (existing) return existing;
  const { data, error } = await sb
    .from("characters")
    .insert({ owner_id: ownerId, campaign_id: campaignId, schema_version: SCHEMA_VERSION, character_name: "", data: blank() })
    .select(COLUMNS);
  if (error) {
    // Another tab or device created the row first: use theirs.
    if (error.code === UNIQUE_VIOLATION) {
      const raced = await readRow(campaignId, ownerId);
      if (raced) return raced;
    }
    throw error;
  }
  return data[0];
}

export const readCharacter = async (id) => (await readCharacters([id]))[0] || null;

export async function readCharacters(ids) {
  if (!ids.length) return [];
  const { data, error } = await sb.from("characters").select(COLUMNS).in("id", ids);
  if (error) throw error;
  return data;
}

// Writes only if nobody saved since `expected` (the updated_at we last saw).
// Resolves to { status: "saved", updated_at }, { status: "conflict", current }
// when another device saved first, or { status: "blocked" } when the database
// refused the write (for example, the player left the campaign).
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
