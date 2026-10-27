import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';

// jsdom may shadow Node's WebCrypto; core hashes events with crypto.subtle.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
