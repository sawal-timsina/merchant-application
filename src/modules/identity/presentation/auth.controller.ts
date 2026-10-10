import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AuthService } from '../application/auth.service';
import type { Actor } from '../domain/actor';
import { User } from '../infrastructure/persistence/user.entity';
import { LoginDto, MeResponse, RefreshDto, TokenPairResponse } from './auth.dto';
import { CurrentActor } from './current-actor.decorator';
import { Public } from './public.decorator';

// Decorator arguments are evaluated at import time, hence process.env (loaded before any import).
const LOGIN_LIMIT = Number(process.env.LOGIN_THROTTLE_LIMIT ?? 10);

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  @Public()
  @Throttle({ default: { limit: LOGIN_LIMIT, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ type: TokenPairResponse })
  @ApiUnauthorizedResponse()
  login(@Body() dto: LoginDto): Promise<TokenPairResponse> {
    return this.auth.login(dto.email, dto.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOkResponse({ type: TokenPairResponse })
  @ApiUnauthorizedResponse()
  refresh(@Body() dto: RefreshDto): Promise<TokenPairResponse> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOkResponse({ type: MeResponse })
  async me(@CurrentActor() actor: Actor): Promise<MeResponse> {
    const user = await this.users.findOneByOrFail({ id: actor.id });
    return { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
  }
}
