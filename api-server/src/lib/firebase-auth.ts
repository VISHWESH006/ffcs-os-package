import type { NextFunction, Request, Response } from "express";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { logger } from "./logger";

export interface AuthenticatedRequest extends Request {
  authUser?: { uid: string; authTime: number };
}

let firebaseInitializationError: Error | null = null;
let deletedTestUsers = new Set<string>();

function firebaseAuth() {
  if (firebaseInitializationError) throw firebaseInitializationError;
  try {
    if (!getApps().length) {
      const projectId = process.env.FIREBASE_PROJECT_ID?.trim() || process.env.GOOGLE_CLOUD_PROJECT?.trim();
      const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
      const credential = serviceAccountJson
        ? cert(JSON.parse(serviceAccountJson.replace(/\\n/g, "\n")))
        : applicationDefault();
      initializeApp({ credential, ...(projectId ? { projectId } : {}) });
    }
    return getAuth();
  } catch (error) {
    firebaseInitializationError = error instanceof Error ? error : new Error("Firebase Admin is not configured");
    throw firebaseInitializationError;
  }
}

function isFirebaseTokenError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return code.startsWith("auth/");
}

function testAuthEnabled(): boolean {
  return process.env.NODE_ENV === "test" && process.env.FFCS_TEST_AUTH === "1";
}

function testIdentity(token: string | undefined): { uid: string; authTime: number } | null | "invalid" {
  if (!testAuthEnabled()) return null;
  const bearer = token?.split(" ", 2);
  const value = bearer?.[0]?.toLowerCase() === "bearer" ? bearer[1] : undefined;
  if (!value && process.env.FFCS_TEST_AUTH_DEFAULT_UID) {
    return { uid: process.env.FFCS_TEST_AUTH_DEFAULT_UID, authTime: Math.floor(Date.now() / 1000) };
  }
  if (!value?.startsWith("test:")) return "invalid";
  const [, uid, marker] = value.split(":");
  if (!uid || marker === "invalid" || marker === "expired" || deletedTestUsers.has(uid)) return "invalid";
  return { uid, authTime: Math.floor(Date.now() / 1000) };
}

export async function requireFirebaseAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.header("authorization");
  const testUser = testIdentity(header);
  if (testUser && testUser !== "invalid") {
    (req as AuthenticatedRequest).authUser = testUser;
    next();
    return;
  }
  if (testUser === "invalid") {
    res.status(401).json({ error: "A valid Google sign-in is required" });
    return;
  }

  const match = /^Bearer\s+([^\s]+)$/i.exec(header ?? "");
  if (!match) {
    res.status(401).json({ error: "A valid Google sign-in is required" });
    return;
  }
  try {
    const decoded: DecodedIdToken = await firebaseAuth().verifyIdToken(match[1], true);
    if (!decoded.uid || decoded.firebase?.sign_in_provider !== "google.com") {
      res.status(401).json({ error: "A Google account is required" });
      return;
    }
    (req as AuthenticatedRequest).authUser = {
      uid: decoded.uid,
      authTime: Number(decoded.auth_time) || 0,
    };
    next();
  } catch (error) {
    if (isFirebaseTokenError(error)) {
      res.status(401).json({ error: "The sign-in token is invalid or expired" });
      return;
    }
    logger.error({ error }, "Firebase token verification is unavailable");
    res.status(503).json({ error: "Authentication service is not configured or unavailable" });
  }
}

export function currentUid(req: Request): string {
  const uid = (req as AuthenticatedRequest).authUser?.uid;
  if (!uid) throw new Error("Authenticated UID is missing");
  return uid;
}

export async function deleteFirebaseUser(uid: string): Promise<void> {
  if (testAuthEnabled()) {
    deletedTestUsers.add(uid);
    return;
  }
  await firebaseAuth().deleteUser(uid);
}

export function resetFirebaseAuthForTests(): void {
  if (!testAuthEnabled()) throw new Error("Test auth reset is only available in NODE_ENV=test");
  deletedTestUsers = new Set();
}
