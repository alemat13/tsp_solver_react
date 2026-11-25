import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

/** Commit the app is built from, shown in the diagnostic log. */
const commit = (() => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
})();

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true
  },
  base: '/tsp_solver_react/',
  define: {
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  worker: {
    // The solver worker lazy-loads HiGHS (code splitting), which needs ES module output.
    format: 'es',
  },
  test: {
    // Test configuration for vitest
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
