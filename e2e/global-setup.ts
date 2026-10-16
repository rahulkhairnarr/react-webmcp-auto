import { execSync } from 'node:child_process';

/** The audit specs run the built CLI, so make sure packages are built. */
export default function globalSetup(): void {
  execSync("pnpm --filter './packages/*' build", { stdio: 'inherit' });
}
