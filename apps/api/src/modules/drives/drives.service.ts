import { Prisma, prisma } from '@code-nexus/db';
import {
  evaluateEligibility,
  type ApplicantRow,
  type ApplicantsQuery,
  type ApplicantsResponse,
  type DriveCreateInput,
  type DriveDto,
  type DriveListRow,
  type DriveUpdateInput,
  type EligibilityStudent,
} from '@code-nexus/types';
import type { Express } from 'express';
import { AppError } from '../../errors.js';

type Auth = Express.AuthContext;

export function decToNum(d: unknown): number | null {
  if (d == null) return null;
  return typeof d === 'number' ? d : Number((d as { toString(): string }).toString());
}

// A drive loaded with the relations every DTO needs.
const driveInclude = {
  company: true,
  university: true,
  _count: { select: { applications: true } },
} satisfies Prisma.DriveInclude;

type DriveWithRels = Prisma.DriveGetPayload<{ include: typeof driveInclude }>;

function mapDriveListRow(d: DriveWithRels, extras: Partial<DriveListRow> = {}): DriveListRow {
  return {
    publicId: d.publicId,
    title: d.title,
    roleTitle: d.roleTitle,
    status: d.status,
    applyDeadline: d.applyDeadline.toISOString(),
    company: { publicId: d.company.publicId, name: d.company.name },
    university: { publicId: d.university.publicId, name: d.university.name },
    ...extras,
  };
}

function mapDriveDto(d: DriveWithRels, extras: Partial<DriveDto> = {}): DriveDto {
  return {
    publicId: d.publicId,
    title: d.title,
    description: d.description,
    roleTitle: d.roleTitle,
    location: d.location,
    ctcAnnual: d.ctcAnnual,
    minCgpa: decToNum(d.minCgpa),
    allowedBranches: d.allowedBranches,
    allowedGraduationYears: d.allowedGraduationYears,
    applyDeadline: d.applyDeadline.toISOString(),
    status: d.status,
    company: { publicId: d.company.publicId, name: d.company.name },
    university: { publicId: d.university.publicId, name: d.university.name },
    createdAt: d.createdAt.toISOString(),
    ...extras,
  };
}

/** The student's facts needed for eligibility (loaded from the session's userId). */
export async function loadStudentFacts(
  userId: string,
): Promise<{ id: string; facts: EligibilityStudent }> {
  const s = await prisma.student.findUnique({ where: { userId } });
  if (!s) throw new AppError(404, 'NOT_FOUND', 'Student profile not found');
  return {
    id: s.id,
    facts: {
      universityId: s.universityId,
      cgpa: decToNum(s.cgpa),
      branch: s.branch,
      graduationYear: s.graduationYear,
    },
  };
}

/** Resolve a target university by publicId (must exist and be active). */
async function resolveUniversityId(publicId: string): Promise<string> {
  const uni = await prisma.university.findFirst({ where: { publicId, deletedAt: null } });
  if (!uni) throw new AppError(404, 'NOT_FOUND', 'Target university not found');
  return uni.id;
}

/** Directory of universities a company can target when creating a drive. */
export async function listUniversities(): Promise<
  { publicId: string; name: string; code: string }[]
> {
  const unis = await prisma.university.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
  });
  return unis.map((u) => ({ publicId: u.publicId, name: u.name, code: u.code }));
}

/**
 * Load a drive by publicId, enforcing that `auth` may see it. Cross-tenant access
 * (a company that doesn't own it, a university/student it doesn't target, a
 * DRAFT drive seen by anyone but the owner) yields 404 — we don't leak existence.
 */
async function loadVisibleDrive(auth: Auth, publicId: string): Promise<DriveWithRels> {
  const d = await prisma.drive.findFirst({
    where: { publicId, deletedAt: null },
    include: driveInclude,
  });
  if (!d) throw AppError.notFound('Drive not found');

  switch (auth.role) {
    case 'ADMIN':
      return d;
    case 'COMPANY':
      if (d.companyId === auth.companyId) return d;
      break;
    case 'UNIVERSITY':
      if (d.universityId === auth.universityId && d.status !== 'DRAFT') return d;
      break;
    case 'STUDENT':
      // A student may view non-DRAFT drives targeting their own university.
      if (d.universityId === auth.universityId && d.status !== 'DRAFT') return d;
      break;
  }
  throw AppError.notFound('Drive not found');
}

