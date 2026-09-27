import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authenticatedUserId } from "../../../../lib/auth";
import { gmailOAuthEnv } from "../../../../lib/gmail/env";

export async function GET(request: NextRequest) {
  const userId = await authenticatedUserId();
  if (!userId) {
    return NextResponse.redirect(new URL("/login?next=/inbox", request.url));
  }

  const env = gmailOAuthEnv();
  if (!env.configured) {
    return NextResponse.redirect(
      new URL(
        "/inbox?error=" +
          encodeURIComponent("Gmail OAuth environment is not configured yet."),
        request.url
      )
    );
  }

  const state = randomBytes(32).toString("hex");
  const redirectUri =
    env.redirectUri || new URL("/api/gmail/callback", request.url).toString();

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", env.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set(
    "scope",
    "https://www.googleapis.com/auth/gmail.readonly"
  );
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("remotejobos_gmail_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60
  });

  return response;
}
