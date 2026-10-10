const REDACTED = '[REDACTED]';
const MAX_DEPTH = 10;
const SECRET_FRAGMENTS = ['password', 'token', 'secret', 'authorization', 'cookie'];
const SECRET_KEYS = new Set(['taxid', 'taxidencrypted']);
const EMAIL_KEYS = new Set(['email', 'owneremail']);
const PHONE_KEYS = new Set(['phone', 'ownerphone']);

const normalize = (key: string) => key.replace(/[_-]/g, '').toLowerCase();

export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

export function maskPhone(phone: string): string {
  if (phone.length <= 4) return '***';
  return `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}`;
}

/** Deep-copies `value`, removing secrets and masking contact details. Used for audit metadata and logs. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => {
      const k = normalize(key);
      if (SECRET_KEYS.has(k) || SECRET_FRAGMENTS.some((f) => k.includes(f))) return [key, REDACTED];
      if (EMAIL_KEYS.has(k) && typeof inner === 'string') return [key, maskEmail(inner)];
      if (PHONE_KEYS.has(k) && typeof inner === 'string') return [key, maskPhone(inner)];
      return [key, redact(inner, depth + 1)];
    }),
  );
}
