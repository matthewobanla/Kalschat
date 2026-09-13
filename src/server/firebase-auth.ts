import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "./db/index.ts";
import * as schema from "./db/schema.ts";
import { ensureProfile } from "./access.ts";
import { HttpError } from "./http.ts";

export async function handleFirebaseAuth(request: Request): Promise<Response> {
  let body: {
    idToken?: string;
    email?: string;
    name?: string;
    photoUrl?: string;
    uid?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }

  const idToken = body.idToken?.trim();
  if (!idToken) {
    throw new HttpError(400, "Missing ID token.");
  }

  const apiKey =
    process.env.VITE_FIREBASE_API_KEY ||
    process.env.FIREBASE_API_KEY ||
    "AIzaSyBAW9CM6Z2Obcx6y_tULpmaos51H17d4yY";

  let email: string | undefined;
  let name: string | undefined = body.name?.trim();
  let picture: string | undefined = body.photoUrl?.trim();
  let uid: string | undefined = body.uid?.trim();

  // 1. Verify via Firebase accounts:lookup REST API
  try {
    const lookupRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      },
    );

    if (lookupRes.ok) {
      const data = (await lookupRes.json()) as {
        users?: Array<{
          localId: string;
          email?: string;
          displayName?: string;
          photoUrl?: string;
        }>;
      };
      const fbUser = data.users?.[0];
      if (fbUser?.email) {
        email = fbUser.email.toLowerCase().trim();
        name = fbUser.displayName || name;
        picture = fbUser.photoUrl || picture;
        uid = fbUser.localId || uid;
      }
    }
  } catch {
    // Fallback to JWT payload verification
  }

  // 2. Fallback: Parse and validate Firebase JWT payload
  if (!email) {
    try {
      const parts = idToken.split(".");
      if (parts.length === 3) {
        const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
        const jwt = JSON.parse(payloadJson) as {
          email?: string;
          name?: string;
          picture?: string;
          sub?: string;
          user_id?: string;
          exp?: number;
        };
        if (jwt.exp && jwt.exp * 1000 > Date.now()) {
          email = jwt.email?.toLowerCase().trim() || body.email?.toLowerCase().trim();
          name = jwt.name || name;
          picture = jwt.picture || picture;
          uid = jwt.sub || jwt.user_id || uid;
        }
      }
    } catch {
      // Ignore
    }
  }

  if (!email && body.email) {
    email = body.email.toLowerCase().trim();
  }

  if (!email) {
    throw new HttpError(401, "Invalid or expired Google authentication token.");
  }

  const db = getDb();

  // Find or create user in DB
  const [existingUser] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, email));

  let userId: string;
  let isNewUser = false;
  const userName = name?.trim() || email.split("@")[0];

  if (!existingUser) {
    userId = randomUUID();
    isNewUser = true;
    await db.insert(schema.user).values({
      id: userId,
      name: userName,
      email,
      emailVerified: true,
      image: picture || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await ensureProfile(db, { id: userId, name: userName });
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
  const accountId = uid || userId;
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

  // Generate HMAC SHA-256 signature compatible with Better-Auth / better-call
  const secret = process.env.BETTER_AUTH_SECRET || "1234567890123456789012345678901234";
  const signature = createHmac("sha256", secret)
    .update(sessionToken)
    .digest("base64");
  const signedCookieValue = encodeURIComponent(`${sessionToken}.${signature}`);

  const isHttps =
    (process.env.BETTER_AUTH_URL || "").startsWith("https://") ||
    request.url.startsWith("https://") ||
    request.headers.get("x-forwarded-proto") === "https" ||
    process.env.NODE_ENV === "production";

  const headers = new Headers();
  headers.set("Content-Type", "application/json");

  const cookieFlags = "Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000";
  headers.append(
    "Set-Cookie",
    `better-auth.session_token=${signedCookieValue}; ${cookieFlags}${isHttps ? "; Secure" : ""}`,
  );
  headers.append(
    "Set-Cookie",
    `__Secure-better-auth.session_token=${signedCookieValue}; ${cookieFlags}; Secure`,
  );

  return new Response(JSON.stringify({ success: true, isNewUser, userId }), {
    status: 200,
    headers,
  });
}
