// The characters page as plain data. No DOM and no Supabase, so it is unit-testable in Node.

// The database enforces both limits (migration 0009). They are here so the page can
// show them and turn a button off before the database has to refuse.
export const MAX_CHARACTERS = 10;
export const UNNAMED = "Unnamed survivor";

export const displayName = (row) => String(row.character_name || "").trim() || UNNAMED;

// rows: characters as listed. assignments: [{ campaign_id, character_id }].
// campaigns: [{ id, name }]. Each live character says which campaign it is active in.
export function describeCharacters({ rows, assignments, campaigns }) {
  const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));
  const campaignOf = new Map(assignments.map((a) => [a.character_id, { id: a.campaign_id, name: campaignName.get(a.campaign_id) || "a campaign" }]));
  const entry = (row) => ({ id: row.id, name: displayName(row), updatedAt: row.updated_at, campaign: campaignOf.get(row.id) || null });
  const live = rows.filter((row) => !row.deleted_at).map(entry);
  const deleted = rows.filter((row) => row.deleted_at).map(entry);
  return { live, deleted, full: live.length >= MAX_CHARACTERS };
}

// A copy of a stored character, for a second one built the same way. The name and the
// sheet's own name field stay in step, and unknown fields are kept.
export function copyOfRow(row) {
  const name = `${displayName(row)} (copy)`.slice(0, 100);
  const data = structuredClone(row.data);
  if (data && typeof data.id === "object" && data.id !== null) data.id.name = name;
  return { name, data, schemaVersion: row.schema_version };
}

// { campaignId: { id, name } }: the character a player has active in each campaign.
export function activeByCampaign(rows, assignments) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const active = {};
  for (const a of assignments) {
    const row = byId.get(a.character_id);
    if (row) active[a.campaign_id] = { id: row.id, name: displayName(row) };
  }
  return active;
}
