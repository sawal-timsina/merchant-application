import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Accepts a well-formed incoming x-request-id (so ids propagate across services), otherwise
 * generates one. Idempotent: pino-http and our middleware both call it, in either order.
 */
export function resolveRequestId(
  req: IncomingMessage & { id?: unknown },
  res: ServerResponse,
): string {
  if (typeof req.id === 'string') return req.id;
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader('x-request-id', id);
  return id;
}
