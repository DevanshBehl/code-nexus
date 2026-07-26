# Contributing to Code Nexus

Conventions that keep this monorepo loosely coupled, segregated, and easy to
grow phase by phase. Read this before adding code.

## Naming

- **Files:** `kebab-case` — `request-id.ts`, `error-handler.ts`.
- **React components:** `PascalCase` file and export — `Hero.tsx`.
- **Types / interfaces / enums:** `PascalCase`.
- **Variables / functions:** `camelCase`.
- **Constants:** `UPPER_SNAKE_CASE`.
- **Packages:** scoped `@code-nexus/<name>`; apps live in `apps/`, shared code in `packages/`.

## Module pattern (`apps/api/src/modules/`)

One **bounded module** per business domain (kebab-case folder). A module owns:

```
modules/<domain>/
  <domain>.router.ts    # Express Router (thin HTTP surface)
  <domain>.service.ts   # business logic — no Express types
  <domain>.schema.ts    # zod request/response schemas
  <domain>.test.ts      # unit tests
```

Rules:

- A module never imports another module's internals — share via `packages/*`.
- Routers stay thin; logic lives in services.
- Validate every request body with zod before it reaches a service.

## Database (Prisma) — base-model rules

Every model **must** include these fields (see `packages/db/prisma/schema.prisma`):

| Field       | Definition                                    | Purpose                         |
| ----------- | --------------------------------------------- | ------------------------------- |
| `id`        | `String @id @default(uuid())`                 | Internal primary key            |
| `publicId`  | `String @unique @default(uuid())`             | Platform-wide public reference  |
| `createdAt` | `DateTime @default(now()) @db.Timestamptz(6)` | Creation time (UTC)             |
| `updatedAt` | `DateTime @updatedAt @db.Timestamptz(6)`      | Last update (UTC)               |
| `deletedAt` | `DateTime? @db.Timestamptz(6)`                | Soft delete — never hard-delete |

Additional rules:

- **All timestamps are UTC** (`@db.Timestamptz`). Never store local time.
- **`User.publicId`** is the canonical id used in place of email to reference a
  person/login across services. Entity tables carry their own `publicId` for
  org-level references.
- **Identity model is table-per-role**, not polymorphic: `User` holds auth; each
  role/org has its own table linked 1:1 by a unique `userId`.
- The Prisma `Role` / `UserStatus` enums **must mirror** the unions exported from
  `@code-nexus/types`.
- Don't invent fields ahead of need — leave a `// TODO(phaseN):` marker.

## Environment

- Only `@code-nexus/config` reads `process.env`; it validates with zod and fails
  fast. Add new variables to the schema **and** to `.env.example`.
- Never commit a real `.env` or secrets.

## Commits

Follow **[Conventional Commits](https://www.conventionalcommits.org/)**:

```
feat(api): add health readiness endpoint
fix(web): correct hero spacing on mobile
chore(db): add recruiter index
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `build`, `ci`.

## Before you push

```bash
pnpm format
pnpm lint && pnpm typecheck && pnpm build && pnpm test
```

A pre-commit hook (husky + lint-staged) formats and lints staged files
automatically.
