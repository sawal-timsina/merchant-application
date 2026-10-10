import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Actor } from '../domain/actor';

export const CurrentActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Actor =>
    ctx.switchToHttp().getRequest<{ user: Actor }>().user,
);
