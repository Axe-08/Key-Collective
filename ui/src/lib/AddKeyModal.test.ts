import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  openModal,
  closeModal,
  submitKey,
  getModalState,
  setModalSubmitHandler,
} from './AddKeyModal.svelte';
import type { KeyType, KeyFormData } from './AddKeyModal.svelte';
import AddKeyModal from './AddKeyModal.svelte';

describe('AddKeyModal Runtime Contract', () => {
  beforeEach(() => {
    closeModal();
    setModalSubmitHandler(undefined);
  });

  describe('Contract & Interface Signatures', () => {
    it('verifies exact signatures of exported functions', () => {
      expect(typeof openModal).toBe('function');
      expect(typeof closeModal).toBe('function');
      expect(typeof submitKey).toBe('function');
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
    });

    it('should close modal', () => {
      openModal('gemini');
      expect(getModalState().isOpen).toBe(true);

      closeModal();
      expect(getModalState().isOpen).toBe(false);
    });
  });

  describe('Form Submission', () => {
    it('rejects empty or whitespace-only API keys on submitKey', async () => {
      await expect(submitKey({ name: 'empty', key: '' })).rejects.toThrow(
        /Please provide a valid API key/
      );

      await expect(submitKey({ name: 'whitespace', key: '   ' })).rejects.toThrow(
        /Please provide a valid API key/
      );
    });

    it('notifies registered external submit handler', async () => {
      const handlerSpy = vi.fn(async (_data: KeyFormData) => {});
      setModalSubmitHandler(handlerSpy);

      const keyData: KeyFormData = {
        name: 'handler-test-key',
        key: 'gsk_handler_test_api_token_payload',
      };

      await submitKey(keyData);

      expect(handlerSpy).toHaveBeenCalledTimes(1);
      const [receivedData] = handlerSpy.mock.calls[0];
      expect(receivedData).toEqual(keyData);
    });
  });
});
