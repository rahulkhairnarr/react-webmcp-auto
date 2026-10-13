import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Alias workspace packages to source so the demo needs no prior build.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  resolve: {
    alias: {
      'react-webmcp-auto/auto': src('../../packages/react/src/auto.ts'),
      'react-webmcp-auto': src('../../packages/react/src/index.ts'),
      '@react-webmcp-auto/core': src('../../packages/core/src/index.ts'),
    },
  },
});
