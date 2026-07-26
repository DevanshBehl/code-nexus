


# Code Nexus — Architecture & Execution Report

> A technical assessment of the Code Nexus placement-management platform, with technology recommendations and a 10-phase build plan.

---

## 1. Verdict — How good is this idea?

**Short version: it's a strong, coherent idea with real product-market fit, but the scope is that of 5–6 separate startups stitched together. The risk is not the concept — it's finishing it.**

### What's genuinely good

- **Clear multi-tenant model.** You have five well-defined roles (Student, University, Company, Recruiter, Code Nexus Admin) with asymmetric permissions. That's a solid backbone and forces good access-control discipline early.
- **The workflow is a real funnel** — drive → apply → shortlist (filters) → DSA round → ranked list → interview → feedback → select/reject → mail. This mirrors how real campus placements work (think Superset / eLitmus / HackerRank for Work), so it solves an actual pain.
- **You already understand the hard parts.** Isolating Judge0 code execution in workers behind a queue, choosing SFU for 1:1 interviews, and HLS for one-to-many webinars are the *correct* instincts. Most people get these backwards.
- **Good separation of concerns** — Code Arena, Webinars, Interviewing, Recording, Mailing, Dashboard are natural service boundaries.

### Where the risk actually is

| Risk | Why it matters |
|------|----------------|
| **Scope** | Any *one* of Code Arena, the interview room, or webinar streaming is a multi-month project. All six is a multi-person, multi-quarter effort. |
| **Real-time surface area** | Whiteboard sync, code sync, window-mirroring, chat, WebRTC signaling, and recording event logging all need reliable low-latency transport. This is the most bug-prone area. |
| **Recording** | Server-side recording of a WebRTC SFU session to MP4 with event timestamps is one of the hardest things in the whole spec. Budget accordingly. |
| **"Distributed microservices from day one"** | This is the trap. True microservices upfront will bury you in infra (service discovery, inter-service auth, distributed tracing, deploy pipelines) before you ship a single feature. See §4. |

### Honest recommendation

Build it as a **modular monolith inside a Turborepo** (a "distributed-ready monolith"), and peel off only the services that *must* scale independently — the **Judge0 execution workers**, the **webinar/HLS media plane**, and the **WebRTC SFU** — as true separate processes. Everything else (auth, dashboards, mailing, drives) stays as well-bounded modules that *can* become services later. You get clean, loosely-coupled, segregated code (your stated goal) without paying the full distributed-systems tax on day one.

---

## 2. Database — Postgres + Prisma vs MongoDB

**Recommendation: PostgreSQL + Prisma as the primary datastore.** Use a secondary store only where it earns its place (below).

### Why Postgres wins *here*

Your domain is **relational to the core**:

- A Student *belongs to* a University. A Recruiter *belongs to* a Company. A Drive *links* a Company and a University. An Application *joins* a Student and a Drive. A Submission *references* a Student, a Question, and a Contest/Interview. Feedback *joins* Recruiter → Student → Interview.
- Almost every dashboard query is a **filter + join + aggregate**: "students in this drive with CGPA > 8 and branch = CSE, ranked by test-cases passed." That's SQL's home turf, and it's painful in Mongo.
- Your permission rules ("student can only mail their own university") are **referential integrity constraints** — foreign keys and relational checks enforce them for free.
- Placement data is **transactional**: an offer/reject must reliably trigger a mail and update state. You want ACID here.

**Prisma** specifically because:
- Type-safe client end-to-end with your TS stack — the schema *is* your source of truth.
- Painless migrations, which matter when 6 services touch overlapping models.
- Great DX for the join-heavy queries your dashboards need.

### Where a second store helps (polyglot persistence)

| Data | Store | Reason |
|------|-------|--------|
| Core domain (users, drives, applications, submissions, feedback, mail) | **Postgres + Prisma** | Relational, transactional |
| Real-time whiteboard/code CRDT state, presence, live session cache | **Redis** | Ephemeral, low-latency, pub/sub for WSS fan-out + queue backpressure |
| Judge0 job queue | **RabbitMQ** (already in your stack) | Durable work queue for run/submit |
| Recordings (MP4) & mail image attachments | **Object storage** (S3/MinIO) | Never put blobs in a DB; store a URL/key in Postgres |
| Contribution graph / heatmap | **Postgres** (a daily-aggregated `submission_activity` table) | It's just a `GROUP BY date` — no special store needed |

**Skip MongoDB.** The only argument for it would be "flexible schemas," but your schema is well-known and highly relational. Mongo would make your dashboard queries harder and your integrity rules manual. If you later find a genuinely document-shaped, schema-loose sub-domain, add it then — don't start there.

---

## 3. API style — REST vs GraphQL vs gRPC

**Recommendation: a hybrid, chosen per boundary.**

