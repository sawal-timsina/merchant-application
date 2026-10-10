import { maskEmail, maskPhone, redact } from './redact';

describe('redact', () => {
  it('removes secrets at any depth, case- and separator-insensitively', () => {
    expect(
      redact({
        password: 'p',
        nested: { refresh_token: 't', AccessToken: 'a', apiSecret: 's' },
        list: [{ taxId: '123456789' }],
        authorization: 'Bearer x',
      }),
    ).toEqual({
      password: '[REDACTED]',
      nested: { refresh_token: '[REDACTED]', AccessToken: '[REDACTED]', apiSecret: '[REDACTED]' },
      list: [{ taxId: '[REDACTED]' }],
      authorization: '[REDACTED]',
    });
  });

  it('masks contact details but keeps non-sensitive fields', () => {
    expect(
      redact({
        ownerEmail: 'jane@example.com',
        ownerPhone: '+9779812345678',
        taxIdLast4: '6789',
        status: 'DRAFT',
      }),
    ).toEqual({
      ownerEmail: 'j***@example.com',
      ownerPhone: '**********5678',
      taxIdLast4: '6789',
      status: 'DRAFT',
    });
  });

  it('does not recurse forever on deep input', () => {
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 50; i++) deep = deep.child = {};
    expect(() => redact(root)).not.toThrow();
  });
});

describe('maskEmail / maskPhone', () => {
  it('handles short and malformed values', () => {
    expect(maskEmail('a@b.co')).toBe('a***@b.co');
    expect(maskEmail('not-an-email')).toBe('***');
    expect(maskPhone('123')).toBe('***');
  });
});
