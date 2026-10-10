export interface Keyring {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}

const KEY_BYTES = 32; // AES-256
const KEY_ID = /^[A-Za-z0-9_-]{1,16}$/;

/**
 * Parses `FIELD_ENCRYPTION_KEYS`: comma-separated `keyId:base64Key` pairs, active key first.
 * Older keys stay listed after a rotation so existing ciphertexts remain decryptable.
 *
 *   FIELD_ENCRYPTION_KEYS=v2:<new key>,v1:<old key>
 */
export function parseKeyring(raw: string): Keyring {
  const keys = new Map<string, Buffer>();
  for (const entry of raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)) {
    const separator = entry.indexOf(':');
    const keyId = entry.slice(0, separator);
    const key = Buffer.from(entry.slice(separator + 1), 'base64');
    if (separator < 1 || !KEY_ID.test(keyId)) {
      throw new Error(`Invalid key id in FIELD_ENCRYPTION_KEYS entry #${keys.size + 1}`);
    }
    if (key.length !== KEY_BYTES) {
      throw new Error(`Key "${keyId}" must be ${KEY_BYTES} bytes (base64), got ${key.length}`);
    }
    if (keys.has(keyId)) throw new Error(`Duplicate key id "${keyId}"`);
    keys.set(keyId, key);
  }
  const [activeKeyId] = keys.keys();
  if (!activeKeyId) throw new Error('FIELD_ENCRYPTION_KEYS must contain at least one key');
  return { activeKeyId, keys };
}
