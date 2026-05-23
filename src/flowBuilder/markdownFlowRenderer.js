import { join } from 'path';
import { writeText, slugify } from '../utils/fsUtils.js';
// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function row(...cells) {
    return `| ${cells.join(' | ')} |`;
}
function sep(count) {
    return `|${Array(count).fill('---').join('|')}|`;
}
const ACTION_BADGE = {
    navigate: 'Navigate',
    click: 'Click',
    fill: 'Fill',
    assert: 'Assert',
    'assert-not': 'Assert not',
    wait: 'Wait',
    select: 'Select',
    check: 'Check',
    hover: 'Hover',
    note: 'Note',
};
// ─────────────────────────────────────────────────────────────────────────────
// Manual QA: one row per step, numbered action list + single end-state result
// ─────────────────────────────────────────────────────────────────────────────
function stepActionText(step) {
    if (step.action === 'navigate' && step.path)
        return `Go to \`${step.path}\``;
    if ((step.action === 'fill' || step.action === 'select') && step.value) {
        return `${step.description} → \`"${step.value}"\``;
    }
    return step.description;
}
/**
 * Build a single-cell ordered list of all action steps (navigate, click, fill,
 * select, check, hover, wait, note). Assert steps are excluded — they become
 * the expected result instead.
 *
 * Markdown inside a table cell requires <br> line separators; we use an HTML
 * ordered list rendered inline so most Markdown renderers show it correctly.
 */
function buildActionsList(steps) {
    const actionSteps = steps.filter((s) => s.action !== 'assert' && s.action !== 'assert-not' && s.action !== 'note');
    if (actionSteps.length === 0)
        return '—';
    // Use HTML <ol> so numbered list renders inside a table cell
    const items = actionSteps.map((s) => `<li>${stepActionText(s)}</li>`).join('');
    return `<ol>${items}</ol>`;
}
/**
 * Derive a single end-state expected result from the flow's assert steps.
 * If there are multiple asserts, we synthesise a summary sentence from the
 * last meaningful assert (the terminal state) rather than listing each one.
 */
function buildExpectedResult(steps, flowName) {
    const asserts = steps.filter((s) => s.action === 'assert' || s.action === 'assert-not');
    if (asserts.length === 0) {
        // No explicit assert steps — derive from flow name/last action
        const lastAction = [...steps].reverse().find((s) => s.action !== 'note');
        if (lastAction?.action === 'navigate') {
            return `The **${flowName}** page loads successfully and its key content is visible.`;
        }
        return `The expected outcome of **${flowName}** is achieved.`;
    }
    // Use the last assert as the terminal state
    const terminal = asserts[asserts.length - 1];
    if (terminal.state === 'visible' && terminal.element) {
        // Check if this is a navigation flow
        const hasNavigate = steps.some((s) => s.action === 'navigate');
        if (hasNavigate && asserts.length > 1) {
            // Multiple landmarks/headings being asserted → page-load result
            return `The **${flowName}** page loads successfully with all key landmarks and headings visible.`;
        }
        return `**${terminal.element}** is visible on the page.`;
    }
    if (terminal.state === 'hidden' && terminal.element) {
        return `**${terminal.element}** is no longer visible.`;
    }
    if (terminal.state === 'url' && terminal.expectedText) {
        return `The browser navigates to \`${terminal.expectedText}\`.`;
    }
    if (terminal.state === 'text' && terminal.expectedText && terminal.element) {
        return `**${terminal.element}** displays the text "${terminal.expectedText}".`;
    }
    if (terminal.state === 'enabled' && terminal.element) {
        return `**${terminal.element}** becomes enabled and interactive.`;
    }
    if (terminal.state === 'disabled' && terminal.element) {
        return `**${terminal.element}** is disabled.`;
    }
    if (terminal.state === 'checked' && terminal.element) {
        return `**${terminal.element}** is checked.`;
    }
    // Fallback: use the description of the last assert
    return terminal.description;
}
/**
 * Render preconditions as a numbered HTML list so they display correctly
 * inside a Markdown table cell. Returns "—" when there are none.
 */
