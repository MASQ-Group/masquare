-- Sign-in for the maSquare connector, so Claude on claude.ai can use it.
--
-- claude.ai connectors sign in with OAuth rather than a fixed token. An app registers itself (a
-- client), a person signs in and receives a one-time code, and the code is exchanged for tokens.
-- Access tokens are signed and short-lived, so they are never stored; only what has to be
-- single-use (codes) or revocable (refresh tokens) is, and both only as SHA-256 hashes.
--
-- New tables only: nothing that exists changes, and the fixed-token connector keeps working.

-- CreateTable
CREATE TABLE "mcp_oauth_client" (
    "id" UUID NOT NULL,
    "client_id" TEXT NOT NULL,
    "info" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_oauth_client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_oauth_code" (
    "id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "resource" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_oauth_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_oauth_refresh_token" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "resource" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_oauth_refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mcp_oauth_client_client_id_key" ON "mcp_oauth_client"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_oauth_code_code_hash_key" ON "mcp_oauth_code"("code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_oauth_refresh_token_token_hash_key" ON "mcp_oauth_refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "mcp_oauth_refresh_token_user_id_idx" ON "mcp_oauth_refresh_token"("user_id");

