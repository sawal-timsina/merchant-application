import { SnakeNamingStrategy } from './snake-naming.strategy';

describe('SnakeNamingStrategy', () => {
  const strategy = new SnakeNamingStrategy();

  it('snake_cases columns, including embedded prefixes', () => {
    expect(strategy.columnName('expectedMonthlyVolumeCents', undefined, [])).toBe(
      'expected_monthly_volume_cents',
    );
    expect(strategy.columnName('line1', undefined, ['address'])).toBe('address_line1');
    expect(strategy.columnName('ignored', 'custom', [])).toBe('custom');
  });

  it('produces readable, deterministic constraint names', () => {
    expect(strategy.primaryKeyName('users')).toBe('pk_users');
    expect(strategy.foreignKeyName('merchant_applications', ['created_by_id'])).toBe(
      'fk_merchant_applications_created_by_id',
    );
    expect(strategy.indexName('audit_logs', ['actor_id', 'created_at'])).toBe(
      'idx_audit_logs_actor_id_created_at',
    );
  });

  it('stays within the 63-character Postgres identifier limit', () => {
    const columns = ['a_really_long_column_name', 'another_really_long_column_name'];
    const name = strategy.indexName('merchant_applications', columns);

    expect(name).toHaveLength(63);
    expect(name).toMatch(/^idx_merchant_applications_a_really_long_.*_[0-9a-f]{8}$/);
    // Same input, same name: migrations must be reproducible.
    expect(strategy.indexName('merchant_applications', columns)).toBe(name);
  });
});
