import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import type { Env } from '../../../core/config/env';
import { RefreshToken } from '../infrastructure/persistence/refresh-token.entity';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface IssuedRefreshToken {
  id: string;
  token: string;
  expiresAt: Date;
}

@Injectable()
export class RefreshTokenService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async issue(
    manager: EntityManager,
    userId: string,
    familyId: string = randomUUID(),
  ): Promise<IssuedRefreshToken> {
    const token = randomBytes(32).toString('base64url');
    const ttl = this.config.get('JWT_REFRESH_TTL_SECONDS', { infer: true });
    const saved = await manager.save(RefreshToken, {
      userId,
      familyId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + ttl * 1000),
      revokedAt: null,
      replacedById: null,
    });
    return { id: saved.id, token, expiresAt: saved.expiresAt };
  }
}
