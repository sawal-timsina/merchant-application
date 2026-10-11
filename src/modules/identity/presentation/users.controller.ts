import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../../core/http/error.response';
import { ApiPageResponse, type Page } from '../../../core/http/pagination';
import { UsersService } from '../application/users.service';
import { UserRole } from '../domain/user-role';
import type { User } from '../infrastructure/persistence/user.entity';
import { Roles } from './roles.decorator';
import { CreateUserDto, ListUsersQueryDto, UpdateUserStatusDto, UserResponse } from './users.dto';

/** Explicit allow-list: the password hash is never part of a response. */
const toUserResponse = (u: User): UserResponse => ({
  id: u.id,
  email: u.email,
  fullName: u.fullName,
  role: u.role,
  isActive: u.isActive,
  createdAt: u.createdAt,
});

@ApiTags('users')
@ApiBearerAuth()
@ApiErrors(400, 401, 403)
@Roles(UserRole.ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Creates a SALES or REVIEWER account. ADMIN accounts cannot be created through the API. */
  @Post()
  @ApiCreatedResponse({ type: UserResponse })
  @ApiErrors(409)
  async create(@Body() dto: CreateUserDto): Promise<UserResponse> {
    return toUserResponse(await this.users.create(dto));
  }

  /** Lists users, e.g. to pick a reviewer id for POST /applications/:id/assign. */
  @Get()
  @ApiPageResponse(UserResponse)
  async list(@Query() query: ListUsersQueryDto): Promise<Page<UserResponse>> {
    const page = await this.users.list(query);
    return { ...page, items: page.items.map(toUserResponse) };
  }

  /** Deactivates or reactivates a SALES/REVIEWER account. */
  @Patch(':id')
  @ApiOkResponse({ type: UserResponse })
  @ApiErrors(404)
  async setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
  ): Promise<UserResponse> {
    return toUserResponse(await this.users.setActive(id, dto.isActive));
  }
}
