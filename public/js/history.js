// What the version history page says about a snapshot. No DOM, no Supabase.
// A snapshot is the sheet as it was BEFORE the change named by its reason.
const LABELS = {
  edit: "Kept before an edit",
  schema_change: "Kept before a rules update",
  restore: "Kept before an earlier version was put back",
  delete: "Kept before the sheet was removed",
};

export const reasonLabel = (reason) => LABELS[reason] || "An earlier version";
