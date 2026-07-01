# maSquare Platform — Build Brief & Local-Dev Handoff (for Claude Code)

Hand this to Claude Code along with the specification set. Save it at the repository root; you can rename it `CLAUDE.md` so Claude Code reads it automatically as standing project context.

**Attach with it:**
`maSquare_Module1_Foundation_Spec.md` · `maSquare_Module2_GlobalSettings_Spec.md` · `maSquare_Module3_Products_Spec.md` · `DESIGN.md` · `maSquare_UI_Framework.html`

---

## Prime directive: local-first

The platform **must run end-to-end on a developer's machine** with one or two commands, **no cloud account required**. The eventual cloud host is undecided, so every cloud-specific dependency is hidden behind an adapter — local and production use the same code paths, only configuration differs. If a feature can't be exercised locally, it isn't done.

---

## Stack

- **Database:** PostgreSQL (Dockerised locally; Cloud SQL/RDS-class managed service in prod).
- **Backend:** NestJS (TypeScript). REST API, DTO validation with Zod/class-validator. Migrations + seed via Prisma (or TypeORM).
- **Frontend:** React + TypeScript + Vite, Tailwind CSS, shadcn/ui (Radix), TanStack Table + Query, cmdk (global search), react-hook-form + Zod, dnd-kit, Lucide.
- **Object storage (product media):** S3-compatible. **MinIO** in Docker locally; GCS/S3 in prod — same SDK, swapped endpoint.
- **Monorepo:** pnpm workspaces (`apps/api`, `apps/web`, `packages/ui`, `packages/config`). Shared UI components (smart reference input, bulk-import framework, modal shell) live in `packages/ui`.
- **Background jobs:** not required for Modules 1–3; leave a queue seam (BullMQ/Redis) for the future integrations module, but do not stand it up yet.

---

## Local dev topology

```
docker compose  ─┬─  postgres   :5432   (persistent volume)
                 └─  minio       :9000   (S3 API) / :9001 (console)

pnpm dev        ─┬─  apps/api    :3000   NestJS  (serves /api)
                 └─  apps/web    :5173   Vite    (proxies /api -> :3000)
```

Minimal `docker-compose.yml` to target:

```yaml
services:
  postgres:
    image: postgres:16
    environment: { POSTGRES_USER: masquare, POSTGRES_PASSWORD: masquare, POSTGRES_DB: masquare }
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment: { MINIO_ROOT_USER: masquare, MINIO_ROOT_PASSWORD: masquare123 }
    ports: ["9000:9000", "9001:9001"]
    volumes: ["miniodata:/data"]
volumes: { pgdata: {}, miniodata: {} }
```

Commit a `.env.example` (DB URL, MinIO keys/bucket/endpoint, JWT secret, app URLs). The app must boot from `.env.example` copied to `.env` with zero edits.

---

## Run-it-locally acceptance (the definition of done for the first slice)

Prerequisites: Docker Desktop, Node 20+, pnpm. Then:

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open `http://localhost:5173`, sign in as the seeded admin, and you should see the two seeded companies and a small sample catalogue — create/edit a product, manage Global Settings, and switch companies, all working against local Postgres + MinIO.

**Seed data** must include:
- Companies: **A.M.A. MASQUARE LTD** (VAT `CY10156304C`) and **N.K. MULTITRADE CORPORATION LTD** (VAT `CY10402024X`, `IT00441109998`), both sharing the Products module.
- An **admin user** (credentials printed by the seed script).
- A few vendors, brands, product types, fulfilment types (FBA, FBM), a small category tree, and a couple of attributes (one predefined, one free-text).
- ~10 sample products with a main SKU, an alias or two, media, attributes, and a purchase cost.

---

## Build order (one coherent slice, in dependency order)

1. **Foundation** — monorepo, Docker, DB schema + migrations, auth (seeded admin), multi-tenancy/co-ownership, and the three shared components in `packages/ui`. Wire the DESIGN.md tokens into `tailwind.config` + CSS variables first, so every screen is on-brand from the start.
2. **Global Settings** — Vendors, Brands/Manufacturers, Product Types, Fulfilment Types, Categories (tree), Attributes, and the General format settings (metric, dd/mm/yyyy).
3. **Products** — master record, List/Grid views, field-aware search, and the tabbed Add/Edit modal.

---

## Conventions (apply throughout)

- **Design tokens** from `DESIGN.md`; `maSquare_UI_Framework.html` is the visual reference for the shell, tables, and components.
- **Formats:** metric units (cm/kg), dates **dd/mm/yyyy**, both read from Global Settings. Identifiers and figures in **JetBrains Mono, tabular**; money right-aligned, default currency **EUR** stored as `amount + currency_code`.
- **Data:** UUID primary keys; `created_at/updated_at/created_by/updated_by` audit columns; soft-delete (`deleted_at`); no hard deletes of referenced records.
- **SKUs:** main SKU + free-form aliases share **one platform-wide unique namespace**; aliases resolve to the one product.
- **Ownership:** reference data is platform-global; products are co-owned via a `product_company` link.
- **Quality floor:** keyboard focus visible, `prefers-reduced-motion` respected, WCAG AA contrast, responsive to mobile.

---

## Suggested first prompt for Claude Code

> Read CLAUDE.md and the attached specs (Modules 1–3, DESIGN.md, the UI framework HTML). Scaffold a pnpm monorepo (apps/api NestJS, apps/web React+Vite+Tailwind+shadcn, packages/ui, packages/config) with a docker-compose for Postgres and MinIO. Set up Prisma with the Module 1 schema, an auth flow with a seeded admin, and the DESIGN.md tokens wired into Tailwind. Then implement the three shared UI components (smart reference input, bulk-import framework, modal shell) and the Companies + Users admin (Module 1). Make `cp .env.example .env && docker compose up -d && pnpm install && pnpm db:migrate && pnpm db:seed && pnpm dev` bring the app up at localhost:5173 with the two seeded companies. Stop there for review before Global Settings.

---

## Open item to decide during the build

**MSRP naming** (Module 3 §1.4): MAP = minimum suggested retail price, MSRP = maximum suggested retail price, per your definition. Standard industry usage of "MSRP" differs (a single manufacturer-suggested price), which may matter when the marketplace-integration module reads/writes it. Keep the `MSRP` label, or rename the ceiling field (e.g. `max_suggested_price`).
