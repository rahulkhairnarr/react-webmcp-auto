import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/auto.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2020',
  external: ['react', '@mcp-b/webmcp-polyfill', '@react-webmcp-auto/core'],
});
