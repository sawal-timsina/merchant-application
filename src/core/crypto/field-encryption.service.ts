import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Keyring } from './keyring';

export const FIELD_ENCRYPTION_KEYRING = Symbol('FIELD_ENCRYPTION_KEYRING');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const FORMAT_VERSION = 'v1';

/**
 * Application-level field encryption (AES-256-GCM) for sensitive columns.
 *
 * `context` is bound as GCM additional authenticated data (e.g. "merchant_applications.tax_id"):
 * a ciphertext copied into another column or table fails to decrypt instead of leaking.
 */
@Injectable()
export class FieldEncryptionService {
  constructor(@Inject(FIELD_ENCRYPTION_KEYRING) private readonly keyring: Keyring) {}

  encrypt(plaintext: string, context: string): string {
    const keyId = this.keyring.activeKeyId;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key(keyId), iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [FORMAT_VERSION, keyId, iv, cipher.getAuthTag(), ciphertext]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  decrypt(payload: string, context: string): string {
    const [version, keyId, iv, tag, ciphertext] = payload.split('.');
    if (version !== FORMAT_VERSION || !keyId || !iv || !tag || ciphertext === undefined) {
      throw new Error('Malformed encrypted field');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key(keyId), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** True when the value was written with a key other than the active one (re-encrypt on next write). */
  needsRotation(payload: string): boolean {
    return payload.split('.')[1] !== this.keyring.activeKeyId;
  }

  private key(keyId: string): Buffer {
    const key = this.keyring.keys.get(keyId);
    if (!key) throw new Error(`Unknown field encryption key "${keyId}"`);
    return key;
  }
}
