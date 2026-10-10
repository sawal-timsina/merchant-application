import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiErrors } from '../../../core/http/error.response';
import { type Page, PageQueryDto } from '../../../core/http/pagination';
import { UserRole } from '../../identity/domain/user-role';
import { Roles } from '../../identity/presentation/roles.decorator';
import { AUDIT_READER, type AuditReader, type AuditRecord } from '../domain/audit-record';

class AuditQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) entityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) action?: string;
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
}
