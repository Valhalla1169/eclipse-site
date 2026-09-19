// Public by design: the project URL and the anon key ship to every browser.
// What protects the data is Row Level Security plus the explicit grants in
// supabase/migrations, not the secrecy of this key.
//
// NEVER put the service_role / secret key, or the database password, here or
// anywhere else under public/ (DESIGN.md 5.3).
export const SUPABASE_URL = "https://eosnplpgzqahwgaytauu.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvc25wbHBnenFhaHdnYXl0YXV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4NDEzNjIsImV4cCI6MjEwNTQxNzM2Mn0.pP3ib8mxUlPnx_M63BvkDwkbz6EI3Mf3VXCO3h89PA8";
