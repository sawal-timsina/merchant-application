import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type EntityManager, IsNull } from 'typeorm';
import type { Env } from '../../../core/config/env';
import { RefreshToken } from '../infrastructure/persistence/refresh-token.entity';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface IssuedRefreshToken {
  id: string;
  token: string;
  expiresAt: Date;
}

export type RotationResult =
  | { kind: 'rotated'; userId: string; familyId: string; tokenId: string }
  | { kind: 'invalid' }
  | { kind: 'reused'; userId: string };

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

  /**
   * Must run inside a transaction. The row lock serialises concurrent rotations of the same
   * token: the loser sees it already rotated and is treated as a replay.
   */
  async rotate(manager: EntityManager, rawToken: string): Promise<RotationResult> {
    const current = await manager.findOne(RefreshToken, {
      where: { tokenHash: hashToken(rawToken) },
      lock: { mode: 'pessimistic_write' },
    });
    if (!current) return { kind: 'invalid' };
    if (current.revokedAt) {
      await this.revokeFamilyById(manager, current.familyId);
      return { kind: 'reused', userId: current.userId };
    }
    if (current.expiresAt <= new Date()) return { kind: 'invalid' };
    return {
      kind: 'rotated',
      userId: current.userId,
      familyId: current.familyId,
      tokenId: current.id,
    };
  }

  async markRotated(manager: EntityManager, tokenId: string, replacedById: string): Promise<void> {
    await manager.update(RefreshToken, { id: tokenId }, { revokedAt: new Date(), replacedById });
  }

  async revokeFamily(manager: EntityManager, rawToken: string): Promise<void> {
    const token = await manager.findOne(RefreshToken, {
      where: { tokenHash: hashToken(rawToken) },
    });
    if (token) await this.revokeFamilyById(manager, token.familyId);
  }

  private async revokeFamilyById(manager: EntityManager, familyId: string): Promise<void> {
    await manager.update(
      RefreshToken,
      { familyId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }
}
