import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/**
 * Single shared PrismaClient instance.
 *
 * A module-level singleton (cached on `globalThis` in non-production) prevents
 * connection-pool exhaustion during dev/HMR where modules re-evaluate. Every
 * service imports THIS `prisma`, never `new PrismaClient()`.
 */
const globalForPrisma = globalThis as unknown as {
  __codeNexusPrisma?: PrismaClient;
};

export const prisma: PrismaClient = globalForPrisma.__codeNexusPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__codeNexusPrisma = prisma;
}
