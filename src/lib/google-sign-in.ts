/**
 * Which NextAuth provider the "Google sign-in" buttons use (safe to import
 * from client components).
 *
 * Since 10 Nov 2026 Google sign-in goes through the shared HintWise Supabase
 * project (provider "supabase", see src/lib/supabase-auth.ts), so UpvoteMe
 * needs no redirect URI of its own on the Google OAuth client.
 * NEXT_PUBLIC_GOOGLE_AUTH_VIA=direct brings back the app's own Google provider
 * as a rollback: it needs AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET, the old
 * redirect URI on the Google client, and a rebuild (Next.js inlines
 * NEXT_PUBLIC_ variables at build time).
 */
export type GoogleAuthMode = "supabase" | "direct";

export function googleAuthMode(
  value: string | undefined = process.env.NEXT_PUBLIC_GOOGLE_AUTH_VIA,
): GoogleAuthMode {
  return value?.trim().toLowerCase() === "direct" ? "direct" : "supabase";
}

export function googleProviderId(mode: GoogleAuthMode = googleAuthMode()): string {
  return mode === "direct" ? "google" : "supabase";
}
