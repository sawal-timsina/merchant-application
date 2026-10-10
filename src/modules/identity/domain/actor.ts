import type { UserRole } from './user-role';

/** The authenticated caller, as seen by domain policies. */
export interface Actor {
  id: string;
  role: UserRole;
}
