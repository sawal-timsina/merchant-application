import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  requestId: string;
  ip: string | null;
  actor: { id: string; role: string } | null;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

/** Per-request (or per-job) context: correlation id and the authenticated actor. */
export const RequestContext = {
  run<T>(store: RequestContextStore, fn: () => T): T {
    return storage.run(store, fn);
  },
  get(): RequestContextStore | undefined {
    return storage.getStore();
  },
  setActor(actor: { id: string; role: string }): void {
    const store = storage.getStore();
    if (store) store.actor = actor;
  },
};
