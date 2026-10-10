import type { FieldEncryptionService } from '../../../core/crypto/field-encryption.service';

export const TAX_ID_CONTEXT = 'merchant_applications.tax_id';

export function encryptTaxId(
  crypto: FieldEncryptionService,
  taxId: string,
): { taxIdEncrypted: string; taxIdLast4: string } {
  return { taxIdEncrypted: crypto.encrypt(taxId, TAX_ID_CONTEXT), taxIdLast4: taxId.slice(-4) };
}
