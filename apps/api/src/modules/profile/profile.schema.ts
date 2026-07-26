import { z } from 'zod';
import {
  adminOrgSchema,
  companyOrgSchema,
  recruiterProfileSchema,
  studentProfileSchema,
  universityOrgSchema,
} from '@code-nexus/types';

/** Re-export the shared profile schemas so the router imports from one place. */
export { studentProfileSchema, recruiterProfileSchema };

/** Pick the org schema for the caller's role. */
export function orgSchemaForRole(role: string): z.ZodTypeAny {
  switch (role) {
    case 'UNIVERSITY':
      return universityOrgSchema;
    case 'COMPANY':
      return companyOrgSchema;
    case 'ADMIN':
      return adminOrgSchema;
    default:
      return z.never();
  }
}

/** Pick the profile schema for the caller's role (student/recruiter only). */
export function profileSchemaForRole(role: string): z.ZodTypeAny | null {
  if (role === 'STUDENT') return studentProfileSchema;
  if (role === 'RECRUITER') return recruiterProfileSchema;
  return null;
}
