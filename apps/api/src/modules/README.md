# API Modules

This directory holds **bounded modules** — one folder per business domain. Each
module owns its own routes, services, and validation, and exposes a single
Express `Router` (plus any service functions) to be mounted in `src/app.ts`.

**Phase 1 is intentionally empty** — no business logic exists yet.

## Convention (see `CONTRIBUTING.md`)

```
modules/
  <domain>/               # kebab-case, e.g. `auth`, `mailing`, `drives`
    <domain>.router.ts    # Express Router — HTTP surface
    <domain>.service.ts   # business logic (no Express types)
    <domain>.schema.ts    # zod request/response schemas
    <domain>.test.ts      # unit tests
```

Rules:

- A module never imports another module's internals — share via `packages/*`.
- Routers are thin; logic lives in services.
- All request bodies are validated with zod before reaching a service.

## Roadmap

- **Phase 2:** `auth` (login, sessions, RBAC), `users` (provisioning).
- **Phase 3:** `profile`, `dashboard`.
- **Phase 4:** `drives`, `applications`.
- **Phase 5:** `mailing`.
- **Phase 6+:** `code-arena`, `contests`, `webinars`, `interviews`, `recordings`.