// ---- Commands ---------------------------------------------------------------

export async function createDrive(companyId: string, input: DriveCreateInput): Promise<DriveDto> {
  const universityId = await resolveUniversityId(input.universityPublicId);
  const created = await prisma.drive.create({
    data: {
      companyId,
      universityId,
      title: input.title,
      description: input.description,
      roleTitle: input.roleTitle,
      location: input.location,
      ctcAnnual: input.ctcAnnual,
      minCgpa: input.minCgpa != null ? new Prisma.Decimal(input.minCgpa) : null,
      allowedBranches: input.allowedBranches,
      allowedGraduationYears: input.allowedGraduationYears,
      applyDeadline: new Date(input.applyDeadline),
      status: 'DRAFT',
    },
    include: driveInclude,
  });
  return mapDriveDto(created, { applicantCount: 0 });
}

export async function updateDrive(
  auth: Auth,
  publicId: string,
  input: DriveUpdateInput,
): Promise<DriveDto> {
  const drive = await loadVisibleDrive(auth, publicId);
  if (drive.status === 'CLOSED') {
    throw new AppError(409, 'CONFLICT', 'A closed drive can no longer be edited');
  }
  const data: Prisma.DriveUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.roleTitle !== undefined) data.roleTitle = input.roleTitle;
  if (input.location !== undefined) data.location = input.location;
  if (input.ctcAnnual !== undefined) data.ctcAnnual = input.ctcAnnual;
  if (input.minCgpa !== undefined) {
    data.minCgpa = input.minCgpa != null ? new Prisma.Decimal(input.minCgpa) : null;
  }
  if (input.allowedBranches !== undefined) data.allowedBranches = input.allowedBranches;
  if (input.allowedGraduationYears !== undefined) {
    data.allowedGraduationYears = input.allowedGraduationYears;
  }
  if (input.applyDeadline !== undefined) data.applyDeadline = new Date(input.applyDeadline);

  const updated = await prisma.drive.update({
    where: { id: drive.id },
    data,
    include: driveInclude,
  });
  return mapDriveDto(updated, { applicantCount: updated._count.applications });
}

export async function publishDrive(auth: Auth, publicId: string): Promise<DriveDto> {
  const drive = await loadVisibleDrive(auth, publicId);
  if (drive.status !== 'DRAFT') {
    throw new AppError(409, 'CONFLICT', 'Only a draft drive can be published');
  }
  if (drive.applyDeadline.getTime() <= Date.now()) {
    throw new AppError(400, 'VALIDATION', 'Apply deadline must be in the future to publish');
  }
  const updated = await prisma.drive.update({
    where: { id: drive.id },
    data: { status: 'OPEN' },
    include: driveInclude,
  });
  return mapDriveDto(updated, { applicantCount: updated._count.applications });
}

export async function closeDrive(auth: Auth, publicId: string): Promise<DriveDto> {
  const drive = await loadVisibleDrive(auth, publicId);
  if (drive.status !== 'OPEN') {
    throw new AppError(409, 'CONFLICT', 'Only an open drive can be closed');
  }
  const updated = await prisma.drive.update({
    where: { id: drive.id },
    data: { status: 'CLOSED' },
    include: driveInclude,
  });
  return mapDriveDto(updated, { applicantCount: updated._count.applications });
}

// ---- Queries ----------------------------------------------------------------

export async function getDrive(auth: Auth, publicId: string): Promise<DriveDto> {
  const drive = await loadVisibleDrive(auth, publicId);

  if (auth.role === 'STUDENT') {
    const { id: studentId, facts } = await loadStudentFacts(auth.userId);
    const eligibility = evaluateEligibility(facts, {
      universityId: drive.universityId,
      status: drive.status,
      applyDeadline: drive.applyDeadline,
      minCgpa: decToNum(drive.minCgpa),
      allowedBranches: drive.allowedBranches,
      allowedGraduationYears: drive.allowedGraduationYears,
    });
    const mine = await prisma.application.findUnique({
      where: { driveId_studentId: { driveId: drive.id, studentId } },
    });
    return mapDriveDto(drive, {
      eligibility,
      myApplicationStatus: mine?.status ?? null,
      myApplicationPublicId: mine?.publicId ?? null,
    });
  }

  return mapDriveDto(drive, { applicantCount: drive._count.applications });
}

