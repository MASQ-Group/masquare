# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

maSquare — a multi-company back-office operations platform. This repo implements the
**first slice: Module 1 (Foundation)**. Modules 2 (Global Settings) and 3 (Products) are
specified but **not yet built** — stop-for-review after Foundation, per the build brief.

The canonical specs live in `docs/`:
- `maSquare_Build_Brief.md` — stack, local-first directive, acceptance criteria
- `DESIGN.md` / `maSquare_Design_System.md` — design tokens (the source of truth)
- `maSquare_UI_Framework.html` — the rendered visual reference for the shell
- `maSquare_Module1_Foundation_Spec.md` — the data model + shared-component contracts
- `maSquare_Module2/3_*_Spec.md` — next modules (context only)

## Stack & layout

npm workspaces monorepo. `apps/api` (NestJS + Prisma), `apps/web` (React + Vite + Tailwind),
`packages/ui` (shared components), `packages/config` (design tokens + Tailwind preset).

## Commands

```bash
docker compose up -d      # postgres + minio
npm install
npm run db:migrate        # prisma migrate dev (apps/api)
npm run db:seed           # seed data
npm run dev               # api :3000 + web :5173
```

## Conventions (from the brief & specs)

- **UUID** primary keys; audit columns `created_at/updated_at/created_by/updated_by`;
  soft-delete via `deleted_at`. No hard deletes of referenced records.
- **Money** = `amount` (numeric) + `currency_code` (default `EUR`).
- **Design**: Teal 500 primary; Inter for prose, **JetBrains Mono (tabular)** for every
  identifier/figure (SKUs, VAT, money, dates). Orange is accent only, never error.
- **Multi-tenancy**: company-scoped rows filtered by `company_id`; shared modules
  (Products) co-own records across companies via link tables.
- **Permissions**: a user may use module *M* for company *C* when *M* ∈ module grants
  AND *C* ∈ company grants. Admins implicitly hold all grants.
- **Shared components** (`packages/ui`): smart reference input, bulk-import framework,
  modal shell — built once, reused everywhere.
