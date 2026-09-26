// The rulebook's reads (docs/adr/0016). Only a signed-in person can read it, and nothing
// on the site writes it: the owner uploads it with `npm run rulebook push`.
import { sb } from "./supabase-client.js";

// { title, version }, or null before a book is uploaded.
export async function readBook() {
  const { data, error } = await sb.from("rulebook").select("title, version");
  if (error) throw error;
  return data[0] || null;
}

// [{ slug, title }] in the book's order, without the text.
export async function listChapters() {
  const { data, error } = await sb.from("rulebook_pages").select("slug, title").order("position");
  if (error) throw error;
  return data;
}

// { slug, title, body }, or null for a chapter that is not in the book.
export async function readChapter(slug) {
  const { data, error } = await sb.from("rulebook_pages").select("slug, title, body").eq("slug", slug);
  if (error) throw error;
  return data[0] || null;
}
