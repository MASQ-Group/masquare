// Railway Infrastructure as Code for the maSquare project. Replaces the root railway.json
// (Config as Code), setting for setting. Unlike railway.json this file is NOT read by git-push
// deploys: it only reaches Railway through `railway config plan` / `railway config apply`,
// which write these values onto the service itself.
import { defineRailway, project, service } from "railway/iac";

// This file owns only the API. Railway IaC treats anything a file owns but omits as a delete;
// the partial keeps that scope to @masquare/api, so the Postgres service — never described by
// railway.json either — is left exactly as it is.
export const partial = "api";

export default defineRailway(() => {
  const api = service("@masquare/api", {
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },
    // No `start` and no `preDeploy`, on purpose. The Dockerfile CMD applies pending Prisma
    // migrations and then boots the API; a start command here would replace that CMD and
    // the migrations would silently stop running.
    healthcheck: "/api/health",
    healthcheckTimeout: 60,
    replicas: 1,
    deploy: {
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 3,
    },
  });

  return project("maSquare", { resources: [api] });
});
