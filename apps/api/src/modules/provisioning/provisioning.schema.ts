import { z } from 'zod';

const email = z
  .string()
  .email()
  .transform((v) => v.toLowerCase());
const name = z.string().min(1).max(200);

export const createUniversitySchema = z.object({
  email,
  name,
  code: z.string().min(2).max(32),
});

export const createCompanySchema = z.object({ email, name });

export const createPlatformAdminSchema = z.object({
  email,
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
});

export const createStudentSchema = z.object({
  email,
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
});

export const createRecruiterSchema = z.object({
  email,
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
});

export const publicIdParam = z.object({ publicId: z.string().uuid() });
