import { z } from 'zod';

/**
 * Shared profile contracts — the SAME zod schemas validate on the client (form)
 * and the server (route). Single source of truth (prompt_phase3.md §2, §5).
 */

const name = z.string().trim().min(1).max(100);
const phone = z
  .string()
  .trim()
  .min(7)
  .max(20)
  .regex(/^[+()\-\s0-9]+$/, 'Enter a valid phone number');

// ---- Student ----------------------------------------------------------------

/**
 * Full student profile input. All fields REQUIRED here — this is the
 * completion/edit schema. (DB columns are nullable so the row exists before
 * completion; the required set is enforced by this schema.)
 */
export const studentProfileSchema = z.object({
  firstName: name,
  lastName: name,
  rollNumber: z.string().trim().min(1).max(50),
  branch: z.string().trim().min(1).max(100),
  graduationYear: z
    .number()
    .int()
    .min(1970)
    .max(new Date().getFullYear() + 10),
  cgpa: z.number().min(0).max(10),
  phone,
  // Optional extras.
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED']).optional(),
  dateOfBirth: z.string().date().optional(), // ISO yyyy-mm-dd; server stores as timestamptz
  resumeUrl: z.string().url().max(2000).optional(),
  // TODO(phaseN): resume/file upload via object storage (resumeUrl is a plain string for now)
});
export type StudentProfileInput = z.infer<typeof studentProfileSchema>;

// ---- Recruiter --------------------------------------------------------------

export const recruiterProfileSchema = z.object({
  firstName: name,
  lastName: name,
  designation: z.string().trim().min(1).max(120),
  phone,
});
export type RecruiterProfileInput = z.infer<typeof recruiterProfileSchema>;

// ---- Org (University / Company / Admin display) -----------------------------

export const universityOrgSchema = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(2).max(32),
  website: z.string().url().max(2000).optional(),
});
export type UniversityOrgInput = z.infer<typeof universityOrgSchema>;

export const companyOrgSchema = z.object({
  name: z.string().trim().min(1).max(200),
  website: z.string().url().max(2000).optional(),
});
export type CompanyOrgInput = z.infer<typeof companyOrgSchema>;

export const adminOrgSchema = z.object({
  firstName: name.optional(),
  lastName: name.optional(),
});
export type AdminOrgInput = z.infer<typeof adminOrgSchema>;

// ---- Response DTOs (what the API returns; no secrets) -----------------------

export interface StudentProfileDto {
  publicId: string;
  email: string;
  role: 'STUDENT';
  status: string;
  firstName: string | null;
  lastName: string | null;
  rollNumber: string | null;
  branch: string | null;
  graduationYear: number | null;
  cgpa: number | null;
  phone: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  resumeUrl: string | null;
  university: { publicId: string; name: string; code: string };
}

export interface RecruiterProfileDto {
  publicId: string;
  email: string;
  role: 'RECRUITER';
  status: string;
  firstName: string | null;
  lastName: string | null;
  designation: string | null;
  phone: string | null;
  company: { publicId: string; name: string };
}

export interface OrgProfileDto {
  publicId: string;
  email: string;
  role: 'UNIVERSITY' | 'COMPANY' | 'ADMIN';
  status: string;
  name: string | null;
  code: string | null;
  website: string | null;
}

export type ProfileDto = StudentProfileDto | RecruiterProfileDto | OrgProfileDto;
