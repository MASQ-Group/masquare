# maSquare Platform

Multi-company back-office operations platform — catalogue, inventory, marketplace
integrations, tax, and analytics in one place. This repo currently implements the
**first slice: Foundation (Module 1)** — companies, users & permissions, multi-tenancy
& sharing, the shared component layer, and the design system — on a local-first stack.

## Stack

| Layer      | Tech |
| ---------- | ---- |
| Database   | PostgreSQL 16 (Docker) |
| Object storage | MinIO (S3-compatible, Docker) |
| Backend    | NestJS + Prisma (TypeScript) — REST under `/api` on `:3000` |
| Frontend   | React + TypeScript + Vite + Tailwind + shadcn-style UI on `:5173` |
| Monorepo   | npm workspaces — `apps/api`, `apps/web`, `packages/ui`, `packages/config` |

> The build brief specifies pnpm; this environment couldn't elevate Corepack, so npm
> workspaces are used instead. The layout and scripts are otherwise identical.

## Local quick start

Prerequisites: Docker Desktop, Node 20+.

```bash
cp .env.example .env
docker compose up -d          # postgres + minio + bucket
npm install
npm run db:migrate            # apply Prisma migrations
npm run db:seed               # seed companies, admin, sample catalogue
npm run dev                   # api :3000 + web :5173
```

Open <http://localhost:5173> and sign in with the admin credentials printed by the
seed script (defaults: `admin@masquare.local` / `masquare-admin`). You should see the
two seeded companies and be able to switch between them.

API docs (Swagger) at <http://localhost:3000/api/docs>.

## Repo layout

```
apps/
  api/    NestJS + Prisma — auth, companies, users, modules, storage seam
  web/    React SPA — app shell, login, companies & users admin, company switcher
packages/
  ui/     shared components: smart reference input, bulk-import, modal shell
  config/ design tokens + Tailwind preset (single source of truth from DESIGN.md)
docs/     the build brief, design system, and module specs
```

See `docs/` for the full specifications.
