import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../core/domain/domain-error';
import type { Page } from '../../../core/http/pagination';
import { AuditService } from '../../audit/application/audit.service';
import { AuditAction } from '../../audit/domain/audit-action';
import { UserRole } from '../domain/user-role';
import { RefreshToken } from '../infrastructure/persistence/refresh-token.entity';
import { User } from '../infrastructure/persistence/user.entity';
import type { CreatableRole } from '../presentation/users.dto';
import { PasswordHasher } from './password-hasher';

export interface CreateUserInput {
  email: string;
  fullName: string;
  role: CreatableRole;
  password: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateUserInput): Promise<User> {
    // Hash outside the transaction: argon2 is deliberately slow and needs no lock.
    const passwordHash = await this.hasher.hash(input.password);
    return this.dataSource.transaction(async (manager) => {
      // email is citext, so this check (and the unique index behind it) ignores case.
      if (await manager.existsBy(User, { email: input.email })) {
        throw new ConflictError('A user with this email already exists');
      }
      const user = await manager.save(
        manager.create(User, {
          email: input.email,
          fullName: input.fullName,
          role: input.role,
          passwordHash,
          isActive: true,
        }),
      );
      await this.audit.record(manager, {
        action: AuditAction.USER_CREATED,
        entityType: 'user',
        entityId: user.id,
        metadata: { email: user.email, role: user.role },
      });
      return manager.findOneByOrFail(User, { id: user.id });
    });
  }

  /**
   * Only SALES and REVIEWER accounts are managed through the API (admins are provisioned out of
   * band), which also stops an admin from locking themselves out. Deactivation takes effect on
   * the user's next request (the JWT guard reloads the user) and revokes all refresh tokens.
   */
  async setActive(id: string, isActive: boolean): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new NotFoundError('User');
      if (user.role === UserRole.ADMIN) {
        throw new ForbiddenError('ADMIN accounts cannot be changed through the API');
      }
      if (user.isActive === isActive) return user; // no-op: nothing to change or audit

      await manager.update(User, { id }, { isActive });
      if (!isActive) {
        await manager.update(
          RefreshToken,
          { userId: id, revokedAt: IsNull() },
          { revokedAt: new Date() },
        );
      }
      await this.audit.record(manager, {
        action: isActive ? AuditAction.USER_REACTIVATED : AuditAction.USER_DEACTIVATED,
        entityType: 'user',
        entityId: id,
        metadata: { role: user.role },
      });
      return manager.findOneByOrFail(User, { id });
    });
  }

  async list(query: { role?: UserRole; page: number; pageSize: number }): Promise<Page<User>> {
    const [items, total] = await this.dataSource.getRepository(User).findAndCount({
      where: query.role ? { role: query.role } : {},
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}
