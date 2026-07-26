import { z } from 'zod';

/**
 * Phase 4 — Placement Drives & Applications contracts. The SAME zod schemas
 * validate on the client (forms/queries) and the server (routes). Single source
 * of truth. Mirrors the Prisma `DriveStatus` / `ApplicationStatus` enums.
 */

// ---- Enums (mirror packages/db/prisma/schema.prisma) ------------------------

export const DRIVE_STATUSES = ['DRAFT', 'OPEN', 'CLOSED'] as const;
export type DriveStatus = (typeof DRIVE_STATUSES)[number];

export const APPLICATION_STATUSES = [
  'APPLIED',
  'SHORTLISTED',
  'OFFERED',
  'REJECTED',
  'WITHDRAWN',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

// ---- Application state machine (defined ONCE; enforced in the API) -----------

/** Terminal statuses — no further transition is legal. */
export const TERMINAL_APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  'OFFERED',
  'REJECTED',
  'WITHDRAWN',
];

export function isTerminalApplicationStatus(s: ApplicationStatus): boolean {
  return TERMINAL_APPLICATION_STATUSES.includes(s);
}

/**
 * Company-initiated transitions (via `PATCH /applications/:publicId`).
 * FUTURE (do NOT add now): TEST_ASSIGNED / INTERVIEW_SCHEDULED stages arrive with
 * Phases 6–9 — extend this ONE map, don't rewrite the services.
 */
export const COMPANY_APPLICATION_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  APPLIED: ['SHORTLISTED', 'REJECTED'],
  SHORTLISTED: ['OFFERED', 'REJECTED'],
  OFFERED: [],
  REJECTED: [],
  WITHDRAWN: [],
};

/** Statuses a student may withdraw FROM (student-initiated → WITHDRAWN). */
export const STUDENT_WITHDRAWABLE_FROM: readonly ApplicationStatus[] = ['APPLIED', 'SHORTLISTED'];

export function canCompanyTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return COMPANY_APPLICATION_TRANSITIONS[from].includes(to);
}

export function canStudentWithdraw(from: ApplicationStatus): boolean {
  return STUDENT_WITHDRAWABLE_FROM.includes(from);
}

// ---- Eligibility (pure; reused client + server) -----------------------------

/** Normalized student facts used to evaluate eligibility. */
export interface EligibilityStudent {
  universityId: string;
  cgpa: number | null;
  branch: string | null;
  graduationYear: number | null;
}

/** Normalized drive facts used to evaluate eligibility. */
export interface EligibilityDrive {
  universityId: string;
  status: DriveStatus;
  applyDeadline: string | Date;
  minCgpa: number | null;
  allowedBranches: string[];
  allowedGraduationYears: number[];
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[]; // human-readable reasons the student is NOT eligible
}

function normBranch(b: string | null | undefined): string {
  return (b ?? '').trim().toLowerCase();
}

/**
 * The single source of truth for "can this student apply to this drive". The
 * server re-runs this at apply time (never trusting the client); the client
 * reuses it to render eligibility badges/reasons.
 */
export function evaluateEligibility(
  student: EligibilityStudent,
  drive: EligibilityDrive,
  now: Date = new Date(),
): EligibilityResult {
  const reasons: string[] = [];

  if (student.universityId !== drive.universityId) {
    reasons.push('This drive is not open to your university');
  }
  if (drive.status !== 'OPEN') {
    reasons.push('Drive is not open');
  }
  if (new Date(drive.applyDeadline).getTime() < now.getTime()) {
    reasons.push('Application deadline has passed');
  }
  if (student.cgpa == null || student.branch == null || student.graduationYear == null) {
    reasons.push('Complete your profile to apply');
  }
  if (drive.minCgpa != null && student.cgpa != null && student.cgpa < drive.minCgpa) {
    reasons.push(`Minimum CGPA of ${drive.minCgpa} not met`);
  }
  if (
    drive.allowedBranches.length > 0 &&
    student.branch != null &&
    !drive.allowedBranches.map(normBranch).includes(normBranch(student.branch))
  ) {
    reasons.push('Your branch is not eligible for this drive');
  }
  if (
    drive.allowedGraduationYears.length > 0 &&
    student.graduationYear != null &&
    !drive.allowedGraduationYears.includes(student.graduationYear)
  ) {
    reasons.push('Your graduation year is not eligible for this drive');
  }

  return { eligible: reasons.length === 0, reasons };
}

// ---- Zod schemas (create / update / query / decide) -------------------------

const title = z.string().trim().min(3).max(200);
const description = z.string().trim().min(1).max(10_000);
const branchList = z.array(z.string().trim().min(1).max(100)).max(100).default([]);
const gradYearList = z
  .array(
    z
      .number()
      .int()
      .min(1970)
      .max(new Date().getFullYear() + 10),
  )
  .max(50)
  .default([]);

/** Body for `POST /drives` (company creates a DRAFT drive). */
export const driveCreateSchema = z.object({
  universityPublicId: z.string().uuid(),
  title,
  description,
  roleTitle: z.string().trim().min(1).max(200).optional(),
  location: z.string().trim().min(1).max(200).optional(),
  ctcAnnual: z.number().int().min(0).max(1_000_000_000).optional(),
  minCgpa: z.number().min(0).max(10).optional(),
  allowedBranches: branchList,
  allowedGraduationYears: gradYearList,
  applyDeadline: z.string().datetime(), // ISO; server validates "future" on publish
});
export type DriveCreateInput = z.infer<typeof driveCreateSchema>;

