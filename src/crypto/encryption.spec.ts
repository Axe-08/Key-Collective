import { describe, it, expect, beforeEach } from 'vitest';
import {
  EncryptionService,
  CryptoConfig,
  generateEncryptionKey,
  importKeyFromRaw,
  importKeyFromBase64,
  importKeyFromHex,
} from './encryption';

describe('EncryptionService', () => {
  let config: CryptoConfig;
  let service: EncryptionService;

  beforeEach(async () => {
    const key = await generateEncryptionKey();
    config = { encryptionKey: key };
    service = new EncryptionService(config);
  });

  it('should encrypt and decrypt a plaintext string successfully', async () => {
    const plaintext = 'sk-proj-super-secret-api-key-12345';
    const result = await service.encrypt(plaintext);

    expect(result).toHaveProperty('ciphertext');
    expect(result).toHaveProperty('nonce');
    expect(typeof result.ciphertext).toBe('string');
    expect(typeof result.nonce).toBe('string');
    expect(result.ciphertext.length).toBeGreaterThan(0);
    expect(result.nonce.length).toBeGreaterThan(0);

    const decrypted = await service.decrypt(result.ciphertext, result.nonce);
    expect(decrypted).toBe(plaintext);
  });

  it('should generate unique 12-byte nonces for consecutive encryptions of identical plaintext', async () => {
    const plaintext = 'identical-plaintext-key';
    const enc1 = await service.encrypt(plaintext);
    const enc2 = await service.encrypt(plaintext);

    // Nonces must be unique
    expect(enc1.nonce).not.toBe(enc2.nonce);
    // Ciphertexts must also differ due to unique nonces
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);

    // Both must decrypt cleanly
    expect(await service.decrypt(enc1.ciphertext, enc1.nonce)).toBe(plaintext);
    expect(await service.decrypt(enc2.ciphertext, enc2.nonce)).toBe(plaintext);

    // Check nonce byte length (12 bytes base64 encoded is 16 chars)
    const rawNonce = atob(enc1.nonce);
    expect(rawNonce.length).toBe(12);
  });

  it('should handle empty strings and unicode characters properly', async () => {
    const cases = [
      '',
      'Hello World! 🚀',
      '日本語のテストテキスト (Japanese test)',
      'Special chars: ~!@#$%^&*()_+`-={}|[]\\:";\'<>?,./',
      'A'.repeat(10000), // Large payload
    ];

    for (const testCase of cases) {
      const { ciphertext, nonce } = await service.encrypt(testCase);
      const decrypted = await service.decrypt(ciphertext, nonce);
      expect(decrypted).toBe(testCase);
    }
  });

  it('should throw an error if ciphertext has been tampered with', async () => {
    const plaintext = 'secure-token-value';
    const { ciphertext, nonce } = await service.encrypt(plaintext);

    // Corrupt the ciphertext by altering characters
    const tamperedCiphertext =
      ciphertext.charAt(0) === 'A' ? 'B' + ciphertext.slice(1) : 'A' + ciphertext.slice(1);

    await expect(service.decrypt(tamperedCiphertext, nonce)).rejects.toThrow();
  });

  it('should throw an error if nonce has been tampered with', async () => {
    const plaintext = 'secure-token-value';
    const { ciphertext, nonce } = await service.encrypt(plaintext);

    const tamperedNonce =
      nonce.charAt(0) === 'A' ? 'B' + nonce.slice(1) : 'A' + nonce.slice(1);

    await expect(service.decrypt(ciphertext, tamperedNonce)).rejects.toThrow();
  });

  it('should fail to decrypt when using a different encryption key', async () => {
    const plaintext = 'classified-information';
    const { ciphertext, nonce } = await service.encrypt(plaintext);

    const differentKey = await generateEncryptionKey();
    const otherService = new EncryptionService({ encryptionKey: differentKey });

    await expect(otherService.decrypt(ciphertext, nonce)).rejects.toThrow();
  });

  it('should support key import from raw, base64, and hex formats', async () => {
    const rawKeyBytes = crypto.getRandomValues(new Uint8Array(32)); // 256 bits

    const keyFromRaw = await importKeyFromRaw(rawKeyBytes);
    const service1 = new EncryptionService({ encryptionKey: keyFromRaw });

    const base64Str = btoa(String.fromCharCode(...rawKeyBytes));
    const keyFromBase64 = await importKeyFromBase64(base64Str);
    const service2 = new EncryptionService({ encryptionKey: keyFromBase64 });

    const hexStr = Array.from(rawKeyBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const keyFromHex = await importKeyFromHex(hexStr);
    const service3 = new EncryptionService({ encryptionKey: keyFromHex });

    const plaintext = 'symmetric-key-import-test';
    const { ciphertext, nonce } = await service1.encrypt(plaintext);

    expect(await service2.decrypt(ciphertext, nonce)).toBe(plaintext);
    expect(await service3.decrypt(ciphertext, nonce)).toBe(plaintext);
  });
});
