import { Prisma, prisma } from '@code-nexus/db';
import {
  canCompanyTransition,
  canStudentWithdraw,
  evaluateEligibility,
  isTerminalApplicationStatus,
  type ApplicationDecisionInput,
  type ApplicationsQuery,
  type MyApplicationRow,
  type UniversityApplicationRow,
} from '@code-nexus/types';
import type { Express } from 'express';
import { AppError } from '../../errors.js';
import { decToNum, loadStudentFacts } from '../drives/drives.service.js';
import { applicationDecisionMailTx } from '../mail/mail.service.js';

type Auth = Express.AuthContext;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Student applies to a drive. Re-checks eligibility server-side; apply-once. */
export async function applyToDrive(
  auth: Auth,
  drivePublicId: string,
): Promise<{ publicId: string; status: string }> {
  const { id: studentId, facts } = await loadStudentFacts(auth.userId);

  const drive = await prisma.drive.findFirst({
    where: { publicId: drivePublicId, deletedAt: null },
  });
  // Not found, or not targeting this student's university → 404 (no existence leak).
  if (!drive || drive.universityId !== facts.universityId) {
    throw AppError.notFound('Drive not found');
  }

  const eligibility = evaluateEligibility(facts, {
    universityId: drive.universityId,
    status: drive.status,
    applyDeadline: drive.applyDeadline,
    minCgpa: decToNum(drive.minCgpa),
    allowedBranches: drive.allowedBranches,
    allowedGraduationYears: drive.allowedGraduationYears,
  });
  if (!eligibility.eligible) {
    throw new AppError(403, 'NOT_ELIGIBLE', eligibility.reasons.join('; '));
  }

  try {
    const app = await prisma.application.create({
      data: { driveId: drive.id, studentId, status: 'APPLIED' },
    });
    return { publicId: app.publicId, status: app.status };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, 'CONFLICT', 'You have already applied to this drive');
    }
    throw err;
  }
}

/** Student withdraws their own application. Withdrawn is terminal & idempotent-safe. */
export async function withdrawApplication(
  auth: Auth,
  applicationPublicId: string,
): Promise<{ publicId: string; status: string }> {
  const app = await prisma.application.findFirst({
    where: { publicId: applicationPublicId, deletedAt: null },
    include: { student: true },
  });
  if (!app || app.student.userId !== auth.userId) {
    throw AppError.notFound('Application not found');
  }
  if (app.status === 'WITHDRAWN') {
    return { publicId: app.publicId, status: app.status }; // idempotent no-op
  }
  if (!canStudentWithdraw(app.status)) {
    throw new AppError(409, 'CONFLICT', `Cannot withdraw an application that is ${app.status}`);
  }
  const updated = await prisma.application.update({
    where: { id: app.id },
    data: { status: 'WITHDRAWN', decisionAt: new Date() },
  });
  return { publicId: updated.publicId, status: updated.status };
}

/** Company advances an application through the funnel (shortlist / offer / reject). */
export async function decideApplication(
  auth: Auth,
  applicationPublicId: string,
  input: ApplicationDecisionInput,
): Promise<{ publicId: string; status: string }> {
  const app = await prisma.application.findFirst({
    where: { publicId: applicationPublicId, deletedAt: null },
    include: { drive: true },
  });
  // Not found, or not on a drive this company owns → 404.
  if (!app || (auth.role !== 'ADMIN' && app.drive.companyId !== auth.companyId)) {
    throw AppError.notFound('Application not found');
  }
  if (!canCompanyTransition(app.status, input.status)) {
    throw new AppError(
      409,
      'CONFLICT',
      `Cannot move an application from ${app.status} to ${input.status}`,
    );
  }
  const terminal = isTerminalApplicationStatus(input.status);
  const decision = input.status; // 'SHORTLISTED' | 'OFFERED' | 'REJECTED'

  // Update the application and (on offer/reject) write the student notification
  // mail atomically — a decision never succeeds while silently dropping the mail.
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.application.update({
      where: { id: app.id },
      data: {
        status: decision,
        note: input.note ?? app.note,
        decisionAt: terminal ? new Date() : app.decisionAt,
      },
    });
    if (decision === 'OFFERED' || decision === 'REJECTED') {
      const drive = await tx.drive.findUniqueOrThrow({
        where: { id: app.driveId },
        include: { company: true },
      });
      const student = await tx.student.findUniqueOrThrow({ where: { id: app.studentId } });
      await applicationDecisionMailTx(tx, {
        senderUserId: drive.company.userId, // sent FROM the company (Company → anyone)
        recipientUserId: student.userId,
        driveTitle: drive.title,
        companyName: drive.company.name,
        status: decision,
      });
    }
    return u;
  });

  return { publicId: updated.publicId, status: updated.status };
}

// ---- Queries ----------------------------------------------------------------

/** A student's own applications (with the drive + company they target). */
export async function listOwnApplications(
  auth: Auth,
  query: ApplicationsQuery,
): Promise<MyApplicationRow[]> {
  const { id: studentId } = await loadStudentFacts(auth.userId);
  const apps = await prisma.application.findMany({
    where: { studentId, deletedAt: null, ...(query.status ? { status: query.status } : {}) },
    include: { drive: { include: { company: true } } },
    orderBy: { appliedAt: 'desc' },
  });
  return apps.map((a) => ({
    publicId: a.publicId,
    status: a.status,
    appliedAt: a.appliedAt.toISOString(),
    decisionAt: a.decisionAt?.toISOString() ?? null,
    drive: {
      publicId: a.drive.publicId,
      title: a.drive.title,
      roleTitle: a.drive.roleTitle,
      status: a.drive.status,
      company: { publicId: a.drive.company.publicId, name: a.drive.company.name },
    },
  }));
}

/** A university's view of its own students' applications (placement tracking). */
export async function listUniversityApplications(
  auth: Auth,
  query: ApplicationsQuery,
): Promise<UniversityApplicationRow[]> {
  const universityId = auth.universityId;
  if (!universityId) throw new AppError(403, 'FORBIDDEN', 'No university in scope');
  const apps = await prisma.application.findMany({
    where: {
      deletedAt: null,
      student: { universityId },
      ...(query.status ? { status: query.status } : {}),
    },
    include: { student: true, drive: { include: { company: true } } },
    orderBy: { appliedAt: 'desc' },
  });
  return apps.map((a) => ({
    publicId: a.publicId,
    status: a.status,
    appliedAt: a.appliedAt.toISOString(),
    decisionAt: a.decisionAt?.toISOString() ?? null,
    student: {
      publicId: a.student.publicId,
      firstName: a.student.firstName,
      lastName: a.student.lastName,
      rollNumber: a.student.rollNumber,
      branch: a.student.branch,
    },
    drive: {
      publicId: a.drive.publicId,
      title: a.drive.title,
      company: { publicId: a.drive.company.publicId, name: a.drive.company.name },
    },
  }));
}
