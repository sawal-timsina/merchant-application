import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../domain/user-role';

export const ROLES = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);
