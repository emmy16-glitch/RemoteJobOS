import { createDecipheriv } from "node:crypto";

export type GmailConnection = {
  owner_id: string;
  email_address: string | null;
  refresh_token_ciphertext: string;
  token_iv: string;
  token_tag: string;
  granted_scope: string | null;
  active: boolean;
  last_synced_at: string | null;
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
};

export type GmailMessage = {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
};

function oauthEnv() {
  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET ?? "";
  const encryptionKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY ?? "";
  if (!clientId || !clientSecret || !encryptionKey) {
    throw new Error("Gmail worker environment is not configured");
  }
  return { clientId, clientSecret, encryptionKey };
}

function decryptRefreshToken(connection: GmailConnection): string {
  const env = oauthEnv();
  const key = Buffer.from(env.encryptionKey, "base64");
  if (key.length !== 32) {
    throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(connection.token_iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(connection.token_tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(connection.refresh_token_ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}

export async function gmailAccessToken(connection: GmailConnection): Promise<string> {
  const env = oauthEnv();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.clientId,
      client_secret: env.clientSecret,
      refresh_token: decryptRefreshToken(connection),
      grant_type: "refresh_token"
    })
  });

  const body = (await response.json()) as TokenResponse;
  if (!response.ok || !body.access_token) {
    throw new Error(
      body.error_description ?? body.error ?? `Gmail token refresh failed: ${response.status}`
    );
  }
  return body.access_token;
}

function cleanHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export async function sendGmailMessage(args: {
  connection: GmailConnection;
  to: string;
  subject: string;
  bodyText: string;
}): Promise<string> {
  if (!args.connection.granted_scope?.includes("gmail.send")) {
    throw new Error("Connected Gmail account has not granted gmail.send");
  }

  const token = await gmailAccessToken(args.connection);
  const from = cleanHeader(args.connection.email_address ?? "");
  const to = cleanHeader(args.to);
  const subject = cleanHeader(args.subject);
  if (!to || !to.includes("@")) throw new Error("Notification destination email is invalid");

  const mime = [
    from ? `From: ${from}` : "",
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    args.bodyText
  ].filter((line, index) => line || index > 0).join("\r\n");

  const raw = Buffer.from(mime, "utf8").toString("base64url");
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ raw })
    }
  );

  const body = await response.json() as { id?: string; error?: { message?: string } };
  if (!response.ok || !body.id) {
    throw new Error(body.error?.message ?? `Gmail send failed: ${response.status}`);
  }

  return body.id;
}

export async function listGmailMessageIds(args: {
  connection: GmailConnection;
  query: string;
  maxResults?: number;
}): Promise<string[]> {
  const token = await gmailAccessToken(args.connection);
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("q", args.query);
  url.searchParams.set("maxResults", String(args.maxResults ?? 100));

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` }
  });
  const body = await response.json() as {
    messages?: Array<{ id: string }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(body.error?.message ?? `Gmail list failed: ${response.status}`);
  }
  return (body.messages ?? []).map((item) => item.id);
}

export async function getGmailMessage(
  connection: GmailConnection,
  messageId: string
): Promise<GmailMessage> {
  const token = await gmailAccessToken(connection);
  const url = new URL(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`
  );
  url.searchParams.set("format", "metadata");
  for (const header of ["Subject", "From", "Date"]) {
    url.searchParams.append("metadataHeaders", header);
  }

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` }
  });
  const body = await response.json() as GmailMessage & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(body.error?.message ?? `Gmail message read failed: ${response.status}`);
  }
  return body;
}

export function gmailHeader(message: GmailMessage, name: string): string {
  return message.payload?.headers?.find(
    (header) => header.name.toLowerCase() === name.toLowerCase()
  )?.value ?? "";
}
