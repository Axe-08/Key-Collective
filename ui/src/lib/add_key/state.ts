/**
 * @file state.ts
 * Reactive state store and lifecycle management for AddKeyModal.
 */

import { encryptPayload, type EncryptedPayload } from './crypto';

export type KeyType = 'gemini' | 'groq' | string;

export type KeyFormData = {
  name: string;
  key: string;
};

export interface ModalState {
  isOpen: boolean;
  type: KeyType;
  lastSubmittedData?: KeyFormData;
  lastEncryptedPayload?: EncryptedPayload;
}

const modalState: ModalState = {
  isOpen: false,
  type: 'gemini',
  lastSubmittedData: undefined,
  lastEncryptedPayload: undefined,
};

export type StateListener = (state: Readonly<ModalState>) => void;
const stateListeners = new Set<StateListener>();

function notifyListeners() {
  for (const listener of stateListeners) {
    listener(modalState);
  }
}

export function subscribeModalState(listener: StateListener): () => void {
  stateListeners.add(listener);
  listener(modalState);
  return () => stateListeners.delete(listener);
}

export function getModalState(): Readonly<ModalState> {
  return modalState;
}

let externalSubmitHandler: ((data: KeyFormData, encrypted?: EncryptedPayload) => Promise<void>) | undefined;

export function setModalSubmitHandler(
  handler?: (data: KeyFormData, encrypted?: EncryptedPayload) => Promise<void>
): void {
  externalSubmitHandler = handler;
}

export function openModal(type: KeyType = 'gemini'): void {
  modalState.isOpen = true;
  modalState.type = type;
  notifyListeners();
}

export function closeModal(): void {
  modalState.isOpen = false;
  notifyListeners();
}

export async function submitKey(data: KeyFormData): Promise<void> {
  if (!data.key || data.key.trim().length === 0) {
    throw new Error('Please provide a valid API key.');
  }

  const encrypted = await encryptPayload(data.key);

  modalState.lastSubmittedData = { ...data };
  modalState.lastEncryptedPayload = encrypted;
  notifyListeners();

  if (externalSubmitHandler) {
    await externalSubmitHandler(data, encrypted);
  }
}
