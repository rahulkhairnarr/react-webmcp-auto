import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: false,
    sourcemap: true,
    target: 'es2020',
  },
  {
    // Self-contained browser bundle: used by the CLI (`audit`) and the browser extension.
    entry: ['src/index.ts'],
    format: ['iife'],
    globalName: 'WebMCPAutoCore',
    minify: true,
    target: 'es2020',
    clean: false,
  },
]);