| Boundary | Choice | Why |
|----------|--------|-----|
| **Client ↔ Backend (browser-facing)** | **REST** (with OpenAPI), or tRPC if you want end-to-end TS types with zero schema duplication | Simple, cacheable, universally understood. Your dashboards are mostly CRUD + filtered lists. REST + good query params handles this cleanly. |
| **Real-time (interview room, whiteboard, code sync, chat, live submit results, window mirroring)** | **WebSockets (WSS)** — already in your stack | None of REST/GraphQL/gRPC fit push/bidirectional streaming from a browser. This is event-driven and must be WSS. |
| **Service ↔ Service (internal: API → execution worker, → media services)** | **gRPC** *(or just RabbitMQ messages)* | Strongly-typed, fast, ideal for internal calls. But for the queue-based Judge0 path, the "API" is literally *publishing a message to RabbitMQ* — no RPC needed. Use gRPC only for synchronous internal request/response. |

### Why not GraphQL as the main API?

GraphQL shines when you have many client types with wildly different data needs and deep nested graphs. Here:
- You have one primary client (the React app) per role.
- Your dashboards are *filtered lists and aggregates*, which REST query params or SQL views handle fine.
- GraphQL adds N+1 risk, caching complexity, and a resolver layer you'd be maintaining for limited payoff at this stage.

If, later, dashboards become deeply nested and over/under-fetching hurts, you can add GraphQL as a **read-side gateway** without rearchitecting. Don't pay for it now.

### Concrete rule of thumb

> **REST for the browser. WSS for anything live. RabbitMQ for jobs. gRPC only for synchronous service-to-service calls.**

---

## 4. Turborepo structure

A single Turborepo, split into `apps/` (deployable units) and `packages/` (shared code). This is what makes the codebase *loosely coupled and segregated* while staying easy to build/test together.

```
code-nexus/
├── apps/
│   ├── web/                     # React + TS + Tailwind v4 + Framer Motion + GSAP
│   │                            #   (all role dashboards, Code Arena UI, interview room UI)
│   ├── api/                     # Express — modular monolith (the "core server")
│   │   └── src/modules/         #   auth, users, drives, applications,
│   │                            #   mailing, contests, dashboard — bounded modules
│   ├── ws-gateway/              # WSS server — interview/whiteboard/code/chat sync, presence
│   ├── execution-worker/        # Consumes RabbitMQ, runs Judge0, returns results
│   │                            #   (isolated — malicious code can't take down core)
│   ├── media-sfu/               # WebRTC SFU (mediasoup or Pion) for 1:1 interviews
│   ├── webinar-streamer/        # HLS ingest/packaging for one-to-many webinars
│   └── recording-service/       # Records SFU session → MP4 + event-timestamp track
│
├── packages/
│   ├── db/                      # Prisma schema + client (single source of truth)
│   ├── types/                   # Shared TS types / zod schemas / DTOs
│   ├── auth/                    # RBAC logic + JWT/session helpers (the 5-role matrix)
│   ├── config/                  # env parsing, constants, feature flags
│   ├── mq/                      # RabbitMQ publisher/consumer wrappers
│   ├── ui/                      # Shared React components + Tailwind preset + design tokens
│   ├── logger/                  # Structured logging (for the admin/help-center dashboard)
│   └── eslint-config / tsconfig # Shared tooling config
│
├── turbo.json                   # Pipeline: build, dev, lint, test, db:migrate
├── docker-compose.yml           # Postgres, Redis, RabbitMQ, MinIO, Judge0 for local dev
└── package.json                 # pnpm workspaces
```

**Key principles**
- Anything shared crosses through `packages/`, never via app-to-app imports. That's what keeps it segregated.
- `packages/db` and `packages/types` are the contracts every service agrees on.
- Use **pnpm workspaces** + Turbo remote caching so the big repo still builds fast.
- Each `apps/*` is independently deployable — so "modular monolith today, microservices tomorrow" is a config change, not a rewrite.

---

## 5. The 10-Phase Build Plan

Ordered so that **every phase ships something usable** and later phases build on stable foundations. Roughly ordered easy→hard, with the two hardest services (interview room, recording) last.

### Phase 1 — Foundation & Scaffolding
- Turborepo + pnpm + Turbo pipeline, shared `tsconfig`/`eslint`/`ui`/`config` packages.
- `docker-compose` with Postgres, Redis, RabbitMQ, MinIO.
- Prisma schema v1: core entities (`User`, `University`, `Company`, `Student`, `Recruiter`, roles) with the **UUID-per-entity** identity you specified.
- CI: lint + typecheck + build on every push.
- **Deliverable:** repo builds, DB migrates, containers run.

### Phase 2 — Auth, Identity & RBAC
- The **5-role permission matrix** in `packages/auth`. This is the spine of everything.
- University-creates-Student and Company-creates-Recruiter provisioning (no self-registration), with generated UUID + password.
- First-login → forced profile completion → dashboard gate.
- Password reset, sessions/JWT.
- **Deliverable:** every role can log in and hit an empty, permission-gated dashboard.

### Phase 3 — Dashboard Service (shells + calendar)
- All five dashboards as real (if sparse) pages: Student, University, Company, Recruiter, Admin.
- Calendar component (events feed — wired to real events in later phases).
- Branch-wise sorted student lists (University), company/drive listings, settings/edit-profile.
- **Deliverable:** each role sees their real home screen; navigation shell done.

