import { defineConfig } from 'vitest/config';

// Unit tests for the pure cores of the API (starting with the amazon-repricing floor solver
// and decision engine). These are deliberately dependency-free — no NestJS bootstrap, no
// Prisma, no DB — so they run in milliseconds and can be exhaustive/table-driven per spec §6.5.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    // Run the spec files one at a time.
    //
    // With the worker pool on, collection here is not deterministic: three runs over an unchanged
    // tree reported 74, 73 and 68 files. Nothing ever failed — files were silently omitted, which
    // is worse than a failure, because "656 tests pass" then quietly means "of those that happened
    // to be collected", and a broken spec can sit unnoticed in the gap.
    //
    // Single-threaded reported 74 three times from three. These specs are dependency-free and the
    // whole suite finishes in seconds, so the parallelism bought very little and cost the one
    // thing a test suite exists to give.
    fileParallelism: false,
  },
});
