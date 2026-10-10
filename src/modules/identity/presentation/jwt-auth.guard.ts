import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { Repository } from 'typeorm';
import type { Env } from '../../../core/config/env';
import { RequestContext } from '../../../core/request-context/request-context';
import type { Actor } from '../domain/actor';
import { User } from '../infrastructure/persistence/user.entity';
import { IS_PUBLIC } from './public.decorator';

interface AccessTokenPayload {
  sub: string;
  role: string;
}

/** Global guard: every route requires a valid access token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: Actor }>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        algorithms: ['HS256'],
        issuer: this.config.get('JWT_ISSUER', { infer: true }),
        audience: this.config.get('JWT_AUDIENCE', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException();
    }

    // Reload so deactivation and role changes take effect before the token expires.
    const user = await this.users.findOne({
      where: { id: payload.sub },
      select: { id: true, role: true, isActive: true },
    });
    if (!user?.isActive) throw new UnauthorizedException();

    request.user = { id: user.id, role: user.role };
    RequestContext.setActor(request.user);
    return true;
  }
}
