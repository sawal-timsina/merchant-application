import { randomBytes } from 'node:crypto';
import { FieldEncryptionService } from './field-encryption.service';
import { parseKeyring } from './keyring';

const key = () => randomBytes(32).toString('base64');
// Node's GCM auth-tag mismatch error.
const AUTH_FAILURE = /unable to authenticate data/;

describe('FieldEncryptionService', () => {
  const v1 = key();
  const service = new FieldEncryptionService(parseKeyring(`v1:${v1}`));
  const context = 'merchant_applications.tax_id';

  it('round-trips plaintext', () => {
    const encrypted = service.encrypt('123456789', context);
    expect(encrypted).not.toContain('123456789');
    expect(service.decrypt(encrypted, context)).toBe('123456789');
  });

  it('uses a fresh IV per encryption', () => {
    expect(service.encrypt('same', context)).not.toBe(service.encrypt('same', context));
  });

  it('rejects ciphertext moved to a different context', () => {
    const encrypted = service.encrypt('123456789', context);
    expect(() => service.decrypt(encrypted, 'users.email')).toThrow(AUTH_FAILURE);
  });

  it('rejects tampered ciphertext', () => {
    const parts = service.encrypt('123456789', context).split('.');
    const body = Buffer.from(parts[4]!, 'base64url');
    body[0]! ^= 0xff;
    parts[4] = body.toString('base64url');
    expect(() => service.decrypt(parts.join('.'), context)).toThrow(AUTH_FAILURE);
  });

  it('decrypts values written with a retired key after rotation', () => {
    const old = service.encrypt('123456789', context);
    const rotated = new FieldEncryptionService(parseKeyring(`v2:${key()},v1:${v1}`));

    expect(rotated.decrypt(old, context)).toBe('123456789');
    expect(rotated.needsRotation(old)).toBe(true);
    expect(rotated.needsRotation(rotated.encrypt('x', context))).toBe(false);
  });
});

describe('parseKeyring', () => {
  it('treats the first key as active', () => {
    expect(parseKeyring(`b:${key()}, a:${key()}`).activeKeyId).toBe('b');
  });

  it.each([
    ['empty', '', /at least one key/],
    ['missing id', `:${key()}`, /Invalid key id/],
    ['short key', `v1:${randomBytes(16).toString('base64')}`, /must be 32 bytes/],
    ['duplicate id', `v1:${key()},v1:${key()}`, /Duplicate key id/],
  ])('rejects %s', (_name, raw, message) => {
    expect(() => parseKeyring(raw)).toThrow(message);
  });

  it('never includes key material in errors', () => {
    const shortKey = randomBytes(16).toString('base64');
    expect(() => parseKeyring(`v1:${shortKey}`)).not.toThrow(shortKey);
  });
});
