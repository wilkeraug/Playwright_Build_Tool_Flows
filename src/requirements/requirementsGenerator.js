import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import targetsConfig from '../../config/targets.js';
import { slugify, writeText } from '../utils/fsUtils.js';

function normalizeText(value, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function parseTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const cells = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
  return cells;
}

function isSeparatorRow(line) {
  const cells = parseTableRow(line);
  return Boolean(cells && cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell)));
}

function isHeadingLine(line) {
  return /^##\s+/.test(line.trim());
}

function parseSummaryMarkdown(markdown, pageName) {
  const lines = markdown.split(/\r?\n/);
  const titleLine = lines.find((line) => line.startsWith('# ')) ?? `# ${pageName}`;
  const title = titleLine.replace(/^#\s+/, '').trim() || pageName;
  const summaryIndex = lines.findIndex((line) => line.trim() === '## Summary');

  const metadata = {};
  const metadataLines = summaryIndex >= 0 ? lines.slice(1, summaryIndex) : lines.slice(1);
  for (const line of metadataLines) {
    const match = line.match(/^\| \*\*(.+?)\*\* \| (.+) \|$/);
    if (match) {
      metadata[match[1].toLowerCase()] = match[2].trim();
    }
  }

  const counts = [];
  if (summaryIndex >= 0) {
    let i = summaryIndex + 1;
    let tableRowsSeen = 0;
    for (; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') {
        if (tableRowsSeen > 0) break;
        continue;
      }
      const row = parseTableRow(line);
      if (!row) break;
      tableRowsSeen += 1;
      if (tableRowsSeen <= 2) continue;
      if (row.length >= 2) {
        counts.push({ category: row[0], count: row[1] });
      }
    }
  }

  const sections = [];
  let current = null;
  let tableRowsSeen = 0;
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(/^## (.+?) \((\d+)\)$/);
    if (heading) {
      if (current) sections.push(current);
      current = {
        title: heading[1],
        count: Number(heading[2]),
        rows: [],
      };
      tableRowsSeen = 0;
      continue;
    }

    if (!current) continue;
    if (isHeadingLine(lines[i])) {
      sections.push(current);
      current = null;
      continue;
    }

    const row = parseTableRow(lines[i]);
    if (!row || isSeparatorRow(lines[i])) continue;

    tableRowsSeen += 1;
    if (tableRowsSeen <= 2) continue;
    current.rows.push(row);
  }
  if (current) sections.push(current);

  return {
    pageName,
    title,
    url: metadata.url ?? '',
    extracted: metadata.extracted ?? '',
    totalElements: metadata['total elements'] ?? '0',
    pageTitle: metadata['page title'] ?? title,
    counts,
    sections,
  };
}

function buildCountsTable(counts) {
  const lines = [
    '| Category | Count |',
    '|---|---:|',
  ];
  for (const item of counts) {
    lines.push(`| ${item.category} | ${item.count} |`);
  }
  return lines.join('\n');
}

function pickSection(sections, title) {
  const lower = title.toLowerCase();
  return sections.find((section) => section.title.toLowerCase() === lower)
    ?? sections.find((section) => section.title.toLowerCase().includes(lower))
    ?? null;
}

function summarizeRows(section, limit, mapper) {
  if (!section || section.rows.length === 0) return [];
  return section.rows.slice(0, limit).map((row) => mapper(row));
}

function titleCase(value) {
  return String(value ?? '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function cleanFeatureName(value, fallback = 'Feature') {
  const cleaned = String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned === '—') return fallback;
  return cleaned.length > 60 ? `${cleaned.slice(0, 57).trim()}...` : cleaned;
}

function markdownList(items, fallback) {
  const filtered = items.filter(Boolean);
  return filtered.length > 0 ? filtered.map((item) => `- ${item}`).join('\n') : `- ${fallback}`;
}

