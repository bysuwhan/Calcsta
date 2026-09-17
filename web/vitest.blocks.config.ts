import { defineConfig } from 'vitest/config';
import base from './vite.config';

// Model/interaction tests do not initialize or substitute the numerical solver.
// Numerical regression tests remain in the standard WASM-backed unit project.
export default defineConfig({
  ...base,
  test: {
    name: 'blocks', pool: 'threads',
    include: ['src/lib/store/__tests__/blocks.test.ts'],
  },
});
