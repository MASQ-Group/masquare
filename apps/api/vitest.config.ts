import { defineConfig } from 'vitest/config';

// Unit tests for the pure cores of the API (starting with the amazon-repricing floor solver
// and decision engine). These are deliberately dependency-free — no NestJS bootstrap, no
// Prisma, no DB — so they run in milliseconds and can be exhaustive/table-driven per spec §6.5.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
