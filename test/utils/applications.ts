import type { INestApplication } from '@nestjs/common';
import { bearer } from './auth';
import { http } from './test-app';

export function validApplicationPayload(overrides: Record<string, unknown> = {}) {
  return {
    businessName: 'Himalayan Coffee',
    legalBusinessName: 'Himalayan Coffee Pvt Ltd',
    businessType: 'LLC',
    ownerFullName: 'Jane Doe',
    ownerEmail: 'jane.doe@example.com',
    ownerPhone: '+9779800000000',
    mcc: '5812',
    expectedMonthlyVolumeCents: 2_500_000,
    averageTicketCents: 1_500,
    currency: 'NPR',
    taxIdType: 'PAN',
    taxId: 'TEST-000123456',
    ...overrides,
  };
}

export async function createApplication(
  app: INestApplication,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await http(app)
    .post('/api/v1/applications')
    .set(...bearer(token))
    .send(validApplicationPayload(overrides))
    .expect(201);
  return res.body as { id: string; version: number; status: string } & Record<string, unknown>;
}
