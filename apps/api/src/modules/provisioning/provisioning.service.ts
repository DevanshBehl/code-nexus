import { Prisma, prisma } from '@code-nexus/db';
import type { Role } from '@code-nexus/types';
import { generateTempPassword, hashPassword, type SessionStore } from '@code-nexus/auth';
import type { AppConfig } from '@code-nexus/config';
import { AppError } from '../../errors.js';

/** Result of provisioning: the one-time temp password is returned ONCE. */
export interface ProvisionResult {
  publicId: string;
  email: string;
  tempPassword: string;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Create a User + its role/org row in one transaction with a generated temp
 * password (mustResetPassword=true). Returns the temp password once.
 */
async function provision(
  config: AppConfig,
  email: string,
  role: Role,
  status: 'ACTIVE' | 'PENDING_PROFILE',
  linkRow: (userId: string, tx: Prisma.TransactionClient) => Promise<void>,
): Promise<ProvisionResult> {
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword, config.BCRYPT_COST);

  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email, passwordHash, role, status, mustResetPassword: true },
      });
      await linkRow(created.id, tx);
      return created;
    });
    return { publicId: user.publicId, email: user.email, tempPassword };
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, 'EMAIL_TAKEN', 'Email already in use');
    throw err;
  }
}

export function createUniversity(
  config: AppConfig,
  input: { email: string; name: string; code: string },
) {
  return provision(config, input.email, 'UNIVERSITY', 'ACTIVE', async (userId, tx) => {
    await tx.university.create({ data: { name: input.name, code: input.code, userId } });
  });
}

export function createCompany(config: AppConfig, input: { email: string; name: string }) {
  return provision(config, input.email, 'COMPANY', 'ACTIVE', async (userId, tx) => {
    await tx.company.create({ data: { name: input.name, userId } });
  });
}

export function createPlatformAdmin(
  config: AppConfig,
  input: { email: string; firstName?: string; lastName?: string },
) {
  return provision(config, input.email, 'ADMIN', 'ACTIVE', async (userId, tx) => {
    await tx.platformAdmin.create({
      data: { userId, firstName: input.firstName, lastName: input.lastName },
    });
  });
}

/** University → Student. universityId comes from the SESSION, never the body. */
export function createStudent(
  config: AppConfig,
  universityId: string,
  input: { email: string; firstName?: string; lastName?: string },
) {
  return provision(config, input.email, 'STUDENT', 'PENDING_PROFILE', async (userId, tx) => {
    await tx.student.create({
      data: { userId, universityId, firstName: input.firstName, lastName: input.lastName },
    });
  });
}

/** Company → Recruiter. companyId comes from the SESSION, never the body. */
export function createRecruiter(
  config: AppConfig,
  companyId: string,
  input: { email: string; firstName?: string; lastName?: string },
) {
  return provision(config, input.email, 'RECRUITER', 'PENDING_PROFILE', async (userId, tx) => {
    await tx.recruiter.create({
      data: { userId, companyId, firstName: input.firstName, lastName: input.lastName },
    });
  });
}

export async function listStudents(universityId: string) {
  const students = await prisma.student.findMany({
    where: { universityId, deletedAt: null },
    include: { user: true },
    orderBy: { createdAt: 'asc' },
  });
  return students.map((s) => ({
    publicId: s.user.publicId,
    email: s.user.email,
    status: s.user.status,
    firstName: s.firstName,
    lastName: s.lastName,
  }));
}

export async function listRecruiters(companyId: string) {
  const recruiters = await prisma.recruiter.findMany({
    where: { companyId, deletedAt: null },
    include: { user: true },
    orderBy: { createdAt: 'asc' },
  });
  return recruiters.map((r) => ({
    publicId: r.user.publicId,
    email: r.user.email,
    status: r.user.status,
    firstName: r.firstName,
    lastName: r.lastName,
  }));
}

/** Regenerate a temp password for a managed account; forces reset + logout-all. */
export async function resetAccountPassword(
  config: AppConfig,
  store: SessionStore,
  targetUserId: string,
): Promise<{ tempPassword: string }> {
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword, config.BCRYPT_COST);
  await prisma.user.update({
    where: { id: targetUserId },
    data: { passwordHash, mustResetPassword: true },
  });
  await store.deleteAllForUser(targetUserId);
  return { tempPassword };
}

export async function setAccountSuspended(
  store: SessionStore,
  targetUserId: string,
  suspended: boolean,
): Promise<void> {
  await prisma.user.update({
    where: { id: targetUserId },
    data: { status: suspended ? 'SUSPENDED' : 'ACTIVE' },
  });
  if (suspended) await store.deleteAllForUser(targetUserId);
}
