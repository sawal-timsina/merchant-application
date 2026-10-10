import { DefaultNamingStrategy, type NamingStrategyInterface, type Table } from 'typeorm';
import { hash, snakeCase } from 'typeorm/util/StringUtils';

const PG_MAX_IDENTIFIER = 63;

function bareTableName(tableOrName: Table | string): string {
  const name = typeof tableOrName === 'string' ? tableOrName : tableOrName.name;
  return name.split('.').at(-1) ?? name;
}

/** Keeps generated names readable while staying within Postgres' identifier limit. */
function identifier(name: string): string {
  if (name.length <= PG_MAX_IDENTIFIER) return name;
  return `${name.slice(0, PG_MAX_IDENTIFIER - 9)}_${hash(name, { length: 8 })}`;
}

/**
 * snake_case tables/columns and deterministic, human-readable constraint names
 * (pk_users, fk_merchant_applications_created_by_id, ...) instead of TypeORM's hashes,
 * so hand-reviewed migrations and entity metadata agree on names.
 */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  override tableName(targetName: string, userSpecifiedName: string | undefined): string {
    return userSpecifiedName ?? snakeCase(targetName);
  }

  override columnName(
    propertyName: string,
    customName: string | undefined,
    embeddedPrefixes: string[],
  ): string {
    return customName ?? snakeCase([...embeddedPrefixes, propertyName].join('_'));
  }

  override relationName(propertyName: string): string {
    return snakeCase(propertyName);
  }

  override joinColumnName(relationName: string, referencedColumnName: string): string {
    return snakeCase(`${relationName}_${referencedColumnName}`);
  }

  override primaryKeyName(tableOrName: Table | string): string {
    return identifier(`pk_${bareTableName(tableOrName)}`);
  }

  override uniqueConstraintName(tableOrName: Table | string, columnNames: string[]): string {
    return identifier(`uq_${bareTableName(tableOrName)}_${columnNames.join('_')}`);
  }

  override relationConstraintName(tableOrName: Table | string, columnNames: string[]): string {
    return identifier(`rel_${bareTableName(tableOrName)}_${columnNames.join('_')}`);
  }

  override foreignKeyName(tableOrName: Table | string, columnNames: string[]): string {
    return identifier(`fk_${bareTableName(tableOrName)}_${columnNames.join('_')}`);
  }

  override indexName(tableOrName: Table | string, columnNames: string[]): string {
    return identifier(`idx_${bareTableName(tableOrName)}_${columnNames.join('_')}`);
  }
}
