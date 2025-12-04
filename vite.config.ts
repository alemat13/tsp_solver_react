import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true
  },
  base: '/tsp_solver_react/',
  test: {
    // Test configuration for vitest
    globals: true,
    environment: 'jsdom',
  },
});