### Phase 4 — Placement Drives & Applications
- Company creates a drive with a University; students see & apply.
- Company sees applicants with academic details; **filters** (branch, CGPA, etc.).
- Shortlisting state machine (this is the iterative funnel's data model).
- Placed / rejected tracking for University dashboard.
- **Deliverable:** the end-to-end apply→shortlist funnel works (minus tests/interviews).

### Phase 5 — Mailing Service
- Internal mail: inbox + sent box, subject/body, UUID-addressed.
- Enforce the directional rules (student → own university + Code Nexus only; university → own students/companies/CN; company & CN → anyone).
- Event hooks so select/reject **auto-triggers** a mail. (Image attachments deferred, as you said.)
- **Deliverable:** roles communicate; funnel decisions notify students automatically.

### Phase 6 — Code Arena (practice platform)
- Question bank segregated by topic (arrays, strings, trees, graphs, heaps, hashmaps…), with testcases + sample I/O.
- LeetCode-style UI: problem left, editor top-right, console bottom-right, **Run** (first testcase) + **Submit**.
- **RabbitMQ + `execution-worker` + Judge0** — the isolated execution pipeline. *This is the phase that proves your worker architecture.*
- Persist every attempt; **GitHub-style contribution heatmap** from a daily-aggregated table.
- **Deliverable:** students practice DSA end-to-end with safe, isolated execution.

### Phase 7 — Contests
- University/Company create contests: pick existing questions or add custom ones + testcases; set language, date, duration.
- Contest run mode (timed) reusing the Phase 6 execution pipeline.
- Post-contest **leaderboard** (ranked by testcases passed).
- **Deliverable:** scheduled competitive rounds — plugs directly into the drive funnel (the "DSA round").

### Phase 8 — Webinars (one-to-many)
- **HLS** streaming of host video + shared screen (chosen for scale over WebRTC).
- Live chat, polls, end-meeting.
- Participant list + **attendance** tracking (host sees who attended).
- **Deliverable:** universities/companies run pre-placement talks at scale.

### Phase 9 — Interview Room (the hard one)
- **WebRTC SFU** (mediasoup/Pion), lobby + device (cam/mic) check, admit flow, room IDs.
- Live chat, screen share (both sides), **real-time whiteboard** (dark-grey canvas, CRDT-synced).
- **Real-time synced code IDE**: recruiter pushes questions from their pool → student solves in-room; run/submit reuses the Phase 6 Judge0 pipeline; results shown to both live.
- **Window-mirroring over WSS**: whichever tab one side opens (video / IDE / whiteboard / screen-share) mirrors on the other — event-driven.
- Exit gated by **feedback** (rating /5 + note), then data saved.
- **Deliverable:** a full inhouse "Google Meet + collaborative judge" for interviews.

### Phase 10 — Recording Service & Hardening
- Record SFU session from recruiter-join → **MP4 stored in object storage**.
- **Event log with relative timestamps** (student join, window switches, screen-share, whiteboard, submits).
- **YouTube-style player** with a timeline chaptered by those timestamps.
- Recording visibility rules (student=own, recruiter=own, company=all-its-own, university=all-its-students).
- Then: load testing, observability/tracing, security review, admin help-center tooling, docs.
- **Deliverable:** reviewable interviews + a production-hardened platform.

### Suggested phase groupings (if you want milestones)
- **MVP (usable product):** Phases 1–6 → provision users, run drives, mail, practice DSA.
- **Assessment complete:** + Phases 7–8 → contests + webinars → the full pre-interview funnel.
- **Full vision:** + Phases 9–10 → live interviews + recordings.

---

## 6. Cross-cutting recommendations

- **Testing early.** With 6 services and real-time sync, integration tests around the auth matrix and the Judge0 pipeline pay for themselves fast.
- **Observability from Phase 1.** Your Admin dashboard *is* a monitoring surface — structured logging + a tracing story (OpenTelemetry) should be baked in, not bolted on.
- **One `packages/types` contract.** Every WSS event, every job payload, every DTO defined once with zod. This is what actually keeps a real-time distributed system from drifting into chaos.
- **Feature-flag the hard services.** Ship Phases 1–7 to real users while Phases 8–10 are still being built.
- **Security posture for execution.** Judge0 workers must run sandboxed (container limits, no network, CPU/mem/time caps). Treat every run/submit as hostile input — you already have the right instinct isolating it.

---

## 7. TL;DR

- **The idea is strong and real** — the danger is scope, not concept. Build a modular monolith, split out only the media/execution planes.
- **Database:** Postgres + Prisma (relational domain, join-heavy dashboards, ACID funnel), + Redis / RabbitMQ / object storage where each earns its place. Skip Mongo.
- **APIs:** REST (or tRPC) for the browser, **WSS** for everything live, **RabbitMQ** for jobs, gRPC only for sync service-to-service. Not GraphQL — yet.
- **Structure:** one Turborepo, `apps/` for deployables, `packages/` for shared contracts.
- **Plan:** 10 phases, each shippable, hardest (interview room, recording) last.