function safeRoute(value, fallback = '<app-route>') {
  if (!value) return fallback;
  try {
    const parsed = new URL(value);
    return parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '/';
  } catch {
    const text = String(value).trim();
    if (!text || /^https?:\/\//i.test(text)) return fallback;
    return text.startsWith('/') ? text : fallback;
  }
}

function documentationSafetySection() {
  return [
    '## Documentation safety',
    '',
    'This document intentionally avoids environment-specific identifiers such as real deployment URLs, tenant URLs, database names, organization names, OAuth client IDs, API keys, personal names, email addresses, and record IDs. Use placeholders such as `<app-url>`, `<tenant>`, `<company>`, `<user>`, `<record>`, and `<feature>` when an example needs context.',
  ].join('\n');
}

function elementLabel(el, fallback = 'feature') {
  return cleanFeatureName(
    el.text ?? el.ariaLabel ?? el.dataTestId ?? el.placeholder ?? el.name ?? el.id ?? el.href ?? el.role ?? el.tag,
    fallback,
  );
}

function readPageElements(repoRoot, outputDir, projectSlug, pageConfig) {
  const filePath = resolve(repoRoot, outputDir, projectSlug, slugify(pageConfig.name), 'elements.json');
  if (!existsSync(filePath)) return [];
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  return raw.elements ?? [];
}

function pushFeature(features, feature) {
  const key = slugify(`${feature.pageName}-${feature.name}-${feature.type}`) || `feature-${features.length + 1}`;
  if (features.some((item) => item.key === key)) return;
  if (!feature.evidence?.length && !feature.controls?.length) return;
  features.push({ key, ...feature });
}

function inferPageFeatures(pageConfig, elements) {
  const pageName = pageConfig.name;
  const baseFeature = { pageName, pageUrl: pageConfig.url };
  const visible = elements.filter((el) => el.isVisible !== false);
  const enabled = visible.filter((el) => el.isEnabled !== false);
  const inputs = enabled.filter((el) => el.category === 'input');
  const buttons = enabled.filter((el) => el.category === 'button' || el.role === 'button');
  const links = enabled.filter((el) => el.category === 'link');
  const tables = visible.filter((el) => el.category === 'table');
  const media = visible.filter((el) => el.category === 'media');
  const dialogs = visible.filter((el) => el.category === 'dialog');
  const features = [];

  const searchInputs = inputs.filter((el) => /search|find|filter/i.test(`${el.text ?? ''} ${el.ariaLabel ?? ''} ${el.placeholder ?? ''} ${el.name ?? ''} ${el.dataTestId ?? ''}`));
  if (searchInputs.length > 0) {
    pushFeature(features, {
      ...baseFeature,
      type: 'search',
      name: `${titleCase(pageName)} Search And Filtering`,
      evidence: searchInputs.slice(0, 5).map((el) => `Input: ${elementLabel(el, 'search field')}`),
      controls: searchInputs.slice(0, 8).map((el) => elementLabel(el, 'search field')),
      userGoal: `Find or narrow records on the ${pageName} page.`,
    });
  }

  if (inputs.length > 0) {
    pushFeature(features, {
      ...baseFeature,
      type: 'form',
      name: `${titleCase(pageName)} Data Entry`,
      evidence: inputs.slice(0, 8).map((el) => `Input: ${elementLabel(el, 'input field')}`),
      controls: inputs.slice(0, 10).map((el) => elementLabel(el, 'input field')),
      userGoal: `Enter or update information on the ${pageName} page.`,
    });
  }

  const createButtons = buttons.filter((el) => /\b(add|create|new|invite|save|submit|send|apply)\b/i.test(elementLabel(el, 'button')));
  for (const button of createButtons.slice(0, 6)) {
    const label = elementLabel(button, 'action');
    pushFeature(features, {
      ...baseFeature,
      type: 'action',
      name: `${titleCase(pageName)} ${titleCase(label)}`,
      evidence: [`Visible button/action control: ${label}`, button.clickHint ? `Observed click result: ${button.clickHint}` : null].filter(Boolean),
      controls: [label],
      userGoal: `Use the "${label}" action from the ${pageName} page.`,
    });
  }

  const navigationLinks = links.filter((el) => el.href || el.clickHint);
  if (navigationLinks.length > 0) {
    pushFeature(features, {
      ...baseFeature,
      type: 'navigation',
      name: `${titleCase(pageName)} Navigation`,
      evidence: navigationLinks.slice(0, 8).map((el) => `${elementLabel(el, 'link')} -> ${safeRoute(el.href, el.clickHint ? 'observed click destination' : 'unknown destination')}`),
      controls: navigationLinks.slice(0, 10).map((el) => elementLabel(el, 'link')),
      userGoal: `Move from ${pageName} to related application areas.`,
    });
  }

  if (tables.length > 0) {
    pushFeature(features, {
      ...baseFeature,
      type: 'records',
      name: `${titleCase(pageName)} Record Review`,
      evidence: tables.slice(0, 5).map((el) => `Table/list surface: ${elementLabel(el, 'table')}`),
      controls: tables.slice(0, 8).map((el) => elementLabel(el, 'table')),
      userGoal: `Review records or tabular information on the ${pageName} page.`,
    });
  }

  if (media.length > 0) {
    pushFeature(features, {
      ...baseFeature,
      type: 'media',
      name: `${titleCase(pageName)} Media Consumption`,
      evidence: media.slice(0, 5).map((el) => `Media element: ${elementLabel(el, 'media')}`),
      controls: media.slice(0, 8).map((el) => elementLabel(el, 'media')),
      userGoal: `View or interact with media content on the ${pageName} page.`,
    });
  }

  if (dialogs.length > 0) {
    pushFeature(features, {
      ...baseFeature,
      type: 'dialog',
      name: `${titleCase(pageName)} Modal Or Dialog Workflow`,
      evidence: dialogs.slice(0, 5).map((el) => `Dialog surface: ${elementLabel(el, 'dialog')}`),
      controls: dialogs.slice(0, 8).map((el) => elementLabel(el, 'dialog')),
      userGoal: `Open, inspect, or complete dialog-based workflows on the ${pageName} page.`,
    });
  }

  return features;
}

function featureFileContent(feature, index) {
  const controls = markdownList(feature.controls, 'No specific controls were identified.');
  const evidence = markdownList(feature.evidence, 'Based on visible page information.');
  return [
    `# ${feature.name}`,
    '',
    documentationSafetySection(),
    '',
    '## Purpose',
    '',
    feature.userGoal,
    '',
    'Use this note as a page-level QA reference for visible controls and behavior. Backend behavior, roles, permissions, APIs, data ownership, and business rules are included only when they are shown on the page.',
    '',
    '## Feature area',
    '',
    `This feature belongs to the **${feature.pageName}** page and was classified as **${feature.type}**.`,
    '',
    '## Page reference',
    '',
    `- **Page:** ${feature.pageName}`,
    `- **Feature type:** ${feature.type}`,
    `- **Feature number:** ${index}`,
    '',
    '## Page evidence',
    '',
    evidence,
    '',
    '## Primary controls or surfaces',
    '',
    controls,
    '',
    '## QA notes',
    '',
    '- Use the visible labels, roles, and locator hints for test discovery.',
    '- Keep assertions limited to the controls and states listed in this file.',
    '- Refresh this file when the page changes so removed or hidden UI is not documented as current behavior.',
    '',
  ].join('\n');
}

function inferOnboardingFeatureFiles(projectName, pages, projectSlug, repoRoot, outputDir) {
  const features = [];
  for (const page of pages) {
    features.push(...inferPageFeatures(page, readPageElements(repoRoot, outputDir, projectSlug, page)));
  }
  return features.slice(0, 24).map((feature, index) => {
    const number = String(index + 1).padStart(2, '0');
    const filename = `${number}_${slugify(feature.name).replace(/-/g, '_') || 'feature'}.md`;
    return [`00_Onboarding_QA/${filename}`, featureFileContent(feature, number)];
  });
}

function pageRequirementsContent(pageConfig, summary) {
  const buttons = pickSection(summary.sections, 'Buttons');
  const links = pickSection(summary.sections, 'Links');
  const inputs = pickSection(summary.sections, 'Inputs');
  const headings = pickSection(summary.sections, 'Headings');
  const landmarks = pickSection(summary.sections, 'Landmarks');

  const topCounts = summary.counts.slice(0, 6);
  const visibleInputs = summarizeRows(inputs, 12, (row) => ({
    tag: row[0] ?? '—',
    type: row[1] ?? '—',
    role: row[2] ?? '—',
    name: row[3] ?? '—',
    placeholder: row[4] ?? '—',
    ariaLabel: row[5] ?? '—',
    locatorHint: row[6] ?? '—',
    confidence: row[7] ?? '—',
  }));

  const buttonExamples = summarizeRows(buttons, 4, (row) => row[0] ?? '—');
  const linkExamples = summarizeRows(links, 4, (row) => row[0] ?? '—');
  const headingExamples = summarizeRows(headings, 4, (row) => row[1] ?? '—');
  const landmarkExamples = summarizeRows(landmarks, 4, (row) => row[2] ?? '—');

  const lines = [
    `# ${summary.pageTitle || pageConfig.name} Requirements`,
    '',
    '## Page overview',
    '',
    `- **Page name:** ${pageConfig.name}`,
    `- **Route:** ${safeRoute(normalizeText(summary.url, pageConfig.url))}`,
    `- **Page title:** ${normalizeText(summary.pageTitle, pageConfig.name)}`,
    `- **Extracted:** ${normalizeText(summary.extracted)}`,
    `- **Total elements:** ${normalizeText(summary.totalElements, '0')}`,
    `- **Source:** ` + `Documentation/${slugify(targetsConfig.projectName)}/${slugify(pageConfig.name)}/summary.md`,
    '',
    '## UI structure',
    '',
    buildCountsTable(summary.counts),
    '',
    '### Key surfaces',
    '',
    topCounts.length > 0
      ? topCounts.map((item) => `- ${item.category}: ${item.count}`).join('\n')
      : '- Summary counts were not available in the extracted report.',
    headings && headingExamples.length > 0 ? `- Headings: ${headingExamples.join(', ')}` : null,
    landmarks && landmarkExamples.length > 0 ? `- Landmarks: ${landmarkExamples.join(', ')}` : null,
    '',
    '## Observed interaction surfaces',
    '',
    buttonExamples.length > 0
      ? `- Buttons surfaced in the summary: ${buttonExamples.join(', ')}.`
      : null,
    linkExamples.length > 0
      ? `- Links surfaced in the summary: ${linkExamples.join(', ')}.`
      : null,
    inputs && visibleInputs.length > 0
      ? '- Inputs surfaced in the summary are listed in the field definitions section.'
      : null,
    !buttonExamples.length && !linkExamples.length && !(inputs && visibleInputs.length > 0)
      ? '- No button, link, or input examples were available in the extracted summary.'
      : null,
    '',
    '## Field definitions',
    '',
    visibleInputs.length > 0
      ? [
          '| Name | Type | Role | Placeholder | Aria label | Locator hint | Confidence |',
          '|---|---|---|---|---|---|---|',
          ...visibleInputs.map((item) => `| ${item.name} | ${item.type} | ${item.role} | ${item.placeholder} | ${item.ariaLabel} | ${item.locatorHint} | ${item.confidence} |`),
        ].join('\n')
      : '_No input fields were found in the extracted summary yet._',
    '',
    '## Extracted rules',
    '',
    '- The extracted summary is the observable source for the controls, labels, and counts in this file.',
    '- Validation, authorization, backend side effects, and hidden states are omitted unless they are visible in the extracted artifacts.',
    '',
    '## Observed states',
    '',
    '- The file only represents the state captured by the current extraction run.',
    '- Disabled or hidden controls are included only when they appear in the extracted data.',
    '',
    '## Out of scope',
    '',
    '- Page behavior not visible in `summary.md`.',
    '- Backend/API behavior not visible in the UI extraction.',
    '- Role or permission rules not visible in the UI extraction.',
    '',
  ].filter((line) => line !== null);

  return lines.join('\n');
}

function onboardingFiles(projectName, pages, projectSlug, repoRoot, outputDir) {
  const featureFiles = inferOnboardingFeatureFiles(projectName, pages, projectSlug, repoRoot, outputDir);
  if (featureFiles.length === 0) return new Map();

  const featureLines = featureFiles.map(([filePath]) => `- \`${filePath.replace('00_Onboarding_QA/', '')}\``);

  return new Map([
    ['00_Onboarding_QA/00_Project_About.md', [
      '# Onboarding QA',
      '',
      documentationSafetySection(),
      '',
      '## Purpose',
      '',
      'This onboarding index lists feature notes backed by visible page controls and surfaces.',
      '',
      '## Feature files',
      '',
      featureLines.join('\n'),
      '',
      '## Scope',
      '',
      '- These files do not assume backend APIs, hidden data models, permissions, roles, or business rules.',
      '- Refresh these files when the UI changes so stale feature notes are removed.',
      '',
    ].join('\n')],
    ...featureFiles,
  ]);
}

async function writeRequirementFiles(baseDir, files) {
  for (const [relativePath, content] of files.entries()) {
    await writeText(join(baseDir, relativePath), content);
  }
}

async function removeStaleOnboardingFiles(requirementsDir, files) {
  const onboardingDir = join(requirementsDir, '00_Onboarding_QA');
  if (!existsSync(onboardingDir)) return;
  const expected = new Set([...files.keys()].filter((filePath) => filePath.startsWith('00_Onboarding_QA/')).map((filePath) => filePath.replace('00_Onboarding_QA/', '')));
  const entries = await readdir(onboardingDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md') && !expected.has(entry.name)) {
      await unlink(join(onboardingDir, entry.name));
    }
  }
}

