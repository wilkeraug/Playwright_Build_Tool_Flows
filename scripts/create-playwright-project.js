import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative, sep as pathSep } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import targetsConfig from '../config/targets.js';
import { loadPageElements, generateFlows, buildCrossPageFlows } from '../src/flowBuilder/flowGenerator.js';
import { generateRequirementsTree } from '../src/requirements/requirementsGenerator.js';
import { slugify } from '../src/utils/fsUtils.js';
import { logger } from '../src/utils/logger.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
function resolvePlaywrightVersion() {
  try {
    const localPlaywrightVersion = readFileSync(resolve(repoRoot, 'node_modules/playwright/package.json'), 'utf8');
    return `^${JSON.parse(localPlaywrightVersion).version}`;
  } catch {
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
    return packageJson.devDependencies?.playwright ?? '^1.0.0';
  }
}
const playwrightVersion = resolvePlaywrightVersion();

const AUTH_STATE_RELATIVE = '../../.auth/state.json';

function usage() {
  return [
    'Usage:',
    '  npm run create-playwright-project -- --language=js',
    '  npm run create-playwright-project -- --language=python',
    '',
    'Options:',
    '  --language=js|python   Choose the generated project language',
    '  --out-dir=<path>       Output directory for the generated project',
    '  --install              Run install commands after generation',
    '  --no-install           Skip install commands',
    '  --help                 Show this message',
    '',
    'The generated project includes a requirements/ tree derived from extracted summary.md files.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    language: null,
    outDir: null,
    install: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--install') {
      args.install = true;
      continue;
    }
    if (arg === '--no-install') {
      args.install = false;
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
    if (arg.startsWith('--out-dir=')) {
      args.outDir = arg.slice('--out-dir='.length);
      continue;
    }
    if (arg === '--out-dir') {
      args.outDir = argv[i + 1] ?? null;
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

function isInteractive() {
  return Boolean(input.isTTY && output.isTTY);
}

async function prompt(question, defaultValue = '') {
  const rl = createInterface({ input, output });
  try {
    const suffix = defaultValue ? ` (${defaultValue})` : '';
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    return answer || defaultValue;
  } finally {
    rl.close();
  }
}

async function chooseLanguage(language) {
  const normalized = normaliseLanguage(language);
  if (normalized) return normalized;
  if (!isInteractive()) return 'js';

  const answer = await prompt('Choose the generated language [js/python]', 'js');
  const choice = normaliseLanguage(answer);
  if (!choice) {
    throw new Error(`Unsupported language "${answer}"`);
  }
  return choice;
}

async function chooseInstall(installFlag) {
  if (installFlag != null) return installFlag;
  if (!isInteractive()) return false;

  const answer = await prompt('Run install commands now? [y/N]', 'n');
  return /^y(es)?$/i.test(answer);
}

function validateConfig() {
  if (!targetsConfig.projectName?.trim()) {
    throw new Error('config/targets.js must define a non-empty projectName');
  }
  if (!Array.isArray(targetsConfig.pages) || targetsConfig.pages.length === 0) {
    throw new Error('config/targets.js must define at least one page');
  }
  for (const page of targetsConfig.pages) {
    if (!page.name?.trim()) {
      throw new Error('Every page in config/targets.js needs a name');
    }
    if (!page.url?.trim()) {
      throw new Error(`Page "${page.name}" needs a url`);
    }
    try {
      new URL(page.url);
    } catch {
      throw new Error(`Page "${page.name}" has an invalid url: ${page.url}`);
    }
  }
}

function toPosixPath(targetPath) {
  return targetPath.split(pathSep).join('/');
}

function repoRelative(fromPath, toPath) {
  return toPosixPath(relative(fromPath, toPath));
}

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

async function writeText(filePath, content) {
  await ensureDir(dirname(filePath));
  if (existsSync(filePath) && readFileSync(filePath, 'utf8') === content) {
    return false;
  }
  await writeFile(filePath, content, 'utf8');
  return true;
}

function projectSlug() {
  const slug = slugify(targetsConfig.projectName);
  return slug || 'playwright-project';
}

function resolveOutDir(language, rawOutDir) {
  const defaultOutDir = join('playwright-projects', `${projectSlug()}-${language}`);
  const candidate = rawOutDir ?? defaultOutDir;
  return resolve(repoRoot, candidate);
}

function readPageMeta(pageConfig) {
  try {
    const meta = loadPageElements(targetsConfig.projectName, pageConfig.name, 'Documentation');
    const { pageFlows, integrationFlows } = generateFlows(meta);
    return { meta, pageFlows, integrationFlows };
  } catch (error) {
    if (!String(error?.message ?? '').includes('No elements.json found')) {
      throw error;
    }
    logger.warn(`No extracted elements found for "${pageConfig.name}" - generating smoke tests only`);
    return { meta: null, pageFlows: [], integrationFlows: [] };
  }
}

function escapeSingleQuotes(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function pythonSlug(value, fallback = 'page') {
  const raw = slugify(value) || fallback;
  let normalized = raw.replace(/-/g, '_').replace(/[^a-zA-Z0-9_]/g, '_');
  if (!/^[A-Za-z_]/.test(normalized)) {
    normalized = `_${normalized}`;
  }
  return normalized;
}

function pageViewportSnippetJs(viewport) {
  if (!viewport) return '';
  return `test.use({ viewport: { width: ${viewport.width}, height: ${viewport.height} } });\n\n`;
}

function inferRoleFromDescription(step) {
  const text = `${step.description ?? ''} ${step.element ?? ''}`.toLowerCase();
  if (text.includes('link')) return 'link';
  if (text.includes('checkbox')) return 'checkbox';
  if (text.includes('radio')) return 'radio';
  if (text.includes('tab')) return 'tab';
  if (text.includes('menu item')) return 'menuitem';
  return 'button';
}

function jsLocatorExpression(step) {
  if (step.resolvedLocator) return step.resolvedLocator;
  if (step.element) {
    const label = JSON.stringify(step.element);
    if (step.action === 'fill' || step.action === 'select' || step.action === 'check') {
      return `page.getByLabel(${label})`;
    }
    if (step.action === 'click' || step.action === 'hover') {
      const role = inferRoleFromDescription(step);
      return `page.getByRole(${JSON.stringify(role)}, { name: ${label} })`;
    }
    return `page.getByText(${label})`;
  }
  if (step.path) return `page.locator(${JSON.stringify(step.path)})`;
  return `page.locator('body')`;
}

function convertJsLocatorToPython(expression) {
  const trimmed = expression.trim();
  const simpleMatchers = [
    [/^page\.getByTestId\((.+)\)$/s, (match) => `page.get_by_test_id(${match[1]})`],
    [/^page\.getByLabel\((.+)\)$/s, (match) => `page.get_by_label(${match[1]})`],
    [/^page\.getByPlaceholder\((.+)\)$/s, (match) => `page.get_by_placeholder(${match[1]})`],
    [/^page\.getByText\((.+)\)$/s, (match) => `page.get_by_text(${match[1]})`],
    [/^page\.locator\((.+)\)$/s, (match) => `page.locator(${match[1]})`],
    [/^page\.frameLocator\((.+)\)$/s, (match) => `page.frame_locator(${match[1]})`],
  ];

  for (const [pattern, transform] of simpleMatchers) {
    const match = trimmed.match(pattern);
    if (match) return transform(match);
  }

  const roleMatch = trimmed.match(/^page\.getByRole\((['"])(.+?)\1,\s*\{\s*name:\s*(.+?)\s*\}\)$/s);
  if (roleMatch) {
    const role = roleMatch[2];
    const name = roleMatch[3];
    return `page.get_by_role(${JSON.stringify(role)}, name=${name})`;
  }

  return null;
}

function pythonLocatorExpression(step) {
  if (step.resolvedLocator) {
    const converted = convertJsLocatorToPython(step.resolvedLocator);
    if (converted) return converted;
  }
  if (step.element) {
    const label = JSON.stringify(step.element);
    if (step.action === 'fill' || step.action === 'select' || step.action === 'check') {
      return `page.get_by_label(${label})`;
    }
    if (step.action === 'click' || step.action === 'hover') {
      const role = inferRoleFromDescription(step);
      return `page.get_by_role(${JSON.stringify(role)}, name=${label})`;
    }
    return `page.get_by_text(${label})`;
  }
  if (step.path) return `page.locator(${JSON.stringify(step.path)})`;
  return 'page.locator("body")';
}

function jsStepCode(step, pageConfig = {}) {
  if (step.action === 'navigate') {
    return `await page.goto(${JSON.stringify(step.path)}, { waitUntil: ${JSON.stringify(pageConfig.waitUntil ?? 'domcontentloaded')} });`;
  }
  if (step.action === 'click') {
    return `await ${jsLocatorExpression(step)}.click();`;
  }
  if (step.action === 'fill') {
    return `await ${jsLocatorExpression(step)}.fill(${JSON.stringify(step.value ?? 'example value')});`;
  }
  if (step.action === 'select') {
    return `await ${jsLocatorExpression(step)}.selectOption(${JSON.stringify(step.value ?? 'example value')});`;
  }
  if (step.action === 'check') {
    return `await ${jsLocatorExpression(step)}.check();`;
  }
  if (step.action === 'hover') {
    return `await ${jsLocatorExpression(step)}.hover();`;
  }
  if (step.action === 'wait') {
    return step.path
      ? `await page.waitForURL(${JSON.stringify(step.path)});`
      : 'await page.waitForLoadState("networkidle");';
  }
  if (step.action === 'assert') {
    if (step.state === 'url' && step.expectedText) {
      return `await expect(page).toHaveURL(${JSON.stringify(step.expectedText)});`;
    }
    if (step.state === 'hidden' && step.element) {
      return `await expect(${jsLocatorExpression(step)}).toBeHidden();`;
    }
    if (step.state === 'enabled' && step.element) {
      return `await expect(${jsLocatorExpression(step)}).toBeEnabled();`;
    }
    if (step.state === 'disabled' && step.element) {
      return `await expect(${jsLocatorExpression(step)}).toBeDisabled();`;
    }
    if (step.state === 'checked' && step.element) {
      return `await expect(${jsLocatorExpression(step)}).toBeChecked();`;
    }
    if (step.state === 'text' && step.element) {
      return `await expect(${jsLocatorExpression(step)}).toHaveText(${JSON.stringify(step.expectedText ?? '')});`;
    }
    if (step.element) {
      return `await expect(${jsLocatorExpression(step)}).toBeVisible();`;
    }
    return 'await expect(page.locator("body")).toBeVisible();';
  }
  if (step.action === 'assert-not') {
    if (step.element) {
      return `await expect(${jsLocatorExpression(step)}).not.toBeVisible();`;
    }
    return 'await expect(page.locator("body")).toBeVisible();';
  }
  if (step.action === 'note') {
    return step.notes ? `// ${escapeSingleQuotes(step.notes)}` : '// note';
  }
  return `// Unsupported step: ${escapeSingleQuotes(step.description ?? step.action)}`;
}

function pyStepCode(step, pageConfig = {}) {
  if (step.action === 'navigate') {
    return `    page.goto(${JSON.stringify(step.path)}, wait_until=${JSON.stringify(pageConfig.waitUntil ?? 'domcontentloaded')})`;
  }
  if (step.action === 'click') {
    return `    ${pythonLocatorExpression(step)}.click()`;
  }
  if (step.action === 'fill') {
    return `    ${pythonLocatorExpression(step)}.fill(${JSON.stringify(step.value ?? 'example value')})`;
  }
  if (step.action === 'select') {
    return `    ${pythonLocatorExpression(step)}.select_option(${JSON.stringify(step.value ?? 'example value')})`;
  }
  if (step.action === 'check') {
    return `    ${pythonLocatorExpression(step)}.check()`;
  }
  if (step.action === 'hover') {
    return `    ${pythonLocatorExpression(step)}.hover()`;
  }
  if (step.action === 'wait') {
    return step.path
      ? `    page.wait_for_url(${JSON.stringify(step.path)})`
      : '    page.wait_for_load_state("networkidle")';
  }
  if (step.action === 'assert') {
    if (step.state === 'url' && step.expectedText) {
      return `    expect(page).to_have_url(${JSON.stringify(step.expectedText)})`;
    }
    if (step.state === 'hidden' && step.element) {
      return `    expect(${pythonLocatorExpression(step)}).to_be_hidden()`;
    }
    if (step.state === 'enabled' && step.element) {
      return `    expect(${pythonLocatorExpression(step)}).to_be_enabled()`;
    }
    if (step.state === 'disabled' && step.element) {
      return `    expect(${pythonLocatorExpression(step)}).to_be_disabled()`;
    }
    if (step.state === 'checked' && step.element) {
      return `    expect(${pythonLocatorExpression(step)}).to_be_checked()`;
    }
    if (step.state === 'text' && step.element) {
      return `    expect(${pythonLocatorExpression(step)}).to_have_text(${JSON.stringify(step.expectedText ?? '')})`;
    }
    if (step.element) {
      return `    expect(${pythonLocatorExpression(step)}).to_be_visible()`;
    }
    return '    expect(page.locator("body")).to_be_visible()';
  }
  if (step.action === 'assert-not') {
    if (step.element) {
      return `    expect(${pythonLocatorExpression(step)}).not_to_be_visible()`;
    }
    return '    expect(page.locator("body")).to_be_visible()';
  }
  if (step.action === 'note') {
    return step.notes ? `    # ${escapeSingleQuotes(step.notes)}` : '    # note';
  }
  return `    # Unsupported step: ${escapeSingleQuotes(step.description ?? step.action)}`;
}

function jsFlowTest(flow, pageConfig) {
  const body = flow.steps.map((step) => `    ${jsStepCode(step, pageConfig)}`).join('\n');
  return [
    `test(${JSON.stringify(flow.name)}, async ({ page }) => {`,
    pageConfig.viewport
      ? `  await page.setViewportSize({ width: ${pageConfig.viewport.width}, height: ${pageConfig.viewport.height} });`
      : null,
    body,
    '});',
  ].filter(Boolean).join('\n');
}

function pyFlowTest(flow, pageConfig, functionName) {
  const lines = [];
  lines.push(`def ${functionName}(page):`);
  if (pageConfig.viewport) {
    lines.push(`    page.set_viewport_size({"width": ${pageConfig.viewport.width}, "height": ${pageConfig.viewport.height}})`);
  }
  for (const step of flow.steps) {
    lines.push(pyStepCode(step, pageConfig));
  }
  return lines.join('\n');
}

function jsPageFile(pageConfig, flows) {
  const fileLines = [
    "import { test, expect } from '@playwright/test';",
    '',
    pageConfig.viewport ? pageViewportSnippetJs(pageConfig.viewport) : '',
    `test.describe(${JSON.stringify(pageConfig.name)}, () => {`,
    `  test(${JSON.stringify(`smoke: ${pageConfig.name}`)}, async ({ page }) => {`,
    pageConfig.viewport ? `    await page.setViewportSize({ width: ${pageConfig.viewport.width}, height: ${pageConfig.viewport.height} });` : null,
    `    await page.goto(${JSON.stringify(pageConfig.url)}, { waitUntil: ${JSON.stringify(pageConfig.waitUntil ?? 'domcontentloaded')} });`,
    pageConfig.waitForSelector ? `    await page.locator(${JSON.stringify(pageConfig.waitForSelector)}).first().waitFor({ state: 'visible' });` : null,
    "    await expect(page.locator('body')).toBeVisible();",
    '  });',
    '',
    ...flows.flatMap((flow) => ['', jsFlowTest(flow, pageConfig)]),
    '});',
  ].filter((line, index, all) => line !== '' || index < all.length - 1);
  return fileLines.join('\n');
}

function pyPageFile(pageConfig, flows) {
  const lines = [
    'from playwright.sync_api import expect',
    '',
    `def test_smoke_${pythonSlug(pageConfig.name)}(page):`,
  ];
  if (pageConfig.viewport) {
    lines.push(`    page.set_viewport_size({"width": ${pageConfig.viewport.width}, "height": ${pageConfig.viewport.height}})`);
  }
  lines.push(`    page.goto(${JSON.stringify(pageConfig.url)}, wait_until=${JSON.stringify(pageConfig.waitUntil ?? 'domcontentloaded')})`);
  if (pageConfig.waitForSelector) {
    lines.push(`    page.locator(${JSON.stringify(pageConfig.waitForSelector)}).first.wait_for(state="visible")`);
  }
  lines.push(`    expect(page.locator("body")).to_be_visible()`);

  for (const [index, flow] of flows.entries()) {
    lines.push('');
    lines.push(pyFlowTest(flow, pageConfig, `test_${pythonSlug(pageConfig.name)}_${pythonSlug(flow.name, flow.id)}_${index + 1}`));
  }

  return lines.join('\n');
}

function crossPageFile(language, crossFlows, pageConfigByName) {
  if (language === 'js') {
    const lines = [
      "import { test, expect } from '@playwright/test';",
      '',
    ];
    for (const flow of crossFlows) {
      const pageConfig = pageConfigByName.get(flow.pages?.[0] ?? '') ?? {};
      lines.push(`test(${JSON.stringify(flow.name)}, async ({ page }) => {`);
      for (const step of flow.steps) {
        lines.push(`  ${jsStepCode(step, pageConfig)}`);
      }
      lines.push('});');
      lines.push('');
    }
    return lines.join('\n').trimEnd() + '\n';
  }

  const lines = ['from playwright.sync_api import expect', ''];
  for (const [index, flow] of crossFlows.entries()) {
    const pageConfig = pageConfigByName.get(flow.pages?.[0] ?? '') ?? {};
    lines.push(pyFlowTest(flow, pageConfig, `test_cross_page_${index + 1}`));
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

function jsConfigFile(hasAuth) {
  return [
    "import { defineConfig, devices } from '@playwright/test';",
    "import { existsSync } from 'node:fs';",
    "import { fileURLToPath } from 'node:url';",
    "import { dirname, resolve } from 'node:path';",
    '',
    'const __dirname = dirname(fileURLToPath(import.meta.url));',
    `const authStatePath = resolve(__dirname, ${JSON.stringify(AUTH_STATE_RELATIVE)});`,
    `const hasAuthState = ${hasAuth ? 'existsSync(authStatePath)' : 'false'};`,
    '',
    'export default defineConfig({',
    "  testDir: './tests',",
    `  timeout: ${targetsConfig.timeout ?? 30000},`,
    "  fullyParallel: false,",
    "  retries: 0,",
    "  reporter: [['list'], ['html']],",
    '  use: {',
    "    trace: 'on-first-retry',",
    ...(hasAuth ? ["    storageState: hasAuthState ? authStatePath : undefined,"] : []),
    '  },',
    '  projects: [',
    `    { name: ${JSON.stringify(targetsConfig.browser ?? 'chromium')}, use: { ...devices['Desktop Chrome'] } },`,
    `    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },`,
    `    { name: 'webkit', use: { ...devices['Desktop Safari'] } },`,
    '  ],',
    '});',
    '',
  ].join('\n');
}

function jsPackageJson(name) {
  return {
    name,
    private: true,
    type: 'module',
    scripts: {
      test: 'playwright test',
      'test:headed': 'playwright test --headed',
      'show-report': 'playwright show-report',
    },
    devDependencies: {
      '@playwright/test': playwrightVersion,
    },
  };
}

function pyRequirements() {
  return ['pytest', 'pytest-playwright'].join('\n') + '\n';
}

function pyIni() {
  return [
    '[pytest]',
    'testpaths = tests',
    'addopts = -q',
    '',
  ].join('\n');
}

function pyConftest(hasAuth) {
  return [
    'from pathlib import Path',
    '',
    'import pytest',
    '',
    'ROOT = Path(__file__).resolve().parents[3]',
    'AUTH_STATE = ROOT / ".auth" / "state.json"',
    '',
    '@pytest.fixture(scope="session")',
    'def browser_context_args(browser_context_args):',
    '    args = dict(browser_context_args)',
    `    if ${hasAuth ? 'AUTH_STATE.exists()' : 'False'}:`,
    '        args["storage_state"] = str(AUTH_STATE)',
    '    return args',
    '',
  ].join('\n');
}

function pyRequirementsCommands() {
  return [
    'python3 -m venv .venv',
    '.venv/bin/python -m pip install -r requirements.txt',
    '.venv/bin/python -m playwright install',
    '.venv/bin/python -m pytest',
  ];
}

function jsCommands() {
  return ['npm install', 'npx playwright install', 'npx playwright test', 'npx playwright show-report'];
}

function readmeContent(language, outDir, hasAuth) {
  const commands = language === 'js' ? jsCommands() : pyRequirementsCommands();
  const commandBlock = commands.map((cmd) => `- \`${cmd}\``).join('\n');
  return [
    `# ${targetsConfig.projectName} Playwright ${language === 'js' ? 'JavaScript' : 'Python'} Project`,
    '',
    `Generated from \`config/targets.js\` into \`${repoRelative(repoRoot, outDir)}\`.`,
    '',
    '## Install',
    '',
    commandBlock,
    '',
    '## Notes',
    '',
    '- The generated tests use extracted locators when available and fall back to smoke coverage when they are not.',
    '- The generated `requirements/` tree is built from the latest `summary.md` files and mirrors the configured pages.',
    '- `requirements/00_Onboarding_QA/` contains project-level guidance, while `requirements/01_Requirements/` holds one markdown file per page.',
    hasAuth ? '- Authenticated pages reuse `.auth/state.json` automatically when that file exists at the repo root.' : '- If your pages require sign-in, add a saved auth state at `.auth/state.json` before running the tests.',
    '',
  ].join('\n');
}

function gitignoreContent(language) {
  const common = [
    'node_modules/',
    'playwright-report/',
    'test-results/',
    '.DS_Store',
    '*.log',
  ];
  const python = ['.venv/', '__pycache__/', '.pytest_cache/'];
  return [...common, ...(language === 'python' ? python : [])].join('\n') + '\n';
}

async function writeProject(language, outDir, pages, pageArtifacts, crossFlows) {
  const projectHasAuth = pages.some((page) => page.requiresAuth);
  const projectFolder = outDir;

  await ensureDir(projectFolder);
  await ensureDir(join(projectFolder, 'tests'));

  const pageConfigByName = new Map(pages.map((page) => [page.name, page]));

  if (language === 'js') {
    await writeText(join(projectFolder, 'package.json'), JSON.stringify(jsPackageJson(`${projectSlug()}-${language}`), null, 2) + '\n');
    await writeText(join(projectFolder, 'playwright.config.js'), jsConfigFile(projectHasAuth));
  } else {
    await writeText(join(projectFolder, 'requirements.txt'), pyRequirements());
    await writeText(join(projectFolder, 'pytest.ini'), pyIni());
    await writeText(join(projectFolder, 'tests', 'conftest.py'), pyConftest(projectHasAuth));
  }

  for (const page of pages) {
    const artifact = pageArtifacts.get(page.name);
    const flows = [
      ...(artifact?.pageFlows ?? []),
      ...(artifact?.integrationFlows ?? []),
    ];
    const fileName = language === 'js' ? `${slugify(page.name) || 'page'}.spec.js` : `test_${pythonSlug(page.name)}.py`;
    const content = language === 'js'
      ? jsPageFile(page, flows)
      : pyPageFile(page, flows);
    await writeText(join(projectFolder, 'tests', fileName), content);
  }

  if (crossFlows.length > 0) {
    const crossFile = language === 'js' ? 'cross-page.spec.js' : 'test_cross_page.py';
    await writeText(join(projectFolder, 'tests', crossFile), crossPageFile(language, crossFlows, pageConfigByName));
  }

  await writeText(join(projectFolder, 'README.md'), readmeContent(language, projectFolder, projectHasAuth));
  await writeText(join(projectFolder, '.gitignore'), gitignoreContent(language));

  return { projectFolder, projectHasAuth };
}

async function maybeInstall(language, projectFolder, shouldInstall) {
  if (!shouldInstall) return;

  if (language === 'js') {
    execSync('npm install', { cwd: projectFolder, stdio: 'inherit' });
    execSync('npx playwright install', { cwd: projectFolder, stdio: 'inherit' });
    return;
  }

  execSync('python3 -m venv .venv', { cwd: projectFolder, stdio: 'inherit' });
  execSync('.venv/bin/python -m pip install -r requirements.txt', { cwd: projectFolder, stdio: 'inherit', shell: true });
  execSync('.venv/bin/python -m playwright install', { cwd: projectFolder, stdio: 'inherit', shell: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  validateConfig();
  const language = await chooseLanguage(args.language);
  const shouldInstall = await chooseInstall(args.install);
  const outDir = resolveOutDir(language, args.outDir);

  const pageArtifacts = new Map();
  for (const page of targetsConfig.pages) {
    pageArtifacts.set(page.name, readPageMeta(page));
  }

  const loadedMetas = [...pageArtifacts.entries()]
    .filter(([, artifact]) => artifact.meta)
    .map(([, artifact]) => artifact.meta);

  const crossFlows = loadedMetas.length >= 2 ? buildCrossPageFlows(loadedMetas) : [];

  logger.info(`Generating ${language === 'js' ? 'JavaScript' : 'Python'} Playwright project for ${targetsConfig.projectName}`);
  logger.info(`Output directory: ${outDir}`);

  const { projectFolder, projectHasAuth } = await writeProject(language, outDir, targetsConfig.pages, pageArtifacts, crossFlows);
  const requirementsResult = await generateRequirementsTree({
    repoRoot,
    projectDir: projectFolder,
    outputDir: 'Documentation',
    projectName: targetsConfig.projectName,
    pages: targetsConfig.pages,
    projectSlug: projectSlug(),
  });

  console.log('\n' + '='.repeat(72));
  console.log(`Project generated: ${projectFolder}`);
  console.log(`Language        : ${language}`);
  console.log(`Auth detected   : ${projectHasAuth ? 'yes' : 'no'}`);
  console.log(`Pages           : ${targetsConfig.pages.length}`);
  console.log(`Cross-page flows: ${crossFlows.length}`);
  console.log(`Requirements    : ${requirementsResult.requirementsDir}`);
  console.log('='.repeat(72));

  if (shouldInstall) {
    await maybeInstall(language, projectFolder, true);
  } else {
    const commands = language === 'js' ? jsCommands() : pyRequirementsCommands();
    console.log('\nInstall commands:');
    for (const command of commands) {
      console.log(`  ${command}`);
    }
  }
}

main().catch((error) => {
  logger.error('Failed to generate Playwright project', error);
  process.exit(1);
});
