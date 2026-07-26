import { loadConfig } from '@code-nexus/config';

// Load the monorepo-root .env into process.env so Prisma sees DATABASE_URL for
// the integration suite. If .env is absent/invalid (e.g. CI with no DB), the
// integration tests detect an unreachable DB and skip — unit tests still run.
try {
  loadConfig();
} catch {
  /* ignore — integration tests self-skip when the DB is unreachable */
}
