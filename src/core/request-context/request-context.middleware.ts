import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RequestContext } from './request-context';
import { resolveRequestId } from './request-id';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: () => void): void {
    const requestId = resolveRequestId(req, res);
    RequestContext.run({ requestId, ip: req.ip ?? null, actor: null }, next);
  }
}
