import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Repository } from 'typeorm';
import { type Page, PageQueryDto } from '../../../core/http/pagination';
import { UserRole } from '../../identity/domain/user-role';
import { Roles } from '../../identity/presentation/roles.decorator';
import { AuditLog } from '../infrastructure/persistence/audit-log.entity';

class AuditQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) entityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) action?: string;
}

@ApiTags('audit')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('audit')
export class AuditController {
  constructor(@InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>) {}

  @Get()
  async list(@Query() query: AuditQueryDto): Promise<Page<AuditLog>> {
    const [items, total] = await this.logs.findAndCount({
      where: {
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.action ? { action: query.action } : {}),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}
