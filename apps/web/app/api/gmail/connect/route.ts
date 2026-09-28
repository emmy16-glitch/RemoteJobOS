import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authenticatedUserId } from "../../../../lib/auth";
import { gmailOAuthEnv } from "../../../../lib/gmail/env";

function publicBaseUrl(request: NextRequest) {
  const env = gmailOAuthEnv();
  if (env.redirectUri) {
    return new URL(env.redirectUri).origin;
  }
  return new URL(request.url).origin;
}

export async function GET(request: NextRequest) {
  const baseUrl = publicBaseUrl(request);
  const userId = await authenticatedUserId();
  if (!userId) {
    console.warn("[gmail-connect] no authenticated user");
    return NextResponse.redirect(new URL("/login?next=/inbox", baseUrl), 302);
  }

  const env = gmailOAuthEnv();
  if (!env.configured) {
    console.error("[gmail-connect] OAuth environment incomplete", {
      hasClientId: Boolean(env.clientId),
      hasClientSecret: Boolean(env.clientSecret),
      hasEncryptionKey: Boolean(env.encryptionKey),
      hasRedirectUri: Boolean(env.redirectUri)
    });
    return NextResponse.redirect(
      new URL(
        "/inbox?error=" +
          encodeURIComponent("Gmail OAuth environment is incomplete on the live server."),
        baseUrl
      ),
      302
    );
  }

  const state = randomBytes(32).toString("hex");
  const redirectUri =
    env.redirectUri || new URL("/api/gmail/callback", request.url).toString();

  console.info("[gmail-connect] starting OAuth", {
    userId,
    redirectUri,
    requestHost: request.nextUrl.host
  });

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", env.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set(
    "scope",
    [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send"
    ].join(" ")
  );
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authUrl, 302);
  response.cookies.set("remotejobos_gmail_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60
  });

  return response;
}
