#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runAudit } from './audit';
import { formatJson, formatTable } from './format';

const HELP = `react-webmcp <command>

Commands:
  audit <url>   Load a page, list the WebMCP tools generated for it, and report problems
  init          (not implemented yet)
  manifest      (not implemented yet)

audit options:
  --format <table|json>   Output format (default: table)
  --strict                Exit with code 1 if there are any warnings
  --actions <safe|all>    Also discover click actions (default: off)
  --wait <ms>             Extra time for the app to render after load (default: 1500)
  --executable <path>     Chromium executable (default: $CHROMIUM_PATH, else Playwright's)
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    console.log(HELP);
    return command ? 0 : 2;
  }
  if (command === 'init' || command === 'manifest') {
    console.error(`react-webmcp ${command}: not implemented yet.`);
    return 2;
  }
  if (command !== 'audit') {
    console.error(`Unknown command "${command}".\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      format: { type: 'string', default: 'table' },
      strict: { type: 'boolean', default: false },
      actions: { type: 'string' },
      wait: { type: 'string' },
      executable: { type: 'string' },
    },
  });
  const url = positionals[0];
  if (!url) {
    console.error('audit needs a URL, e.g. react-webmcp audit http://localhost:5173');
    return 2;
  }
  if (values.format !== 'table' && values.format !== 'json') {
    console.error('--format must be "table" or "json".');
    return 2;
  }
  if (values.actions && values.actions !== 'safe' && values.actions !== 'all') {
    console.error('--actions must be "safe" or "all".');
    return 2;
  }
  try {
    const result = await runAudit({
      url,
      actions: (values.actions as 'safe' | 'all' | undefined) ?? false,
      waitMs: values.wait ? Number(values.wait) : undefined,
      executablePath: values.executable,
    });
    console.log(values.format === 'json' ? formatJson(result) : formatTable(result));
    return values.strict && result.warnings.length > 0 ? 1 : 0;
  } catch (e) {
    console.error(`audit failed: ${(e as Error).message}`);
    return 2;
  }
}

main(process.argv.slice(2)).then((code) => process.exit(code));