function pageRequirementFileName(pageConfig) {
  const pageSlug = slugify(pageConfig.name) || 'page';
  return `01_${pageSlug}.md`;
}

async function buildPageRequirement(projectName, projectSlug, repoRoot, outputDir, pageConfig, requirementsDir) {
  const summaryPath = resolve(repoRoot, outputDir, projectSlug, slugify(pageConfig.name), 'summary.md');
  const requirementsFolder = join(requirementsDir, '01_Requirements');
  await mkdir(requirementsFolder, { recursive: true });

  if (!existsSync(summaryPath)) {
    const placeholder = [
      `# ${pageConfig.name} Requirements`,
      '',
      '## Page overview',
      '',
      `- **Page name:** ${pageConfig.name}`,
      `- **Route:** ${safeRoute(pageConfig.url)}`,
      '- **Status:** `summary.md` is missing for this page, so the requirements tree was generated from config only.',
      '',
      '## UI structure',
      '',
      '- Re-run extraction for this page to populate the UI structure section.',
      '',
      '## Flows',
      '',
      '- Re-run extraction to capture flow-driven requirements from the page summary.',
      '',
      '## Field definitions',
      '',
      '- No extracted field data yet.',
      '',
      '## Business rules',
      '',
      '- No extracted page summary was available for this page.',
      '',
      '## Permissions',
      '',
      pageConfig.requiresAuth
        ? '- Authenticated access is expected once extraction data is available.'
        : '- Public access is expected once extraction data is available.',
      '',
      '## States & transitions',
      '',
      '- Loading.',
      '- Loaded.',
      '- Missing summary fallback.',
      '',
      '## Edge cases',
      '',
      '- Extract this page before refining the requirements.',
      '',
      '## Out of scope',
      '',
      '- Anything not yet surfaced in `summary.md`.',
      '',
    ].join('\n');
    await writeText(join(requirementsFolder, pageRequirementFileName(pageConfig)), placeholder);
    return { summaryPath, pageFolder: requirementsFolder, missing: true };
  }

  const summary = parseSummaryMarkdown(readFileSync(summaryPath, 'utf8'), pageConfig.name);
  await writeText(join(requirementsFolder, pageRequirementFileName(pageConfig)), pageRequirementsContent(pageConfig, summary));
  return { summaryPath, pageFolder: requirementsFolder, missing: false };
}

export async function generateRequirementsTree({
  repoRoot = resolve('.'),
  projectDir,
  outputDir = 'Documentation',
  projectName = targetsConfig.projectName,
  pages = targetsConfig.pages,
  projectSlug = slugify(targetsConfig.projectName) || 'playwright-project',
} = {}) {
  if (!projectDir) {
    throw new Error('generateRequirementsTree requires a projectDir');
  }

  const requirementsDir = join(projectDir, 'requirements');
  await mkdir(join(requirementsDir, '00_Onboarding_QA'), { recursive: true });

  const onboarding = onboardingFiles(projectName, pages, projectSlug, repoRoot, outputDir);
  await removeStaleOnboardingFiles(requirementsDir, onboarding);
  await writeRequirementFiles(requirementsDir, onboarding);

  const results = [];
  for (const pageConfig of pages) {
    results.push(await buildPageRequirement(projectName, projectSlug, repoRoot, outputDir, pageConfig, requirementsDir));
  }

  return {
    requirementsDir,
    onboardingFiles: [...onboarding.keys()],
    pageResults: results,
  };
}
