import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { OutboxEvent } from '../../src/core/outbox/outbox-event.entity';
import { OutboxPublisherRegistry } from '../../src/core/outbox/outbox-publisher.registry';
import { OutboxRelay } from '../../src/core/outbox/outbox-relay';
import { UserRole } from '../../src/modules/identity/domain/user-role';
import {
  RISK_REVIEW_QUEUE,
  riskJobId,
} from '../../src/modules/risk/infrastructure/queue/risk-queue';
import { createApplication } from '../utils/applications';
import { bearer, loginAs } from '../utils/auth';
import { createUser } from '../utils/factories';
import { createTestApp, http } from '../utils/test-app';

describe('Outbox relay', () => {
  let app: INestApplication;
  let sales: string;
  beforeAll(async () => {
    app = await createTestApp({ worker: true });
    sales = await loginAs(app, await createUser(app, { role: UserRole.SALES }));
  });
  afterAll(async () => app.close());

  it('publishes a submitted application as exactly one risk job, even when relayed twice', async () => {
    const created = await createApplication(app, sales);
    await http(app)
      .post(`/applications/${created.id}/submit`)
      .set(...bearer(sales))
      .expect(200);

    const relay = app.get(OutboxRelay);
    await relay.relayBatch();
    // Simulate a crash before "processed" was recorded: force a re-publish.
    await app
      .get(DataSource)
      .query(`UPDATE outbox_events SET processed_at = NULL WHERE aggregate_id = $1`, [created.id]);
    await relay.relayBatch();

    const queue = app.get<Queue>(getQueueToken(RISK_REVIEW_QUEUE));
    const job = await queue.getJob(riskJobId(created.id, 1));
    expect(job?.data).toMatchObject({ applicationId: created.id, submissionVersion: 1 });
    const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);
    expect(jobs.filter((j) => j.data.applicationId === created.id)).toHaveLength(1);

    const [{ processed }] = await app
      .get(DataSource)
      .query(
        `SELECT processed_at IS NOT NULL AS processed FROM outbox_events WHERE aggregate_id = $1`,
        [created.id],
      );
    expect(processed).toBe(true);
  });

  it('backs off and records the error when a handler fails', async () => {
    app.get(OutboxPublisherRegistry).register('TestAlwaysFails', async () => {
      throw new Error('boom');
    });
    const repo = app.get(DataSource).getRepository(OutboxEvent);
    const event = await repo.save(
      repo.create({
        aggregateType: 'test',
        aggregateId: '00000000-0000-0000-0000-000000000001',
        eventType: 'TestAlwaysFails',
        payload: {},
        correlationId: null,
      }),
    );
    await app.get(OutboxRelay).relayBatch();
    const after = await repo.findOneByOrFail({ id: event.id });
    expect(after).toMatchObject({ attempts: 1, lastError: 'boom', processedAt: null });
    expect(after.availableAt.getTime()).toBeGreaterThan(Date.now());
  });
});
