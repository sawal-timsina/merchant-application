import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { BusinessRuleError } from '../../../core/domain/domain-error';
import { ApiErrors } from '../../../core/http/error.response';
import { type Page, PageQueryDto } from '../../../core/http/pagination';
import { UserRole } from '../../identity/domain/user-role';
import { Roles } from '../../identity/presentation/roles.decorator';
import {
  AUDIT_READER,
  type AuditReader,
  type AuditRecord,
  type DecisionStatsRow,
} from '../domain/audit-record';

class AuditQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) entityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) action?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

class DecisionStatsQueryDto {
  @ApiProperty({ example: '2026-10-01' }) @Matches(DATE) from!: string;
  @ApiProperty({ example: '2026-11-01', description: 'Exclusive' }) @Matches(DATE) to!: string;
}

@ApiTags('audit')
@ApiBearerAuth()
@ApiErrors(400, 401, 403)
@Roles(UserRole.ADMIN)
@Controller('audit')
export class AuditController {
  constructor(@Inject(AUDIT_READER) private readonly reader: AuditReader) {}

  @Get()
  list(@Query() query: AuditQueryDto): Promise<Page<AuditRecord>> {
    return this.reader.find(query);
  }

  /** Decisions per reviewer per UTC day, e.g. for workload and approval-rate dashboards. */
  @Get('stats/decisions')
  decisionStats(@Query() query: DecisionStatsQueryDto): Promise<DecisionStatsRow[]> {
    const from = new Date(`${query.from}T00:00:00Z`);
    const to = new Date(`${query.to}T00:00:00Z`);
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (Number.isNaN(days)) throw new BusinessRuleError('from and to must be valid dates');
    if (days <= 0 || days > MAX_RANGE_DAYS) {
      throw new BusinessRuleError(`Range must be 1–${MAX_RANGE_DAYS} days, with from before to`);
    }
    return this.reader.decisionStats({ from, to });
  }
}
