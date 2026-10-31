import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true
  },
  base: '/tsp_solver_react/',
  worker: {
    // The solver worker lazy-loads HiGHS (code splitting), which needs ES module output.
    format: 'es',
  },
  test: {
    // Test configuration for vitest
    globals: true,
    environment: 'jsdom',
  },
});
