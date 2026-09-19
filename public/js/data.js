// Campaign and invite queries. Every one runs as the signed-in user; RLS and
// grants decide what comes back, so a query for something you may not see returns
// nothing. No delete function exists on purpose (docs/adr/0004): removing a
// campaign would cascade to every character in it.
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
