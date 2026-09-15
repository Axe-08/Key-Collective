/**
 * @file pkce.ts
 * RFC 7636 PKCE (Proof Key for Code Exchange) cryptographically secure generators and utilities.
 */

export function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function generateCodeVerifier(length = 64): string {
  const unreserved = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let verifier = "";
  const alphabetLen = unreserved.length;
  const maxValidByte = 256 - (256 % alphabetLen);
  let byteIdx = 0;
  while (verifier.length < length) {
    if (byteIdx >= bytes.length) {
      crypto.getRandomValues(bytes);
      byteIdx = 0;
    }
    const byte = bytes[byteIdx++];
    if (byte < maxValidByte) {
      verifier += unreserved[byte % alphabetLen];
    }
  }
  return verifier;
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return uint8ArrayToBase64Url(new Uint8Array(hashBuffer));
}

export interface PKCEBundle {
  verifier: string;
  challenge: string;
  stateToken: string;
  nonceHex: string;
}

export async function createPKCEBundle(): Promise<PKCEBundle> {
  const verifier = generateCodeVerifier(64);
  const challenge = await generateCodeChallenge(verifier);
  const stateBytes = new Uint8Array(24);
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(stateBytes);
  crypto.getRandomValues(nonceBytes);

  const stateToken = uint8ArrayToBase64Url(stateBytes);
  const nonceHex = Array.from(nonceBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem("kc_pkce_verifier", verifier);
    sessionStorage.setItem("kc_oauth_state", stateToken);
  }

  return { verifier, challenge, stateToken, nonceHex };
}
