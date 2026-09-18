import { describe, it, expect, vi, beforeEach } from 'vitest';
import AddKeyModal, {
  openModal,
  closeModal,
  submitKey,
  getModalState,
  setModalSubmitHandler,
  encryptPayload,
  decryptPayload,
  generateNonce,
  uint8ArrayToBase64,
  base64ToUint8Array,
  NONCE_LENGTH_BYTES,
  ENCRYPTION_ALGORITHM,
  type KeyFormData,
  type KeyType,
  type EncryptedPayload,
} from './AddKeyModal.svelte';

describe('AddKeyModal & AES-256-GCM Web Crypto Encryption Requirements', () => {
  beforeEach(() => {
    closeModal();
    setModalSubmitHandler(undefined);
  });

  describe('Contract & Interface Signatures', () => {
    it('verifies exact signatures of exported functions', () => {
      expect(typeof openModal).toBe('function');
      expect(typeof closeModal).toBe('function');
      expect(typeof submitKey).toBe('function');

      // Verify openModal signature: function openModal(type: KeyType): void
      expect(openModal.length).toBeLessThanOrEqual(1);

      // Verify closeModal signature: function closeModal(): void
      expect(closeModal.length).toBe(0);

      // Verify submitKey signature: function submitKey(data: KeyFormData): Promise<void>
      expect(submitKey.length).toBe(1);
    });

    it('satisfies KeyFormData interface contract', async () => {
      const validData: KeyFormData = {
        name: 'test-gemini-key',
        key: 'AIzaSyA4_test_api_key_sample_token',
      };
      expect(validData.name).toBe('test-gemini-key');
      expect(validData.key).toBe('AIzaSyA4_test_api_key_sample_token');
    });

    it('exports Svelte component constructor', () => {
      expect(AddKeyModal).toBeDefined();
    });
  });

  describe('Modal Open and Close Lifecycle', () => {
    it('should open modal with specified KeyType', () => {
      expect(getModalState().isOpen).toBe(false);

      openModal('gemini');
      expect(getModalState().isOpen).toBe(true);
      expect(getModalState().type).toBe('gemini');

      openModal('groq');
      expect(getModalState().isOpen).toBe(true);
      expect(getModalState().type).toBe('groq');

      const customType: KeyType = 'openai';
      openModal(customType);
      expect(getModalState().isOpen).toBe(true);
      expect(getModalState().type).toBe('openai');
    });

    it('should close modal', () => {
      openModal('gemini');
      expect(getModalState().isOpen).toBe(true);

      closeModal();
      expect(getModalState().isOpen).toBe(false);
    });

    it('handles multiple open and close transitions idempotently', () => {
      closeModal();
      expect(getModalState().isOpen).toBe(false);

      openModal('gemini');
      expect(getModalState().isOpen).toBe(true);

      openModal('groq');
      expect(getModalState().isOpen).toBe(true);
      expect(getModalState().type).toBe('groq');

      closeModal();
      expect(getModalState().isOpen).toBe(false);

      closeModal();
      expect(getModalState().isOpen).toBe(false);
    });
  });

  describe('AES-256-GCM Encryption Requirements via Web Crypto API', () => {
    it('defines strict cryptographic invariants (12-byte nonce, AES-GCM)', () => {
      expect(NONCE_LENGTH_BYTES).toBe(12);
      expect(ENCRYPTION_ALGORITHM).toBe('AES-GCM');
    });

    it('generates cryptographically secure 12-byte nonces', () => {
      const nonce = generateNonce();
      expect(nonce).toBeInstanceOf(Uint8Array);
      expect(nonce.byteLength).toBe(12);

      // Verify distinct nonces (entropy)
      const nonce2 = generateNonce();
      expect(nonce).not.toEqual(nonce2);
    });

    it('enforces 12-byte nonce constraint on generateNonce', () => {
      expect(() => generateNonce(16)).toThrow(/expected 12 bytes/);
      expect(() => generateNonce(8)).toThrow(/expected 12 bytes/);
    });

    it('should encrypt payload before submit using Web Crypto AES-256-GCM', async () => {
      const keyData: KeyFormData = {
        name: 'prod-gemini-key',
        key: 'AIzaSyA_SUPER_SECRET_GEMINI_KEY_TOKEN_12345',
      };

      await submitKey(keyData);

      const state = getModalState();
      expect(state.lastSubmittedData).toEqual(keyData);
      expect(state.lastEncryptedPayload).toBeDefined();

      const encrypted = state.lastEncryptedPayload!;
      expect(encrypted.ciphertext).toBeInstanceOf(Uint8Array);
      expect(encrypted.nonce).toBeInstanceOf(Uint8Array);
      expect(encrypted.combined).toBeInstanceOf(Uint8Array);

      // Invariant: Nonce must strictly be 12 bytes (96 bits)
      expect(encrypted.nonce.byteLength).toBe(12);

      // Invariant: Ciphertext must be non-empty and must include 16-byte auth tag
      expect(encrypted.ciphertext.byteLength).toBeGreaterThan(16);

      // Invariant: No plaintext key exposed in ciphertext
      const ciphertextStr = new TextDecoder().decode(encrypted.ciphertext);
      expect(ciphertextStr).not.toContain(keyData.key);

      // Invariant: Combined buffer begins with 12-byte nonce
      expect(encrypted.combined.subarray(0, 12)).toEqual(encrypted.nonce);
      expect(encrypted.combined.subarray(12)).toEqual(encrypted.ciphertext);

      // Invariant: Base64 encodings match binary representations
      expect(encrypted.nonceB64).toBe(uint8ArrayToBase64(encrypted.nonce));
      expect(encrypted.ciphertextB64).toBe(uint8ArrayToBase64(encrypted.ciphertext));
      expect(encrypted.combinedB64).toBe(uint8ArrayToBase64(encrypted.combined));
    });

    it('enforces unique 12-byte nonces across consecutive submissions of identical keys', async () => {
      const keyData: KeyFormData = {
        name: 'repeated-key',
        key: 'gsk_IDENTICAL_TOKEN_REPEATED_SUBMISSION_TEST',
      };

      await submitKey(keyData);
      const firstPayload = { ...getModalState().lastEncryptedPayload! };

      await submitKey(keyData);
      const secondPayload = { ...getModalState().lastEncryptedPayload! };

      // Nonces must be unique (AES-GCM catastrophe prevention)
      expect(firstPayload.nonce).not.toEqual(secondPayload.nonce);
      expect(firstPayload.nonceB64).not.toBe(secondPayload.nonceB64);

      // Ciphertexts must differ due to unique nonces even with identical plaintext
      expect(firstPayload.ciphertext).not.toEqual(secondPayload.ciphertext);
      expect(firstPayload.ciphertextB64).not.toBe(secondPayload.ciphertextB64);
    });

    it('roundtrip: successfully decrypts encrypted payload back to original plaintext', async () => {
      const originalKey = 'AIzaSyA_ROUNDTRIP_DECRYPTION_VERIFICATION_KEY';
      const keyData: KeyFormData = {
        name: 'roundtrip-key',
        key: originalKey,
      };

      await submitKey(keyData);
      const encrypted = getModalState().lastEncryptedPayload!;

      const decrypted = await decryptPayload(encrypted.ciphertext, encrypted.nonce);
      expect(decrypted).toBe(originalKey);
    });

    it('rejects empty or whitespace-only API keys on submitKey', async () => {
      await expect(submitKey({ name: 'empty', key: '' })).rejects.toThrow(
        /Please provide a valid API key/
      );

      await expect(submitKey({ name: 'whitespace', key: '   ' })).rejects.toThrow(
        /Please provide a valid API key/
      );
    });

    it('notifies registered external submit handler with encrypted payload', async () => {
      const handlerSpy = vi.fn(async (_data: KeyFormData, _encrypted?: EncryptedPayload) => {});
      setModalSubmitHandler(handlerSpy);

      const keyData: KeyFormData = {
        name: 'handler-test-key',
        key: 'gsk_handler_test_api_token_payload',
      };

      await submitKey(keyData);

      expect(handlerSpy).toHaveBeenCalledTimes(1);
      const [receivedData, receivedEncrypted] = handlerSpy.mock.calls[0];
      expect(receivedData).toEqual(keyData);
      expect(receivedEncrypted).toBeDefined();
      if (!receivedEncrypted) throw new Error('receivedEncrypted missing');
      expect(receivedEncrypted.nonce.byteLength).toBe(12);
      expect(receivedEncrypted.ciphertext.byteLength).toBeGreaterThan(0);

      // Verify the passed encrypted payload decrypts cleanly
      const decrypted = await decryptPayload(
        receivedEncrypted.ciphertext,
        receivedEncrypted.nonce
      );
      expect(decrypted).toBe(keyData.key);
    });

    it('verifies base64 conversion utilities roundtrip accurately', () => {
      const sampleBytes = new Uint8Array([0, 1, 2, 254, 255, 128, 64, 32, 16, 8, 4, 2]);
      const b64 = uint8ArrayToBase64(sampleBytes);
      const restored = base64ToUint8Array(b64);
      expect(restored).toEqual(sampleBytes);
    });
  });
});
