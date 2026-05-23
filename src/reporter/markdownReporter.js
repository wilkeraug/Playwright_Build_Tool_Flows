import { join } from 'path';
import { writeText, slugify } from '../utils/fsUtils.js';
// ─────────────────────────────────────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────────────────────────────────────
function row(...cells) {
    return `| ${cells.join(' | ')} |`;
}
function sep(count) {
    return `|${Array(count).fill('---').join('|')}|`;
}
function badge(c) {
    return c === 'high' ? 'High' : c === 'medium' ? 'Medium' : 'Low';
}
function clip(s, max = 60) {
    if (!s)
        return '—';
    return s.length > max ? s.slice(0, max) + '…' : s;
}
function formatLocatorOptions(el) {
    const options = el.locatorOptions ?? [{ source: 'default', playwrightLocator: el.locatorHint, cssSelector: el.cssSelector, confidence: el.selectorConfidence }];
    return options
        .map((opt) => `\`${opt.source}\`: \`${opt.playwrightLocator}\`<br>\`${opt.cssSelector}\``)
        .join('<br>');
}
// ─────────────────────────────────────────────────────────────────────────────
// Category-specific tables
// ─────────────────────────────────────────────────────────────────────────────
function buttonTable(els) {
    if (els.length === 0)
        return '_None found._\n';
    const header = row('Text', 'Aria Label', 'Type', 'Action Hint', 'Locator Hint', 'Conf', 'Visible', 'Enabled');
    return [header, sep(8),
        ...els.map(e => row(clip(e.text), clip(e.ariaLabel), e.type ?? '—', clip(e.clickHint), formatLocatorOptions(e), badge(e.selectorConfidence), e.isVisible ? 'yes' : 'no', e.isEnabled ? 'yes' : 'no')),
    ].join('\n') + '\n';
}
function linkTable(els) {
    if (els.length === 0)
        return '_None found._\n';
    const header = row('Text', 'Href', 'Aria Label', 'Action Hint', 'Locator Hint', 'Conf', 'Visible');
    return [header, sep(7),
        ...els.map(e => row(clip(e.text, 50), clip(e.href, 60), clip(e.ariaLabel), clip(e.clickHint), formatLocatorOptions(e), badge(e.selectorConfidence), e.isVisible ? 'yes' : 'no')),
    ].join('\n') + '\n';
}
function inputTable(els) {
    if (els.length === 0)
        return '_None found._\n';
    const header = row('Tag', 'Type', 'Role', 'Name', 'Placeholder', 'Aria Label', 'Locator Hint', 'Conf');
    return [header, sep(8),
        ...els.map(e => row(e.tag, e.type ?? '—', e.role, e.name ?? '—', clip(e.placeholder), clip(e.ariaLabel), formatLocatorOptions(e), badge(e.selectorConfidence))),
    ].join('\n') + '\n';
}
function headingTable(els) {
    if (els.length === 0)
        return '_None found._\n';
    const header = row('Level', 'Text', 'Locator Hint', 'Conf', 'Visible');
    return [header, sep(5),
        ...els.map(e => row(e.headingLevel ? `H${e.headingLevel}` : e.tag.toUpperCase(), clip(e.text, 80), formatLocatorOptions(e), badge(e.selectorConfidence), e.isVisible ? 'yes' : 'no')),
    ].join('\n') + '\n';
}
function textTable(els) {
    if (els.length === 0)
        return '_None found._\n';
    const header = row('Tag', 'Role', 'Text preview', 'Locator Hint', 'Conf', 'Visible');
    return [header, sep(6),
        ...els.map(e => row(e.tag, e.role, clip(e.ownText ?? e.text, 80), formatLocatorOptions(e), badge(e.selectorConfidence), e.isVisible ? 'yes' : 'no')),
    ].join('\n') + '\n';
}
function imageTable(els) {
    if (els.length === 0)
        return '_None found._\n';
    const header = row('Tag', 'Alt', 'Src (basename)', 'Locator Hint', 'Conf', 'Visible');
    return [header, sep(6),
        ...els.map(e => {
            const basename = e.src ? e.src.split('/').pop() ?? e.src : '—';
            return row(e.tag, clip(e.alt), clip(basename, 50), formatLocatorOptions(e), badge(e.selectorConfidence), e.isVisible ? 'yes' : 'no');
        }),
    ].join('\n') + '\n';
}
function mediaTable(els) {
    if (els.length === 0)
        return '_None found._\n';
    const header = row('Tag', 'Role', 'Src (basename)', 'Aria Label', 'Locator Hint', 'Conf', 'Visible');
    return [header, sep(7),
        ...els.map(e => {
            const basename = e.src ? e.src.split('/').pop() ?? e.src : '—';
            return row(e.tag, e.role, clip(basename, 50), clip(e.ariaLabel), formatLocatorOptions(e), badge(e.selectorConfidence), e.isVisible ? 'yes' : 'no');
        }),
    ].join('\n') + '\n';
}
function dialogTable(els) {
    if (els.length === 0)
        return '_None found._\n';
    const header = row('Tag', 'Role', 'testid', 'Aria Label', 'Visible', 'Locator Hint', 'Conf');
    return [header, sep(7),
        ...els.map(e => row(e.tag, e.role, e.dataTestId ?? '—', clip(e.ariaLabel), e.isVisible ? 'yes' : 'no', formatLocatorOptions(e), badge(e.selectorConfidence))),
    ].join('\n') + '\n';
}
function landmarkTable(els) {
    if (els.length === 0)
        return '_None found._\n';
    const header = row('Tag', 'Role', 'Aria Label', 'ID', 'Locator Hint', 'Conf', 'Visible');
    return [header, sep(7),
        ...els.map(e => row(e.tag, e.role, clip(e.ariaLabel), e.id ?? '—', formatLocatorOptions(e), badge(e.selectorConfidence), e.isVisible ? 'yes' : 'no')),
    ].join('\n') + '\n';
}
function tableTable(els) {
    if (els.length === 0)
        return '_None found._\n';
    const header = row('Tag', 'Role', 'Text preview', 'Aria Label', 'Locator Hint', 'Conf', 'Visible');
    return [header, sep(7),
        ...els.map(e => row(e.tag, e.role, clip(e.text, 60), clip(e.ariaLabel), formatLocatorOptions(e), badge(e.selectorConfidence), e.isVisible ? 'yes' : 'no')),
    ].join('\n') + '\n';
}
function listTable(els) {
    if (els.length === 0)
        return '_None found._\n';
    const header = row('Tag', 'Role', 'Text preview', 'Locator Hint', 'Conf', 'Visible');
    return [header, sep(6),
        ...els.map(e => row(e.tag, e.role, clip(e.ownText ?? e.text, 70), formatLocatorOptions(e), badge(e.selectorConfidence), e.isVisible ? 'yes' : 'no')),
    ].join('\n') + '\n';
}
function formTable(els) {
    if (els.length === 0)
        return '_None found._\n';
    const header = row('Tag', 'Role', 'Text preview', 'Name / ID', 'Locator Hint', 'Conf', 'Visible');
    return [header, sep(7),
        ...els.map(e => row(e.tag, e.role, clip(e.text, 60), e.name ?? e.id ?? '—', formatLocatorOptions(e), badge(e.selectorConfidence), e.isVisible ? 'yes' : 'no')),
    ].join('\n') + '\n';
}
function interactiveTable(els) {
    if (els.length === 0)
        return '_None found._\n';
    const header = row('Tag', 'Role', 'Text preview', 'Aria Label', 'testid', 'Action Hint', 'Locator Hint', 'Conf', 'Visible');
    return [header, sep(9),
        ...els.map(e => row(e.tag, e.role, clip(e.text), clip(e.ariaLabel), e.dataTestId ?? '—', clip(e.clickHint), formatLocatorOptions(e), badge(e.selectorConfidence), e.isVisible ? 'yes' : 'no')),
    ].join('\n') + '\n';
}
function widgetTable(els) {
    if (els.length === 0)
        return '_None found._\n';
    const header = row('Tag', 'Role', 'Text / Value', 'Aria Label', 'Locator Hint', 'Conf', 'Visible');
    return [header, sep(7),
        ...els.map(e => row(e.tag, e.role, clip(e.text ?? e.value), clip(e.ariaLabel), formatLocatorOptions(e), badge(e.selectorConfidence), e.isVisible ? 'yes' : 'no')),
    ].join('\n') + '\n';
}
function labelledTable(els) {
    if (els.length === 0)
        return '_None found._\n';
    const header = row('Tag', 'Role', 'Aria Label', 'testid', 'Text preview', 'Locator Hint', 'Conf', 'Visible');
    return [header, sep(8),
        ...els.map(e => row(e.tag, e.role, clip(e.ariaLabel), e.dataTestId ?? '—', clip(e.text), formatLocatorOptions(e), badge(e.selectorConfidence), e.isVisible ? 'yes' : 'no')),
    ].join('\n') + '\n';
}
const SECTIONS = [
    { category: 'button', title: 'Buttons', renderTable: buttonTable },
    { category: 'link', title: 'Links', renderTable: linkTable },
    { category: 'input', title: 'Inputs', renderTable: inputTable },
    { category: 'heading', title: 'Headings', renderTable: headingTable },
    { category: 'landmark', title: 'Landmarks', renderTable: landmarkTable },
    { category: 'dialog', title: 'Dialogs & Modals', renderTable: dialogTable },
    { category: 'form', title: 'Forms & Form Elements', renderTable: formTable },
    { category: 'table', title: 'Tables & Table Cells', renderTable: tableTable },
    { category: 'list', title: 'Lists & List Items', renderTable: listTable },
    { category: 'image', title: 'Images', renderTable: imageTable },
    { category: 'media', title: 'Media (video / audio)', renderTable: mediaTable },
    { category: 'interactive', title: 'Custom Interactive Elements', renderTable: interactiveTable },
    { category: 'widget', title: 'Widgets (progress/status)', renderTable: widgetTable },
    { category: 'labelled', title: 'Other Labelled Elements', renderTable: labelledTable },
    { category: 'text', title: 'Text Elements', renderTable: textTable },
];
// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────
export async function writePageMarkdown(result, projectName, outputDir = 'Documentation') {
    const byCategory = new Map();
    for (const sec of SECTIONS)
        byCategory.set(sec.category, []);
    for (const el of result.elements) {
        byCategory.get(el.category)?.push(el);
    }
    const extractedDate = new Date(result.extractedAt).toLocaleString('en-US', {
        dateStyle: 'medium', timeStyle: 'short',
    });
    const lines = [
        `# ${result.pageName}`,
        '',
        '| | |',
        '|---|---|',
        `| **URL** | ${result.url} |`,
        `| **Page title** | ${result.pageTitle} |`,
        `| **Extracted** | ${extractedDate} |`,
        `| **Total elements** | ${result.totalElements} |`,
        '',
        '## Summary',
        '',
        row('Category', 'Count'),
        sep(2),
        ...SECTIONS.map(s => row(s.title, String(byCategory.get(s.category)?.length ?? 0))),
        '',
    ];
    for (const sec of SECTIONS) {
        const els = byCategory.get(sec.category) ?? [];
        lines.push(`## ${sec.title} (${els.length})`, '', sec.renderTable(els), '');
    }
    lines.push('---', '', '## Confidence Legend', '', 'The **Conf** column in every table rates how stable the generated locator is likely to be in tests:', '', '| Rating | What it means |', '|---|---|', '| High (stable) | Locator is based on a unique `aria-label`, `data-testid`, or role+name — safe to use in assertions. |', '| Medium | Locator relies on visible text or a role without a unique name — works in most cases but may break if copy changes. |', '| Low (fragile) | Locator falls back to a CSS class chain (e.g. `div.MuiStack-root > button`) — highly sensitive to DOM structure and class name changes. Avoid in assertions; prefer refactoring to add a `data-testid`. |', '', '> Generated by [playwright-page-elements-extractor](https://github.com/your-username/playwright-page-elements-extractor)');
    const content = lines.join('\n');
    const filePath = join(outputDir, slugify(projectName), slugify(result.pageName), 'summary.md');
    await writeText(filePath, content);
    return filePath;
}
