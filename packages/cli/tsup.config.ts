import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['esm'],
  dts: { entry: ['src/index.ts'] },
  clean: true,
  target: 'node20',
  external: ['playwright-core'],
});
