// The rulebook's reads (docs/adr/0016). Only a signed-in person can read it, and nothing
// on the site writes it: the owner uploads it with `npm run rulebook push`.
import { sb } from "./supabase-client.js";

// The whole book at once, since /rules now shows every chapter on one page: its title
// and version, and every chapter with its body, in the book's order. book is null before
// one is uploaded.
export async function readWholeBook() {
  const [book, pages] = await Promise.all([
    sb.from("rulebook").select("title, version"),
    sb.from("rulebook_pages").select("position, slug, title, body").order("position"),
  ]);
  if (book.error) throw book.error;
  if (pages.error) throw pages.error;
  return { book: book.data[0] || null, chapters: pages.data };
}
