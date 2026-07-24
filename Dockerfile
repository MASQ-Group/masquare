# maSquare — single-image build for Railway (or any container host).
# The API serves both /api and the built SPA (apps/web/dist) on one origin.

# ---------- build stage ----------
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Prisma engine needs openssl; ca-certificates for outbound HTTPS during build.
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Chromium is installed in the runtime stage instead — skip Puppeteer's download here.
ENV PUPPETEER_SKIP_DOWNLOAD=1

# Install deps first (better layer caching): copy only manifests.
COPY package*.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/ui/package.json packages/ui/
RUN npm ci

# Build everything: Prisma client, shared packages, API, then the web SPA.
COPY . .
RUN npm run db:generate -w @masquare/api \
 && npm run build -w @masquare/config -w @masquare/ui -w @masquare/api -w @masquare/web

# ---------- runtime stage ----------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Chromium + the shared libraries Puppeteer needs to render PO PDFs, plus openssl for Prisma.
RUN apt-get update && apt-get install -y \
      chromium ca-certificates openssl fonts-liberation \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
 && rm -rf /var/lib/apt/lists/*

# Ship the built app + its dependencies (Prisma client lives inside node_modules).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages ./packages

# Apply pending migrations, then boot. The app reads PORT (injected by Railway).
CMD ["sh","-c","npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma && node apps/api/dist/src/main.js"]
