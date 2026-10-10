export const UserRole = {
  ADMIN: 'ADMIN',
  REVIEWER: 'REVIEWER',
  SALES: 'SALES',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];
