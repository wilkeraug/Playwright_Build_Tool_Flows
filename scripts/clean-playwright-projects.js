import { existsSync } from 'node:fs';
import { rm, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { logger } from '../src/utils/logger.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const projectsRoot = resolve(repoRoot, 'playwright-projects');

function usage() {
  return [
    'Usage:',
    '  npm run clean-playwright-projects -- --all',
    '  npm run clean-playwright-projects -- --project=<name>',
    '  npm run clean-playwright-projects -- --language=js',
    '  npm run clean-playwright-projects -- --language=python',
    '',
    'Options:',
    '  --all              Delete every generated Playwright project',
    '  --project=<name>   Delete one generated project folder by exact name',
    '  --language=<lang>  Delete generated projects for a language suffix',
    '  --help             Show this message',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    all: false,
    project: null,
    language: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--all') {
      args.all = true;
      continue;
    }
    if (arg.startsWith('--project=')) {
      args.project = arg.slice('--project='.length);
      continue;
    }
    if (arg === '--project') {
      args.project = argv[i + 1] ?? null;
      i++;
      continue;
    }
    if (arg.startsWith('--language=')) {
      args.language = arg.slice('--language='.length);
      continue;
    }
    if (arg === '--language') {
      args.language = argv[i + 1] ?? null;
      i++;
      continue;
    }
  }

  return args;
}

function normaliseLanguage(language) {
  const value = (language ?? '').toLowerCase().trim();
  if (value === 'js' || value === 'javascript') return 'js';
  if (value === 'python' || value === 'py') return 'python';
  return null;
}

async function deleteIfExists(path) {
  if (!existsSync(path)) {
    return false;
  }
  await rm(path, { recursive: true, force: true });
  return true;
}

async function cleanAll() {
  if (!existsSync(projectsRoot)) {
    logger.info(`No generated projects found at ${projectsRoot}`);
    return;
  }
  await rm(projectsRoot, { recursive: true, force: true });
  logger.success(`Deleted all generated Playwright projects under ${projectsRoot}`);
}

async function cleanLanguage(language) {
  if (!existsSync(projectsRoot)) {
    logger.info(`No generated projects found at ${projectsRoot}`);
    return;
  }

  const entries = await readdir(projectsRoot, { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(`-${language}`))
    .map((entry) => join(projectsRoot, entry.name));

  if (matches.length === 0) {
    logger.info(`No generated projects found for language "${language}"`);
    return;
  }

  for (const match of matches) {
    await rm(match, { recursive: true, force: true });
    logger.success(`Deleted ${match}`);
  }
}

async function cleanProject(projectName) {
  const exactPath = resolve(projectsRoot, projectName);
  if (await deleteIfExists(exactPath)) {
    logger.success(`Deleted ${exactPath}`);
    return;
  }

  logger.warn(`No generated project found at ${exactPath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  if (!args.all && !args.project && !args.language) {
    throw new Error('Choose one of --all, --project=<name>, or --language=<lang>');
  }

  if (args.all) {
    await cleanAll();
    return;
  }

  const language = normaliseLanguage(args.language);
  if (args.language && !language) {
    throw new Error(`Unsupported language "${args.language}"`);
  }

  if (language) {
    await cleanLanguage(language);
    return;
  }

  if (args.project) {
    await cleanProject(args.project);
    return;
  }
}

main().catch((error) => {
  logger.error('Failed to clean generated Playwright projects', error);
  process.exit(1);
});
