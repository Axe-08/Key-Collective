# 1.3 Web Crypto and Byte Manipulation

The Key Collective infrastructure handles highly sensitive secrets. Our absolute, non-negotiable invariant is: **No Plaintext Keys are ever stored at rest.**

Everything in our D1 database must be encrypted using AES-256-GCM. 

If you are coming from Node.js, you might reach for `import crypto from 'crypto'`. Stop. You are in a V8 isolate. We do not have Node's standard library. We use the **Web Crypto API** (`crypto.subtle`). 

Working with Web Crypto means you aren't just passing strings around. You are manipulating raw memory buffers. 

## The Foundations: ArrayBuffer and Uint8Array

In JavaScript, an `ArrayBuffer` is a generic, fixed-length raw binary data buffer. You cannot directly manipulate its contents. To read or write to it, you need a "view." The most common view we use is `Uint8Array`, which treats the buffer as an array of 8-bit unsigned integers (bytes). 

When you read a key from the database, or prepare to encrypt a payload, you must convert your strings into `Uint8Array`s. 

```typescript
// Converting String -> Uint8Array
const encoder = new TextEncoder();
const data = encoder.encode("sk_live_123456789"); 
// data is now a Uint8Array representing the UTF-8 bytes of the string.

// Converting Uint8Array -> String
const decoder = new TextDecoder();
const originalString = decoder.decode(data);
```

## AES-256-GCM Encryption with Web Crypto

AES-GCM (Galois/Counter Mode) is an authenticated encryption algorithm. It doesn't just encrypt the data; it also generates an authentication tag that guarantees the data hasn't been tampered with. 

To use it safely, every single encryption operation MUST use a unique initialization vector (IV or nonce). In our system, we generate a random 12-byte nonce for every encryption and store it alongside the ciphertext. 

Here is our standard encryption workflow using the Web Crypto API:

```typescript
export async function encryptKey(
  plaintextKey: string, 
  masterKey: CryptoKey
): Promise<{ ciphertextBase64: string; nonceBase64: string }> {
  const encoder = new TextEncoder();
  const dataToEncrypt = encoder.encode(plaintextKey);
  
  // 1. Generate a unique 12-byte nonce for this encryption
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  
  // 2. Perform the encryption
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      tagLength: 128, // Standard 128-bit authentication tag
    },
    masterKey,
    dataToEncrypt
  );
  
  // 3. Convert buffers to base64 for storage
  return {
    ciphertextBase64: bufferToBase64(encryptedBuffer),
    nonceBase64: bufferToBase64(nonce)
  };
}
```

Notice that `crypto.subtle.encrypt` returns an `ArrayBuffer`. We cannot save an `ArrayBuffer` directly to a JSON payload or a standard text column in a database. We must encode it. 

## Base64 vs Base64Url

The standard way to encode binary data as a string is Base64. However, standard Base64 uses the characters `+` and `/`, which are not safe for URLs. 

Because encrypted identifiers might end up in URLs or HTTP headers, we frequently use **Base64Url** encoding (which replaces `+` with `-` and `/` with `_`, and omits padding). 

Since we don't have Node's `Buffer.from(data).toString('base64')`, we implement encoding manually. 

```typescript
// Utility to convert ArrayBuffer to standard Base64 string
export function bufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Utility to convert ArrayBuffer to Base64Url string
export function bufferToBase64Url(buffer: ArrayBuffer): string {
  const base64 = bufferToBase64(buffer);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
```

## Constant-Time Comparisons

When authenticating incoming API keys, you must compare the provided key against the expected value. 

If you use a standard string comparison (`a === b`), the engine compares the strings character by character, returning `false` the moment it finds a mismatch. This means checking `AXXXX` against `BXXXX` takes slightly less time than checking `ABXXX` against `ABYXX`. 

Attackers can measure these microscopic latency differences over thousands of requests to guess valid keys one character at a time. This is called a **Timing Attack**. 

To prevent this, sensitive comparisons must be done in **constant time**. It must take the exact same amount of time to compare two strings, regardless of where they differ. 

We do not implement our own constant-time loops. We rely on the Web Crypto API's cryptographic timing safeguards. By hashing both values and comparing the hashes, or using the timing-safe equality function if available in the runtime, we protect the system. 

If direct timing-safe comparison isn't available, we use HMAC to compare:

```typescript
export async function timingSafeCompare(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  
  // Generate a random, temporary key for this comparison
  const key = await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256" },
    true,
    ["sign"]
  );

  // Hash both inputs with the same key
  const sigA = await crypto.subtle.sign("HMAC", key, encoder.encode(a));
  const sigB = await crypto.subtle.sign("HMAC", key, encoder.encode(b));

  // Compare the resulting buffers. 
  // Note: While this approach mitigates string short-circuiting, 
  // true constant-time buffer comparison requires specific runtime support.
  if (sigA.byteLength !== sigB.byteLength) return false;
  
  const viewA = new Uint8Array(sigA);
  const viewB = new Uint8Array(sigB);
  
  let result = 0;
  for (let i = 0; i < viewA.length; i++) {
    result |= viewA[i] ^ viewB[i];
  }
  
  return result === 0;
}
```

Byte manipulation is not just trivia; it is the bedrock of our security posture. Respect the bytes.

### 4. Secure Random Nonce Generation & Base64url Encoding

Nonces must be uniformly random and generated using cryptographically secure PRNGs:

```typescript
// Cryptographically secure nonce generation and encoding
export function generateSecureNonce(lengthBytes: number = 12): Uint8Array {
  const nonce = new Uint8Array(lengthBytes);
  crypto.getRandomValues(nonce);
  return nonce;
}

export function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
```
