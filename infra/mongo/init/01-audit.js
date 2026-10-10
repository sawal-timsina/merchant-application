// Runs once on an empty volume (as root). Creates the audit collection, its indexes, and an
// application user that can only insert and read: append-only is enforced by the database.
const appPassword = process.env.MONGO_APP_PASSWORD;

for (const dbName of ['merchant', 'merchant_test']) {
  const target = db.getSiblingDB(dbName);
  target.createCollection('audit_logs');
  target.audit_logs.createIndex({ entityType: 1, entityId: 1, createdAt: -1 });
  target.audit_logs.createIndex({ actorId: 1, createdAt: -1 });
  target.audit_logs.createIndex({ action: 1, createdAt: -1 });
  target.createRole({
    role: 'auditAppendOnly',
    privileges: [
      { resource: { db: dbName, collection: 'audit_logs' }, actions: ['find', 'insert'] },
    ],
    roles: [],
  });
  target.createUser({
    user: 'audit_app',
    pwd: appPassword,
    roles: [{ role: 'auditAppendOnly', db: dbName }],
  });
}