export async function listDrivesForActor(auth: Auth): Promise<DriveListRow[]> {
  switch (auth.role) {
    case 'COMPANY': {
      const drives = await prisma.drive.findMany({
        where: { companyId: auth.companyId ?? '__none__', deletedAt: null },
        include: driveInclude,
        orderBy: { createdAt: 'desc' },
      });
      return drives.map((d) => mapDriveListRow(d, { applicantCount: d._count.applications }));
    }
    case 'ADMIN': {
      const drives = await prisma.drive.findMany({
        where: { deletedAt: null },
        include: driveInclude,
        orderBy: { createdAt: 'desc' },
      });
      return drives.map((d) => mapDriveListRow(d, { applicantCount: d._count.applications }));
    }
    case 'UNIVERSITY': {
      const drives = await prisma.drive.findMany({
        where: {
          universityId: auth.universityId ?? '__none__',
          deletedAt: null,
          status: { not: 'DRAFT' },
        },
        include: driveInclude,
        orderBy: { applyDeadline: 'asc' },
      });
      return drives.map((d) => mapDriveListRow(d, { applicantCount: d._count.applications }));
    }
    case 'STUDENT': {
      const { id: studentId, facts } = await loadStudentFacts(auth.userId);
      const now = new Date();
      const drives = await prisma.drive.findMany({
        where: {
          universityId: facts.universityId,
          deletedAt: null,
          status: 'OPEN',
          applyDeadline: { gte: now },
        },
        include: driveInclude,
        orderBy: { applyDeadline: 'asc' },
      });
      // Only surface drives the student is actually eligible for (reasons live on detail).
      const eligible = drives.filter(
        (d) =>
          evaluateEligibility(
            facts,
            {
              universityId: d.universityId,
              status: d.status,
              applyDeadline: d.applyDeadline,
              minCgpa: decToNum(d.minCgpa),
              allowedBranches: d.allowedBranches,
              allowedGraduationYears: d.allowedGraduationYears,
            },
            now,
          ).eligible,
      );
      const mine = await prisma.application.findMany({
        where: { studentId, driveId: { in: eligible.map((d) => d.id) } },
        select: { driveId: true, status: true },
      });
      const byDrive = new Map(mine.map((a) => [a.driveId, a.status]));
      return eligible.map((d) =>
        mapDriveListRow(d, { myApplicationStatus: byDrive.get(d.id) ?? null }),
      );
    }
    default:
      return [];
  }
}

export async function listApplicants(
  auth: Auth,
  publicId: string,
  query: ApplicantsQuery,
): Promise<ApplicantsResponse> {
  const drive = await loadVisibleDrive(auth, publicId); // company-owner/admin only reach here

  const studentWhere: Prisma.StudentWhereInput = {};
  if (query.branch) studentWhere.branch = { equals: query.branch, mode: 'insensitive' };
  if (query.minCgpa != null) studentWhere.cgpa = { gte: new Prisma.Decimal(query.minCgpa) };
  if (query.graduationYear != null) studentWhere.graduationYear = query.graduationYear;

  const orderBy: Prisma.ApplicationOrderByWithRelationInput =
    query.sort === 'cgpa_desc'
      ? { student: { cgpa: 'desc' } }
      : query.sort === 'cgpa_asc'
        ? { student: { cgpa: 'asc' } }
        : { appliedAt: 'desc' };

  const apps = await prisma.application.findMany({
    where: {
      driveId: drive.id,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(Object.keys(studentWhere).length ? { student: studentWhere } : {}),
    },
    include: { student: true },
    orderBy,
  });

  const applicants: ApplicantRow[] = apps.map((a) => ({
    applicationPublicId: a.publicId,
    studentPublicId: a.student.publicId,
    status: a.status,
    appliedAt: a.appliedAt.toISOString(),
    decisionAt: a.decisionAt?.toISOString() ?? null,
    note: a.note,
    firstName: a.student.firstName,
    lastName: a.student.lastName,
    rollNumber: a.student.rollNumber,
    branch: a.student.branch,
    graduationYear: a.student.graduationYear,
    cgpa: decToNum(a.student.cgpa),
    resumeUrl: a.student.resumeUrl,
  }));

  return {
    drive: { publicId: drive.publicId, title: drive.title, status: drive.status },
    applicants,
  };
}