function buildPreconditionsCell(preconditions) {
    if (!preconditions || preconditions.length === 0)
        return '—';
    const items = preconditions.map((p) => `<li>${p}</li>`).join('');
    return `<ol>${items}</ol>`;
}
// ─────────────────────────────────────────────────────────────────────────────
// Technical table: one row per non-note step, with locators
// ─────────────────────────────────────────────────────────────────────────────
function technicalRow(step, stepNum) {
    const actionType = ACTION_BADGE[step.action] ?? step.action;
    const locator = step.resolvedLocator
        ? `\`${step.resolvedLocator}\``
        : step.action === 'navigate'
            ? step.path ? `\`${step.path}\`` : '—'
            : step.element
                ? `_unresolved: "${step.element}"_`
                : '—';
    const conf = step.confidence ?? '—';
    return row(String(stepNum), actionType, locator, conf);
}
// ─────────────────────────────────────────────────────────────────────────────
// Flow renderer — one row per flow in Manual QA, one row per step in Technical
// ─────────────────────────────────────────────────────────────────────────────
function renderFlow(flow, projectName, pageName) {
    const lines = [
        `## ${flow.id} — ${flow.name}`,
        '',
    ];
    if (flow.description) {
        lines.push(`> ${flow.description}`, '');
    }
    // Manual QA table — one row: preconditions + numbered action list + single end-state result
    const actionsList = buildActionsList(flow.steps);
    const expectedResult = buildExpectedResult(flow.steps, flow.name);
    const precondCell = buildPreconditionsCell(flow.preconditions);
    // Add prefix to Flow column if projectName and pageName are provided
    const flowWithPrefix = (projectName && pageName)
        ? `${projectName} - ${pageName} \\| ${flow.name}`
        : flow.name;
    lines.push('### Manual QA', '', row('#', 'Flow', 'Precondition(s)', 'Action(s)', 'Expected Result'), sep(5), row(flow.id, flowWithPrefix, precondCell, actionsList, expectedResult), '');
    // Technical table — one row per non-note step, with locators
    const technicalSteps = flow.steps.filter((s) => s.action !== 'note');
    lines.push('### Technical', '', row('#', 'Action Type', 'Locator', 'Confidence'), sep(4), ...technicalSteps.map((s, i) => technicalRow(s, i + 1)), '');
    // Notes
    const hasNotes = flow.steps.some((s) => s.notes);
    if (hasNotes) {
        lines.push('**Notes:**', '');
        flow.steps.forEach((step, i) => {
            if (step.notes)
                lines.push(`- **Step ${i + 1}:** ${step.notes}`);
        });
        lines.push('');
    }
    // Unresolved warnings
    const unresolved = flow.steps.filter((s) => s.element && !s.resolvedLocator && s.action !== 'note');
    if (unresolved.length > 0) {
        lines.push('> **Unresolved elements** — run `npm run extract` for these pages to populate locators:', '');
        for (const s of unresolved) {
            lines.push(`> - \`${s.element}\` (step: "${s.description}")`);
        }
        lines.push('');
    }
    return lines.join('\n');
}
// ─────────────────────────────────────────────────────────────────────────────
// Per-flow file writer
// ─────────────────────────────────────────────────────────────────────────────
export async function writeFlowMarkdown(flow, projectName, pageName, outputDir = 'Documentation') {
    const lines = [
        `# Flow ${flow.id}: ${flow.name}`,
        '',
        `**Project:** ${projectName}`,
        `**Page:** \`${pageName}\``,
        '',
    ];
    // renderFlow starts with the h2 + description; skip both (h2 + empty + description + empty = 4 lines)
    const rendered = renderFlow(flow).split('\n');
    const bodyStart = flow.description ? 4 : 2;
    lines.push(rendered.slice(bodyStart).join('\n'));
    lines.push('---', '', '## Confidence Legend', '', '| Rating | Meaning |', '|---|---|', '| High | Stable locator (aria-label, data-testid, or unique role+name) |', '| Medium | Visible text or non-unique role — may break if copy changes |', '| Low | CSS class chain — fragile, avoid in assertions |', '| — | Unset | Action has no element target (navigate, note) |', '', '> Generated by [playwright-page-elements-extractor](https://github.com/your-username/playwright-page-elements-extractor)');
    const content = lines.join('\n');
    const filename = `${flow.id.replace(/\./g, '-')}-${slugify(flow.name)}.md`;
    const filePath = join(outputDir, slugify(projectName), slugify(pageName), 'flows', filename);
    await writeText(filePath, content);
    return filePath;
}
// ─────────────────────────────────────────────────────────────────────────────
// Combined index file writer
// ─────────────────────────────────────────────────────────────────────────────
export async function writeFlowsIndex(flows, projectName, pageName, outputDir = 'Documentation') {
    const now = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    const lines = [
        `# Tool Flows — ${projectName} / ${pageName}`,
        '',
        `| | |`,
        `|---|---|`,
        `| **Project** | ${projectName} |`,
        `| **Page** | \`${pageName}\` |`,
        `| **Generated** | ${now} |`,
        `| **Total flows** | ${flows.length} |`,
        '',
        '## Flow Index',
        '',
        row('ID', 'Name', 'Preconditions', 'Steps', 'Unresolved'),
        sep(5),
        ...flows.map((f) => {
            const unresolved = f.steps.filter((s) => s.element && !s.resolvedLocator && s.action !== 'note').length;
            const precondSummary = f.preconditions.length > 0
                ? f.preconditions.join(' · ')
                : '—';
            return row(f.id, f.name, precondSummary, String(f.steps.length), unresolved > 0 ? String(unresolved) : '0');
        }),
        '',
        '---',
        '',
        flows.map((f) => renderFlow(f, projectName, pageName)).join('\n---\n\n'),
        '',
        '---',
        '',
        '## Confidence Legend',
        '',
        '| Rating | Meaning |',
        '|---|---|',
        '| High | Stable locator (aria-label, data-testid, or unique role+name) |',
        '| Medium | Visible text or non-unique role — may break if copy changes |',
        '| Low | CSS class chain — fragile, avoid in assertions |',
        '| — | Unset | Action has no element target (navigate, note) |',
        '',
        '> Generated by [playwright-page-elements-extractor](https://github.com/your-username/playwright-page-elements-extractor)',
    ];
    const content = lines.join('\n');
    const filePath = join(outputDir, slugify(projectName), slugify(pageName), 'flows', 'index.md');
    await writeText(filePath, content);
    return filePath;
}
// ─────────────────────────────────────────────────────────────────────────────
// Integration flows index writer — shared chrome elements, per page
// ─────────────────────────────────────────────────────────────────────────────
export async function writeIntegrationIndex(flows, projectName, pageName, outputDir = 'Documentation') {
    const now = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    const lines = [
        `# Integration Flows — ${projectName} / ${pageName}`,
        '',
        `| | |`,
        `|---|---|`,
        `| **Project** | ${projectName} |`,
        `| **Origin page** | \`${pageName}\` |`,
        `| **Scope** | Navigation chrome (sidebar + top bar) — elements shared across all pages |`,
        `| **Generated** | ${now} |`,
        `| **Total flows** | ${flows.length} |`,
        '',
        '> These flows test navigation elements that are part of the shared application chrome',
        '> (left sidebar, top navigation bar). They are integration tests because clicking them',
        '> leaves the current page and lands on a different page of the application.',
        '',
        '## Flow Index',
        '',
        row('ID', 'Name', 'Preconditions', 'Steps', 'Unresolved'),
        sep(5),
        ...flows.map((f) => {
            const unresolved = f.steps.filter((s) => s.element && !s.resolvedLocator && s.action !== 'note').length;
            const precondSummary = f.preconditions.length > 0
                ? f.preconditions.join(' · ')
                : '—';
            return row(f.id, f.name, precondSummary, String(f.steps.length), unresolved > 0 ? String(unresolved) : '0');
        }),
        '',
        '---',
        '',
        flows.map((f) => renderFlow(f, projectName, pageName)).join('\n---\n\n'),
        '',
        '---',
        '',
        '## Confidence Legend',
        '',
        '| Rating | Meaning |',
        '|---|---|',
        '| High | Stable locator (aria-label, data-testid, or unique role+name) |',
        '| Medium | Visible text or non-unique role — may break if copy changes |',
        '| Low | CSS class chain — fragile, avoid in assertions |',
        '| — | Unset | Action has no element target (navigate, note) |',
        '',
        '> Generated by [playwright-page-elements-extractor](https://github.com/your-username/playwright-page-elements-extractor)',
    ];
    const content = lines.join('\n');
    const filePath = join(outputDir, slugify(projectName), slugify(pageName), 'flows', 'integration.md');
    await writeText(filePath, content);
    return filePath;
}
// ─────────────────────────────────────────────────────────────────────────────
// Cross-page index file writer
// ─────────────────────────────────────────────────────────────────────────────
export async function writeCrossPageFlowsIndex(flows, projectName, outputDir = 'Documentation') {
    const now = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    const lines = [
        `# Tool Flows — ${projectName} / Cross-Page Integration`,
        '',
        `| | |`,
        `|---|---|`,
        `| **Project** | ${projectName} |`,
        `| **Scope** | \`cross-page\` |`,
        `| **Generated** | ${now} |`,
        `| **Total flows** | ${flows.length} |`,
        '',
        '## Flow Index',
        '',
        row('ID', 'Name', 'Pages', 'Preconditions', 'Steps', 'Unresolved'),
        sep(6),
        ...flows.map((f) => {
            const unresolved = f.steps.filter((s) => s.element && !s.resolvedLocator && s.action !== 'note').length;
            const precondSummary = f.preconditions.length > 0 ? f.preconditions.join(' · ') : '—';
            return row(f.id, f.name, f.pages.join(' → '), precondSummary, String(f.steps.length), unresolved > 0 ? String(unresolved) : '0');
        }),
        '',
        '---',
        '',
        flows.map((f) => renderFlow(f, projectName, 'cross-page')).join('\n---\n\n'),
        '',
        '---',
        '',
        '## Confidence Legend',
        '',
        '| Rating | Meaning |',
        '|---|---|',
        '| High | Stable locator (aria-label, data-testid, or unique role+name) |',
        '| Medium | Visible text or non-unique role — may break if copy changes |',
        '| Low | CSS class chain — fragile, avoid in assertions |',
        '| — | Unset | Action has no element target (navigate, note) |',
        '',
        '> Generated by [playwright-page-elements-extractor](https://github.com/your-username/playwright-page-elements-extractor)',
    ];
    const content = lines.join('\n');
    const filePath = join(outputDir, slugify(projectName), 'cross-page', 'flows', 'index.md');
    await writeText(filePath, content);
    return filePath;
}
