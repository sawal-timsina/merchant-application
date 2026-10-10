import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { FieldEncryptionService } from '../../../core/crypto/field-encryption.service';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
} from '../../../core/domain/domain-error';
import type { Page } from '../../../core/http/pagination';
import { AuditService } from '../../audit/application/audit.service';
import { AuditAction } from '../../audit/domain/audit-action';
import type { Actor } from '../../identity/domain/actor';
import { ApplicationStatus } from '../domain/application.enums';
import { isEditable } from '../domain/application-state-machine';
import { type ApplicationAction, applicationScope, can } from '../domain/application.policy';
import { MerchantApplication } from '../infrastructure/persistence/merchant-application.entity';
import type {
  CreateApplicationDto,
  ListApplicationsQueryDto,
  UpdateApplicationDto,
} from '../presentation/application.dto';
import { encryptTaxId } from './tax-id';

export const ENTITY_TYPE = 'merchant_application';

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly crypto: FieldEncryptionService,
    private readonly audit: AuditService,
  ) {}

  /** Loads within the actor's scope: anything outside it is reported as not found (404). */
  async findVisibleOrFail(
    manager: EntityManager,
    actor: Actor,
    id: string,
    lock = false,
  ): Promise<MerchantApplication> {
    const application = await manager.findOne(MerchantApplication, {
      where: { id, ...applicationScope(actor) },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!application) throw new NotFoundError('Application');
    return application;
  }

  /** Visible but not permitted (e.g. SALES deciding its own application) is a 403. */
  assertCan(actor: Actor, action: ApplicationAction, application: MerchantApplication): void {
    if (!can(actor, action, application)) throw new ForbiddenError();
  }

  async create(actor: Actor, dto: CreateApplicationDto): Promise<MerchantApplication> {
    if (!can(actor, 'create')) throw new ForbiddenError();
    this.assertBusinessRules({ ...dto, hasTaxId: Boolean(dto.taxId) });
    const { taxId, ...fields } = dto;

    return this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(MerchantApplication, {
        ...fields,
        mcc: fields.mcc ?? null,
        taxIdType: fields.taxIdType ?? null,
        ...(taxId ? encryptTaxId(this.crypto, taxId) : { taxIdEncrypted: null, taxIdLast4: null }),
        status: ApplicationStatus.DRAFT,
        createdById: actor.id,
      });
      await this.audit.record(manager, {
        action: AuditAction.APPLICATION_CREATED,
        entityType: ENTITY_TYPE,
        entityId: saved.id,
        metadata: {
          businessName: saved.businessName,
          ownerEmail: saved.ownerEmail,
          ownerPhone: saved.ownerPhone,
        },
      });
      return manager.findOneByOrFail(MerchantApplication, { id: saved.id });
    });
  }

  get(actor: Actor, id: string): Promise<MerchantApplication> {
    return this.findVisibleOrFail(this.dataSource.manager, actor, id);
  }

  async list(actor: Actor, query: ListApplicationsQueryDto): Promise<Page<MerchantApplication>> {
    const [items, total] = await this.dataSource.getRepository(MerchantApplication).findAndCount({
      where: { ...applicationScope(actor), ...(query.status ? { status: query.status } : {}) },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async update(actor: Actor, id: string, dto: UpdateApplicationDto): Promise<MerchantApplication> {
    const { version, taxId, ...fields } = dto;
    return this.dataSource.transaction(async (manager) => {
      const current = await this.findVisibleOrFail(manager, actor, id, true);
      this.assertCan(actor, 'update', current);
      if (!isEditable(current.status)) {
        throw new InvalidStateError(`Application in status ${current.status} cannot be edited`);
      }
      if (current.version !== version) {
        throw new ConflictError('Application was modified by someone else; reload and retry');
      }
      this.assertBusinessRules({
        ...current,
        ...fields,
        hasTaxId: Boolean(taxId) || current.taxIdLast4 !== null,
      });

      // update() bumps the @VersionColumn; the row lock above makes the version check race-free.
      await manager.update(
        MerchantApplication,
        { id },
        { ...fields, ...(taxId ? encryptTaxId(this.crypto, taxId) : {}) },
      );
      await this.audit.record(manager, {
        action: AuditAction.APPLICATION_UPDATED,
        entityType: ENTITY_TYPE,
        entityId: id,
        metadata: { changedFields: [...Object.keys(fields), ...(taxId ? ['taxId'] : [])] },
      });
      return manager.findOneByOrFail(MerchantApplication, { id });
    });
  }

  private assertBusinessRules(input: {
    expectedMonthlyVolumeCents: number;
    averageTicketCents: number;
    taxIdType?: string | null;
    hasTaxId: boolean;
  }): void {
    if (input.averageTicketCents > input.expectedMonthlyVolumeCents) {
      throw new BusinessRuleError('averageTicketCents cannot exceed expectedMonthlyVolumeCents');
    }
    if (Boolean(input.taxIdType) !== input.hasTaxId) {
      throw new BusinessRuleError('taxIdType and taxId must be provided together');
    }
  }
}
