import type { INestApplication } from '@nestjs/common';
import { http } from './test-app';

export function bearer(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

export async function loginAs(
  app: INestApplication,
  user: { email: string; password: string },
): Promise<string> {
  const res = await http(app)
    .post('/auth/login')
    .send({ email: user.email, password: user.password })
    .expect(200);
  return res.body.accessToken as string;
}