/** Body for `PATCH /drives/:publicId` — all fields optional (edit while DRAFT/OPEN). */
export const driveUpdateSchema = z
  .object({
    title,
    description,
    roleTitle: z.string().trim().min(1).max(200).nullable(),
    location: z.string().trim().min(1).max(200).nullable(),
    ctcAnnual: z.number().int().min(0).max(1_000_000_000).nullable(),
    minCgpa: z.number().min(0).max(10).nullable(),
    allowedBranches: z.array(z.string().trim().min(1).max(100)).max(100),
    allowedGraduationYears: z
      .array(
        z
          .number()
          .int()
          .min(1970)
          .max(new Date().getFullYear() + 10),
      )
      .max(50),
    applyDeadline: z.string().datetime(),
  })
  .partial();
export type DriveUpdateInput = z.infer<typeof driveUpdateSchema>;

/** Applicant list filters (`GET /drives/:publicId/applicants?...`). Query strings → coerced. */
export const applicantsQuerySchema = z.object({
  branch: z.string().trim().min(1).max(100).optional(),
  minCgpa: z.coerce.number().min(0).max(10).optional(),
  graduationYear: z.coerce
    .number()
    .int()
    .min(1970)
    .max(new Date().getFullYear() + 10)
    .optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
  sort: z.enum(['cgpa_desc', 'cgpa_asc', 'recent']).optional(),
});
export type ApplicantsQuery = z.infer<typeof applicantsQuerySchema>;

/** Body for `PATCH /applications/:publicId` — company sets a decision status. */
export const applicationDecisionSchema = z.object({
  status: z.enum(['SHORTLISTED', 'OFFERED', 'REJECTED']),
  note: z.string().trim().max(2000).optional(),
});
export type ApplicationDecisionInput = z.infer<typeof applicationDecisionSchema>;

/** Filter for `GET /applications` (student own / university tracking). */
export const applicationsQuerySchema = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
});
export type ApplicationsQuery = z.infer<typeof applicationsQuerySchema>;

// ---- Response DTOs (no secrets; publicIds only) ------------------------------

/** Compact org reference. */
export interface OrgRef {
  publicId: string;
  name: string;
}

/** A selectable target university for the create-drive form. */
export interface UniversityOption {
  publicId: string;
  name: string;
  code: string;
}

export interface UniversitiesResponse {
  universities: UniversityOption[];
}

/** Full drive detail. `myApplication` is set for a student viewing the drive. */
export interface DriveDto {
  publicId: string;
  title: string;
  description: string;
  roleTitle: string | null;
  location: string | null;
  ctcAnnual: number | null;
  minCgpa: number | null;
  allowedBranches: string[];
  allowedGraduationYears: number[];
  applyDeadline: string; // ISO
  status: DriveStatus;
  company: OrgRef;
  university: OrgRef;
  createdAt: string;
  applicantCount?: number; // set for the owning company / admin
  eligibility?: EligibilityResult; // set for a student viewer
  myApplicationStatus?: ApplicationStatus | null; // set for a student viewer
  myApplicationPublicId?: string | null;
}

/** A row in a drive list (company/university/student feeds). */
export interface DriveListRow {
  publicId: string;
  title: string;
  roleTitle: string | null;
  status: DriveStatus;
  applyDeadline: string; // ISO
  company: OrgRef;
  university: OrgRef;
  applicantCount?: number; // company/admin
  myApplicationStatus?: ApplicationStatus | null; // student
}

export interface DriveListResponse {
  drives: DriveListRow[];
}

/** An applicant as seen by the owning company (academic summary + app state). */
export interface ApplicantRow {
  applicationPublicId: string;
  studentPublicId: string;
  status: ApplicationStatus;
  appliedAt: string; // ISO
  decisionAt: string | null;
  note: string | null;
  firstName: string | null;
  lastName: string | null;
  rollNumber: string | null;
  branch: string | null;
  graduationYear: number | null;
  cgpa: number | null;
  resumeUrl: string | null;
}

export interface ApplicantsResponse {
  drive: { publicId: string; title: string; status: DriveStatus };
  applicants: ApplicantRow[];
}

/** A student's own application (with the drive it targets). */
export interface MyApplicationRow {
  publicId: string;
  status: ApplicationStatus;
  appliedAt: string; // ISO
  decisionAt: string | null;
  drive: {
    publicId: string;
    title: string;
    roleTitle: string | null;
    status: DriveStatus;
    company: OrgRef;
  };
}

/** A university's view of one of its students' applications (placement tracking). */
export interface UniversityApplicationRow {
  publicId: string;
  status: ApplicationStatus;
  appliedAt: string; // ISO
  decisionAt: string | null;
  student: {
    publicId: string;
    firstName: string | null;
    lastName: string | null;
    rollNumber: string | null;
    branch: string | null;
  };
  drive: { publicId: string; title: string; company: OrgRef };
}

export interface ApplicationsResponse {
  applications: MyApplicationRow[];
}

export interface UniversityApplicationsResponse {
  applications: UniversityApplicationRow[];
}
