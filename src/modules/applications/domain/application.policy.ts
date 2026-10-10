import {
  AbilityBuilder,
  createMongoAbility,
  type ForcedSubject,
  type MongoAbility,
  subject,
} from '@casl/ability';
import type { Actor } from '../../identity/domain/actor';
import { UserRole } from '../../identity/domain/user-role';

export type ApplicationAction =
  'create' | 'read' | 'update' | 'submit' | 'assign' | 'decide' | 'retryRisk';

/** The only fields authorization depends on. Keeps the policy independent of the ORM entity. */
export interface ApplicationAccessFacts {
  createdById: string;
  assignedReviewerId: string | null;
}

type Subject =
  'MerchantApplication' | (ApplicationAccessFacts & ForcedSubject<'MerchantApplication'>);
export type ApplicationAbility = MongoAbility<[ApplicationAction, Subject]>;

/** Who may do what. *When* (status) is the state machine's job, not this policy's. */
export function defineApplicationAbility(actor: Actor): ApplicationAbility {
  const { can: allow, build } = new AbilityBuilder<ApplicationAbility>(createMongoAbility);
  switch (actor.role) {
    case UserRole.ADMIN:
      allow(['create', 'read', 'update', 'submit', 'assign', 'retryRisk'], 'MerchantApplication');
      break;
    case UserRole.SALES:
      allow('create', 'MerchantApplication');
      allow(['read', 'update', 'submit'], 'MerchantApplication', { createdById: actor.id });
      break;
    case UserRole.REVIEWER:
      allow(['read', 'decide'], 'MerchantApplication', { assignedReviewerId: actor.id });
      break;
  }
  return build();
}

export function can(
  actor: Actor,
  action: ApplicationAction,
  facts?: ApplicationAccessFacts,
): boolean {
  const ability = defineApplicationAbility(actor);
  if (!facts) return ability.can(action, 'MerchantApplication');
  return ability.can(
    action,
    subject('MerchantApplication', {
      createdById: facts.createdById,
      assignedReviewerId: facts.assignedReviewerId,
    }),
  );
}

/** SQL-side equivalent of the `read` rule, so lists and lookups never load rows the actor may not see. */
export function applicationScope(actor: Actor): {
  createdById?: string;
  assignedReviewerId?: string;
} {
  switch (actor.role) {
    case UserRole.ADMIN:
      return {};
    case UserRole.SALES:
      return { createdById: actor.id };
    case UserRole.REVIEWER:
      return { assignedReviewerId: actor.id };
  }
}
