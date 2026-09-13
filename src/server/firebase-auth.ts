import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "./db/index.ts";
import * as schema from "./db/schema.ts";
import { ensureProfile } from "./access.ts";
import { HttpError } from "./http.ts";

export async function handleFirebaseAuth(request: Request): Promise<Response> {
  let body: { idToken?: string };
  try {
    body = (await request.json()) as { idToken?: string };
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }

  const idToken = body.idToken?.trim();
  if (!idToken) {
    throw new HttpError(400, "Missing ID token.");
  }

  // Verify token with Google's public tokeninfo endpoint
  const verifyRes = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  );

  if (!verifyRes.ok) {
    throw new HttpError(401, "Invalid or expired Google authentication token.");
  }

  const payload = (await verifyRes.json()) as {
    email?: string;
    email_verified?: string | boolean;
    name?: string;
    picture?: string;
    sub?: string;
    user_id?: string;
  };

  const email = payload.email?.toLowerCase().trim();
  if (!email) {
    throw new HttpError(400, "Google account did not return a valid email.");
  }

  const db = getDb();

  // Find or create user in DB
  const [existingUser] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, email));

  let userId: string;
  let isNewUser = false;
  const name = payload.name?.trim() || email.split("@")[0];

  if (!existingUser) {
    userId = randomUUID();
    isNewUser = true;
    await db.insert(schema.user).values({
      id: userId,
      name,
      email,
      emailVerified: true,
      image: payload.picture || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await ensureProfile(db, { id: userId, name });
  } else {
    userId = existingUser.id;
    if (!existingUser.emailVerified) {
      await db
        .update(schema.user)
        .set({ emailVerified: true, updatedAt: new Date() })
        .where(eq(schema.user.id, userId));
    }
    await ensureProfile(db, { id: userId, name: existingUser.name });
  }

  // Link account if not already linked
  const accountId = payload.sub || payload.user_id || userId;
  const [existingAccount] = await db
    .select()
    .from(schema.account)
    .where(eq(schema.account.userId, userId))
    .limit(1);

  if (!existingAccount) {
    await db.insert(schema.account).values({
      id: randomUUID(),
      accountId,
      providerId: "google",
      userId,
      idToken,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // Create session in DB
  const sessionId = randomUUID();
  const sessionToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  await db.insert(schema.session).values({
    id: sessionId,
    token: sessionToken,
    userId,
    expiresAt,
    createdAt: new Date(),
    updatedAt: new Date(),
    ipAddress: request.headers.get("x-forwarded-for") || null,
    userAgent: request.headers.get("user-agent") || null,
  });

  // Set session cookies
  const isHttps =
    (process.env.BETTER_AUTH_URL || "").startsWith("https://") ||
    request.url.startsWith("https://") ||
    request.headers.get("x-forwarded-proto") === "https";

  const headers = new Headers();
  headers.set("Content-Type", "application/json");

  const cookieFlags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
  headers.append(
    "Set-Cookie",
    `better-auth.session_token=${sessionToken}; ${cookieFlags}${isHttps ? "; Secure" : ""}`,
  );
  if (isHttps) {
    headers.append(
      "Set-Cookie",
      `__Secure-better-auth.session_token=${sessionToken}; ${cookieFlags}; Secure`,
    );
  }

  return new Response(JSON.stringify({ success: true, isNewUser, userId }), {
    status: 200,
    headers,
  });
}
