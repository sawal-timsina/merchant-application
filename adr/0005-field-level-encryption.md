# ADR 0005: Application-level field encryption for the tax id

- Status: accepted
- Date: 2026-10-10

## Context

The merchant's tax id is sensitive. Disk or volume encryption does not protect it from database
dumps, backups, replicas or anyone with SQL access. Business staff only need to recognise it,
not read it in full.

## Decision

Encrypt in the application with AES-256-GCM (`FieldEncryptionService`):

- Stored format `v1.<keyId>.<iv>.<authTag>.<ciphertext>` with a fresh 96-bit IV per value.
- **Additional authenticated data** binds each value to its column
  (`merchant_applications.tax_id`): a ciphertext copied elsewhere fails to decrypt.
- **Key rotation**: `FIELD_ENCRYPTION_KEYS=v2:<new>,v1:<old>` (active first); old values stay
  readable, and `needsRotation()` identifies values to re-encrypt on their next write.
- The key is validated at startup; errors never include key material.
- `tax_id_last4` is stored in clear for display; responses never include the ciphertext, and the
  column is excluded from default selects. A check constraint keeps type, ciphertext and last4
  all set or all empty.

## Consequences

- A database leak alone does not reveal tax ids.
- Encrypted values cannot be searched or indexed; looking up by tax id would need a keyed blind
  index (HMAC) column.
- The key lives in the environment. Production should use KMS envelope encryption (a data key
  encrypted by a KMS master key) with access logging.

## Candidates for the same treatment

`owner_email` and `owner_phone` (masked today in audit and logs; encrypting them requires a blind
index to keep lookups), and any bank or settlement details once modelled.
