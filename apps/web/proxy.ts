import { NextResponse, type NextRequest } from "next/server";
import { refreshSessionOnly, updateSession } from "./lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/gmail/callback") {
    // Never redirect the OAuth callback: refresh the Supabase session so the
    // route sees a current session, then let the route handle logged-out,
    // state-mismatch, and Google-error cases itself.
    return refreshSessionOnly(request);
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"
  ]
};
