import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Page } from '../../../core/http/pagination';
import type { Actor } from '../../identity/domain/actor';
import { UserRole } from '../../identity/domain/user-role';
import { CurrentActor } from '../../identity/presentation/current-actor.decorator';
import { Roles } from '../../identity/presentation/roles.decorator';
import { ApplicationsService } from '../application/applications.service';
import {
  CreateApplicationDto,
  ListApplicationsQueryDto,
  UpdateApplicationDto,
} from './application.dto';
import { ApplicationResponse, toApplicationResponse } from './application.response';

@ApiTags('applications')
@ApiBearerAuth()
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Post()
  @Roles(UserRole.SALES, UserRole.ADMIN)
  @ApiCreatedResponse({ type: ApplicationResponse })
  async create(
    @CurrentActor() actor: Actor,
    @Body() dto: CreateApplicationDto,
  ): Promise<ApplicationResponse> {
    return toApplicationResponse(await this.applications.create(actor, dto));
  }

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Query() query: ListApplicationsQueryDto,
  ): Promise<Page<ApplicationResponse>> {
    const page = await this.applications.list(actor, query);
    return { ...page, items: page.items.map(toApplicationResponse) };
  }

  @Get(':id')
  @ApiOkResponse({ type: ApplicationResponse })
  async get(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApplicationResponse> {
    return toApplicationResponse(await this.applications.get(actor, id));
  }

  @Patch(':id')
  @Roles(UserRole.SALES, UserRole.ADMIN)
  @ApiOkResponse({ type: ApplicationResponse })
  async update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApplicationDto,
  ): Promise<ApplicationResponse> {
    return toApplicationResponse(await this.applications.update(actor, id, dto));
  }
}
