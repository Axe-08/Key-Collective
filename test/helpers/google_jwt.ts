import { fetchMock } from "cloudflare:test";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { GOOGLE_JWKS_URL } from "../../src/auth/google/verify_id_token";

const PROJECT_ID = "key-collective-568f8";
const KID = "test-kid-google";
// jose caches the remote JWKS for the module's lifetime, which spans test files,
// so every file must sign with the same key pair.
interface SharedGoogleKeys {
  privateKey: CryptoKey;
  jwk: JWK;
}
const shared = globalThis as { __kcGoogleKeys?: Promise<SharedGoogleKeys> };

function googleKeys(): Promise<SharedGoogleKeys> {
  shared.__kcGoogleKeys ??= (async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    const jwk = (await exportJWK(pair.publicKey)) as JWK;
    Object.assign(jwk, { kid: KID, alg: "RS256", use: "sig" });
    return { privateKey: pair.privateKey, jwk };
  })();
  return shared.__kcGoogleKeys;
}

/** Serves a test JWKS at Google's URL; call from beforeAll. */
export async function installGoogleJwks(): Promise<void> {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  const { jwk } = await googleKeys();
  const url = new URL(GOOGLE_JWKS_URL);
  fetchMock
    .get(url.origin)
    .intercept({ path: url.pathname, method: "GET" })
    .reply(200, JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } })
    .persist();
}

/** A valid Firebase ID token for `sub`. */
export async function signGoogleIdToken(
  sub: string,
  email = `${sub}@example.test`,
  claims: Record<string, unknown> = { email_verified: true },
  { audience = PROJECT_ID, issuer = `https://securetoken.google.com/${PROJECT_ID}`, expiresIn = "1h" } = {}
): Promise<string> {
  const { privateKey } = await googleKeys();
  return new SignJWT({ email, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(privateKey);
}
