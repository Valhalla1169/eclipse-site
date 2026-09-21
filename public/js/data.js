// Campaign and invite queries. Every one runs as the signed-in user; RLS and
// grants decide what comes back, so a query for something you may not see returns
// nothing. No delete function exists on purpose (docs/adr/0004): removing a
// campaign would take its invites, memberships and departed sheets with it.
import { readCharacters } from "./characters.js";
import { newestDeparted } from "./roster.js";
import { sb } from "./supabase-client.js";

// Only people on the allowlist may create a campaign (ADR 0005). This is for the
// UI; the database enforces it regardless of what the page shows.
export async function isCampaignCreator(userId) {
  const { data, error } = await sb.from("campaign_creators").select("user_id").eq("user_id", userId);
  if (error) throw error;
  return data.length > 0;
}

// Everything the user can see: their own campaigns plus the ones they joined.
export async function listMyCampaigns(userId) {
  const { data, error } = await sb
    .from("campaigns")
    .select("id, name, dm_id, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data.map((c) => ({ ...c, isDm: c.dm_id === userId }));
}

export async function createCampaign(userId, name) {
  const { data, error } = await sb.from("campaigns").insert({ dm_id: userId, name }).select("id, name, dm_id");
  if (error) throw error;
  return data[0];
}

export async function joinCampaign(code) {
  const { data, error } = await sb.rpc("join_campaign", { p_invite_code: code });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("invalid invite code");
  return row; // { campaign_id, campaign_name }
}

// null when the campaign does not exist or the user may not see it.
export async function getCampaign(id) {
  const { data, error } = await sb.from("campaigns").select("id, name, dm_id").eq("id", id);
  if (error) throw error;
  return data[0] || null;
}

// Invite metadata only. The database never returns the code or its hash: the
// code exists in plaintext once, in the create_invite() response.
export async function listInvites(campaignId) {
  const { data, error } = await sb
    .from("campaign_invites")
    .select("id, label, created_at, expires_at, max_uses, use_count, revoked_at")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function createInvite(campaignId, { label, maxUses, ttlHours }) {
  const { data, error } = await sb.rpc("create_invite", {
    p_campaign_id: campaignId,
    p_label: label || null,
    p_max_uses: maxUses,
    p_ttl_hours: ttlHours,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("no invite returned");
  return row; // { invite_id, code, expires_at }
}

export async function revokeInvite(inviteId) {
  const { error } = await sb.rpc("revoke_invite", { p_invite_id: inviteId });
  if (error) throw error;
}

// ── The DM's roster (ADR 0009, 0011) ──────────────────────────────────
// The DM reads and never writes (ADR 0001), so everything here is a read. A roster is
//   members      campaign_players rows
//   assignments  campaign_characters rows: which character each player has active
//   profiles     { playerId: display_name }
//   characters   { characterId: row } for the characters that are active now
//   departed     { copyId: row } for the newest copy kept from each player who left
// The DM reads a character only while it is active in their campaign. When a player
// leaves, the DM's copy is the sheet as it was then.

const EMPTY_ROSTER = { members: [], assignments: [], profiles: {}, characters: {}, departed: {} };

async function listMembers(campaignId) {
  const { data, error } = await sb.from("campaign_players").select("player_id, joined_at").eq("campaign_id", campaignId);
  if (error) throw error;
  return data;
}

async function listAssignments(campaignId) {
  const { data, error } = await sb.from("campaign_characters").select("player_id, character_id, assigned_at").eq("campaign_id", campaignId);
  if (error) throw error;
  return data;
}

// One tiny row per sheet: enough to tell which ones changed without reading them.
async function listStamps(characterIds) {
  if (!characterIds.length) return [];
  const { data, error } = await sb.from("characters").select("id, updated_at").in("id", characterIds);
  if (error) throw error;
  return data;
}

async function listDepartedStamps(campaignId) {
  const { data, error } = await sb.from("departed_sheets").select("id, player_id, kept_at").eq("campaign_id", campaignId);
  if (error) throw error;
  return data;
}

const DEPARTED_COLUMNS = "id, campaign_id, player_id, character_id, character_name, schema_version, data, reason, kept_at";

async function readDeparted(ids) {
  if (!ids.length) return [];
  const { data, error } = await sb.from("departed_sheets").select(DEPARTED_COLUMNS).in("id", ids);
  if (error) throw error;
  return data;
}

// null when the copy does not exist or is not in a campaign the user runs.
export async function readDepartedSheet(id) {
  const { data, error } = await sb.from("departed_sheets").select(DEPARTED_COLUMNS).eq("id", id);
  if (error) throw error;
  return data[0] || null;
}

// The player who has this character active in the campaign, or null.
export async function findAssignment(campaignId, characterId) {
  const { data, error } = await sb.from("campaign_characters").select("player_id, character_id, assigned_at").eq("campaign_id", campaignId).eq("character_id", characterId);
  if (error) throw error;
  return data[0] || null;
}

export async function readProfileNames(ids) {
  if (!ids.length) return {};
  const { data, error } = await sb.from("profiles").select("id, display_name").in("id", ids);
  if (error) throw error;
  return Object.fromEntries(data.map((p) => [p.id, p.display_name]));
}

// Brings a roster up to date. Only sheets whose updated_at changed are read again,
// so it is cheap to call often (on a live event, and on a timer as a fallback).
// Call it with no `previous` to read everything.
export async function syncRoster(campaignId, previous = EMPTY_ROSTER) {
  const [members, assignments, departedStamps] = await Promise.all([listMembers(campaignId), listAssignments(campaignId), listDepartedStamps(campaignId)]);
  const stamps = await listStamps(assignments.map((a) => a.character_id));
  const changed = stamps.filter((s) => previous.characters[s.id]?.updated_at !== s.updated_at).map((s) => s.id);
  const fresh = await readCharacters(changed);
  const characters = {};
  for (const stamp of stamps) {
    const row = fresh.find((r) => r.id === stamp.id) || previous.characters[stamp.id];
    if (row) characters[stamp.id] = row;
  }

  const wanted = newestDeparted(departedStamps, members);
  const freshDeparted = await readDeparted(wanted.filter((s) => !(s.id in previous.departed)).map((s) => s.id));
  const departed = {};
  for (const stamp of wanted) {
    const row = freshDeparted.find((r) => r.id === stamp.id) || previous.departed[stamp.id];
    if (row) departed[stamp.id] = row;
  }

  const people = new Set([...members.map((m) => m.player_id), ...assignments.map((a) => a.player_id), ...Object.values(departed).map((r) => r.player_id)]);
  const unknown = [...people].filter((id) => !(id in previous.profiles));
  const profiles = { ...previous.profiles, ...(await readProfileNames(unknown)) };
  return { members, assignments, profiles, characters, departed };
}

// Calls onChange when a player chooses a different character or an active sheet is
// written, and onStatus with the channel's state ("SUBSCRIBED" once it is live).
// Returns a function that stops it. A realtime subscription is bound by the same RLS
// policies as a plain read, so the sheets table only tells the DM about sheets they
// may read. It only says that something changed: the page reads again.
export function subscribeToRoster(campaignId, onChange, onStatus) {
  const channel = sb
    .channel(`roster-${campaignId}-${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "campaign_characters", filter: `campaign_id=eq.${campaignId}` }, () => onChange())
    .on("postgres_changes", { event: "*", schema: "public", table: "characters" }, () => onChange())
    .subscribe((status) => onStatus(status));
  return () => {
    sb.removeChannel(channel);
  };
}
