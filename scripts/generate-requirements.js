import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { logger } from '../src/utils/logger.js';
import { generateRequirementsTree } from '../src/requirements/requirementsGenerator.js';
import targetsConfig from '../config/targets.js';
import { slugify } from '../src/utils/fsUtils.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

function usage() {
  return [
    'Usage:',
    '  npm run generate-requirements -- --project-dir=<path>',
    '',
    'Options:',
    '  --project-dir=<path>   Generated Playwright project folder to populate',
    '  --output-dir=<path>    Extracted output folder to read summary.md files from (default: Documentation)',
    '  --help                 Show this message',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    projectDir: null,
    outputDir: 'Documentation',
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg.startsWith('--project-dir=')) {
      args.projectDir = arg.slice('--project-dir='.length);
      continue;
    }
    if (arg === '--project-dir') {
      args.projectDir = argv[i + 1] ?? null;
      i++;
      continue;
    }
    if (arg.startsWith('--output-dir=')) {
      args.outputDir = arg.slice('--output-dir='.length);
      continue;
    }
    if (arg === '--output-dir') {
      args.outputDir = argv[i + 1] ?? 'Documentation';
      i++;
      continue;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  if (!args.projectDir) {
    throw new Error('Missing --project-dir. Use the path to a generated Playwright project.');
  }

  const result = await generateRequirementsTree({
    repoRoot,
    projectDir: resolve(repoRoot, args.projectDir),
    outputDir: args.outputDir,
    projectName: targetsConfig.projectName,
    pages: targetsConfig.pages,
    projectSlug: slugify(targetsConfig.projectName) || 'playwright-project',
  });

  logger.info(`Generated QA documentation folders at ${result.requirementsDir}`);
}

main().catch((error) => {
  logger.error('Failed to generate QA documentation folders', error);
  process.exit(1);
});
