/**
 * @file verify_id_token.ts
 * Verification of Firebase / Google identity tokens using jose.
 */

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { AuthenticationError } from "../../errors/auth_errors";

export const GOOGLE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

const JWKS = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

export interface FirebaseIdTokenPayload {
  uid: string;
  email: string;
}

export interface VerifyFirebaseIdTokenOptions {
  jwks?: JWTVerifyGetKey;
}

export async function verifyFirebaseIdToken(
  idToken: string,
  projectId: string,
  options?: VerifyFirebaseIdTokenOptions
): Promise<FirebaseIdTokenPayload> {
  const keySet = options?.jwks ?? JWKS;
  const { payload } = await jwtVerify(idToken, keySet, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
    algorithms: ["RS256"],
  });

  if (!payload.sub || payload.email_verified !== true) {
    throw new AuthenticationError("unverified_google_identity", {
      reason: "unverified_google_identity",
    });
  }

  return { uid: payload.sub, email: String(payload.email ?? "") };
}
