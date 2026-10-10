import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource, type EntityManager } from 'typeorm';
import type { Env } from '../../../core/config/env';
import { AuditService } from '../../audit/application/audit.service';
import { AuditAction } from '../../audit/domain/audit-action';
import type { UserRole } from '../domain/user-role';
import { User } from '../infrastructure/persistence/user.entity';
import { PasswordHasher } from './password-hasher';
import { RefreshTokenService } from './refresh-token.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

const INVALID_CREDENTIALS = 'Invalid email or password';

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly hasher: PasswordHasher,
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async login(email: string, password: string): Promise<TokenPair> {
    const user = await this.dataSource.getRepository(User).findOne({
      where: { email },
      select: { id: true, role: true, isActive: true, passwordHash: true },
    });
    const valid = user
      ? await this.hasher.verify(user.passwordHash, password)
      : await this.hasher.verifyAgainstDummy(password);

    if (!user || !valid || !user.isActive) {
      await this.audit.record(this.dataSource.manager, {
        action: AuditAction.AUTH_LOGIN_FAILED,
        entityType: 'user',
        entityId: user?.id ?? null,
        actor: null,
        metadata: { email },
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return this.dataSource.transaction(async (manager) => {
      await this.audit.record(manager, {
        action: AuditAction.AUTH_LOGIN_SUCCEEDED,
        entityType: 'user',
        entityId: user.id,
        actor: { id: user.id, role: user.role },
      });
      return this.issueTokens(manager, user);
    });
  }

  async refresh(rawToken: string): Promise<TokenPair> {
    // Returning (not throwing) on reuse lets the family revocation commit before we answer 401.
    const outcome = await this.dataSource.transaction(async (manager) => {
      const rotation = await this.refreshTokens.rotate(manager, rawToken);
      if (rotation.kind === 'reused') {
        await this.audit.record(manager, {
          action: AuditAction.AUTH_REFRESH_REUSE_DETECTED,
          entityType: 'user',
          entityId: rotation.userId,
          actor: null,
        });
        return null;
      }
      if (rotation.kind === 'invalid') return null;

      const user = await manager.findOne(User, {
        where: { id: rotation.userId },
        select: { id: true, role: true, isActive: true },
      });
      if (!user?.isActive) return null;

      const next = await this.refreshTokens.issue(manager, user.id, rotation.familyId);
      await this.refreshTokens.markRotated(manager, rotation.tokenId, next.id);
      const { accessToken, expiresIn } = await this.signAccessToken(user);
      return { accessToken, refreshToken: next.token, tokenType: 'Bearer' as const, expiresIn };
    });
    if (!outcome) throw new UnauthorizedException('Invalid refresh token');
    return outcome;
  }

  async logout(rawToken: string): Promise<void> {
    await this.dataSource.transaction((manager) =>
      this.refreshTokens.revokeFamily(manager, rawToken),
    );
  }

  async issueTokens(
    manager: EntityManager,
    user: { id: string; role: UserRole },
    familyId?: string,
  ): Promise<TokenPair> {
    const { accessToken, expiresIn } = await this.signAccessToken(user);
    const refresh = await this.refreshTokens.issue(manager, user.id, familyId);
    return { accessToken, refreshToken: refresh.token, tokenType: 'Bearer', expiresIn };
  }

  async signAccessToken(user: {
    id: string;
    role: UserRole;
  }): Promise<{ accessToken: string; expiresIn: number }> {
    const expiresIn = this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role }, { expiresIn });
    return { accessToken, expiresIn };
  }
}
