const PW_ROLE_MAP = {
    button: 'button',
    link: 'link',
    textbox: 'textbox',
    searchbox: 'searchbox',
    combobox: 'combobox',
    checkbox: 'checkbox',
    radio: 'radio',
    slider: 'slider',
    spinbutton: 'spinbutton',
    switch: 'switch',
    heading: 'heading',
    img: 'img',
    table: 'table',
    row: 'row',
    cell: 'cell',
    columnheader: 'columnheader',
    rowheader: 'rowheader',
    list: 'list',
    listitem: 'listitem',
    navigation: 'navigation',
    main: 'main',
    banner: 'banner',
    contentinfo: 'contentinfo',
    complementary: 'complementary',
    region: 'region',
    dialog: 'dialog',
    alertdialog: 'alertdialog',
    alert: 'alert',
    status: 'status',
    log: 'log',
    timer: 'timer',
    progressbar: 'progressbar',
    meter: 'meter',
    tab: 'tab',
    tablist: 'tablist',
    tabpanel: 'tabpanel',
    menu: 'menu',
    menubar: 'menubar',
    menuitem: 'menuitem',
    menuitemcheckbox: 'menuitemcheckbox',
    menuitemradio: 'menuitemradio',
    tree: 'tree',
    treeitem: 'treeitem',
    grid: 'grid',
    gridcell: 'gridcell',
    option: 'option',
    article: 'article',
    figure: 'figure',
    form: 'form',
    group: 'group',
    term: 'term',
    definition: 'definition',
    tooltip: 'tooltip',
    separator: 'separator',
    none: 'none',
    presentation: 'presentation',
};
const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'checkbox', 'radio', 'textbox', 'searchbox',
    'combobox', 'slider', 'spinbutton', 'switch', 'tab', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem', 'gridcell',
]);
function addLocatorOption(options, source, playwrightLocator, cssSelector, confidence) {
    const normalized = `${playwrightLocator}|${cssSelector}`;
    if (options.some((opt) => `${opt.playwrightLocator}|${opt.cssSelector}` === normalized))
        return;
    options.push({ source, playwrightLocator, cssSelector, confidence });
}
// ─────────────────────────────────────────────────────────────────────────────
// Public entry points
// ─────────────────────────────────────────────────────────────────────────────
export function buildSelectors(raw) {
    const options = [];
    if (raw.dataTestId) {
        addLocatorOption(options, 'data-testid', `page.getByTestId('${esc(raw.dataTestId)}')`, `[data-testid="${raw.dataTestId}"]`, 'high');
    }
    if (raw.id) {
        addLocatorOption(options, 'id', `page.locator('#${esc(raw.id)}')`, `#${raw.id}`, 'high');
    }
    if (raw.role === 'heading' && raw.text) {
        const levelClause = raw.headingLevel ? `, level: ${raw.headingLevel}` : '';
        addLocatorOption(options, 'heading', `page.getByRole('heading', { name: '${esc(trimText(raw.text, 80))}', exact: false${levelClause} })`, raw.headingLevel ? `h${raw.headingLevel}` : raw.tag, 'high');
    }
    if (raw.ariaLabel) {
        const role = playWrightRole(raw);
        const locator = role
            ? `page.getByRole('${role}', { name: '${esc(raw.ariaLabel)}' })`
            : `page.getByLabel('${esc(raw.ariaLabel)}')`;
        addLocatorOption(options, 'aria-label', locator, `${raw.tag}[aria-label="${raw.ariaLabel}"]`, 'high');
    }
    if (raw.tag === 'select') {
        if (raw.ariaLabel) {
            addLocatorOption(options, 'select aria-label', `page.getByRole('combobox', { name: '${esc(raw.ariaLabel)}' })`, `select[aria-label="${raw.ariaLabel}"]`, 'high');
        }
        if (raw.name) {
            addLocatorOption(options, 'select name', `page.locator('select[name="${esc(raw.name)}"]')`, `select[name="${raw.name}"]`, 'medium');
        }
        if (raw.id) {
            addLocatorOption(options, 'select id', `page.locator('select#${esc(raw.id)}')`, `select#${raw.id}`, 'high');
        }
    }
    if (raw.category === 'input' && raw.name) {
        addLocatorOption(options, 'name', `page.locator('[name="${esc(raw.name)}"]')`, `[name="${raw.name}"]`, 'medium');
    }
    if (raw.placeholder) {
        addLocatorOption(options, 'placeholder', `page.getByPlaceholder('${esc(raw.placeholder)}')`, `[placeholder="${raw.placeholder}"]`, 'medium');
    }
    const pwRole = playWrightRole(raw);
    if (pwRole && raw.text && isInteractiveRole(raw.role)) {
        addLocatorOption(options, 'accessible name', `page.getByRole('${pwRole}', { name: '${esc(trimText(raw.text, 80))}', exact: false })`, buildCssByAncestors(raw), 'medium');
    }
    if (raw.category === 'image' && raw.alt) {
        addLocatorOption(options, 'alt text', `page.getByAltText('${esc(raw.alt)}')`, `${raw.tag}[alt="${raw.alt}"]`, 'medium');
    }
    if (raw.ownText && raw.ownText.length <= 80) {
        addLocatorOption(options, 'exact text', `page.getByText('${esc(raw.ownText)}', { exact: true })`, buildCssByAncestors(raw), 'medium');
    }
    if (raw.text && raw.text.length <= 80) {
        addLocatorOption(options, 'visible text', `page.getByText('${esc(trimText(raw.text, 80))}', { exact: false })`, buildCssByAncestors(raw), 'medium');
    }
    if (raw.src) {
        const basename = raw.src.split('/').pop() ?? raw.src;
        addLocatorOption(options, 'src', `page.locator('${raw.tag}[src*="${esc(basename)}"]')`, `${raw.tag}[src*="${basename}"]`, 'low');
    }
    if (raw.ariaLabelledBy) {
        addLocatorOption(options, 'aria-labelledby', `page.locator('[aria-labelledby="${raw.ariaLabelledBy}"]')`, `[aria-labelledby="${raw.ariaLabelledBy}"]`, 'medium');
    }
    const fallbackCss = buildCssByAncestors(raw);
    addLocatorOption(options, 'css fallback', `page.locator('${esc(fallbackCss)}')`, fallbackCss, 'low');
    const best = options[0];
    return {
        locatorHint: best.playwrightLocator,
        cssSelector: best.cssSelector,
        confidence: best.confidence,
        locatorOptions: options,
    };
}
export function toExtractedElement(raw) {
    const { locatorHint, cssSelector, confidence, locatorOptions } = buildSelectors(raw);
    return {
        category: raw.category,
        tag: raw.tag,
        role: raw.role,
        text: raw.text,
        ownText: raw.ownText,
        id: raw.id,
        name: raw.name,
        placeholder: raw.placeholder,
        ariaLabel: raw.ariaLabel,
        ariaLabelledBy: raw.ariaLabelledBy,
        ariaDescribedBy: raw.ariaDescribedBy,
        ariaExpanded: raw.ariaExpanded,
        ariaSelected: raw.ariaSelected,
        ariaChecked: raw.ariaChecked,
        ariaHidden: raw.ariaHidden,
        dataTestId: raw.dataTestId,
        type: raw.type,
        href: raw.href,
        src: raw.src,
        alt: raw.alt,
        value: raw.value,
        onclick: raw.onclick,
        dataHref: raw.dataHref,
        dataUrl: raw.dataUrl,
        dataAction: raw.dataAction,
        formAction: raw.formAction,
        ariaControls: raw.ariaControls,
        ariaHasPopup: raw.ariaHasPopup,
        headingLevel: raw.headingLevel,
        nthIndex: raw.nthIndex,
        isVisible: raw.isVisible,
        isEnabled: raw.isEnabled,
        locatorHint,
        cssSelector,
        locatorOptions,
        clickHint: buildActionHint(raw),
        selectorConfidence: confidence,
        boundingBox: raw.boundingBox,
    };
}
function extractUrlFromHint(hint) {
    const match = hint.match(/navigates to "?([^"']+)"?/i);
    return match?.[1] ?? null;
}
function buildActionHint(raw) {
    const urlSource = raw.href || raw.dataHref || raw.dataUrl;
    if (urlSource) {
        return `navigates to ${urlSource}`;
    }
    if (raw.formAction || raw.type === 'submit') {
        if (raw.formAction) {
            return `submits the form to ${raw.formAction}`;
        }
        if (raw.type === 'submit') {
            return 'submits the form';
        }
    }
    if (raw.ariaControls) {
        const expanded = raw.ariaExpanded === 'true';
        return `${expanded ? 'closes' : 'opens'} the section controlled by ${raw.ariaControls}`;
    }
    if (raw.ariaHasPopup) {
        return `opens the popup or overlay referenced by ${raw.ariaHasPopup}`;
    }
    if (raw.onclick) {
        const openMatch = raw.onclick.match(/window\.open\(['"]([^'"]+)['"]/i);
        if (openMatch)
            return `opens ${openMatch[1]}`;
        const navMatch = raw.onclick.match(/location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i);
        if (navMatch)
            return `navigates to ${navMatch[1]}`;
        if (/(toggle|show|hide|open|close|collapse|expand|submit|save|send|download|upload)/i.test(raw.onclick)) {
            return 'triggers a UI action via onclick';
        }
        return 'triggers a click handler';
    }
    if (raw.dataAction) {
        return `performs action ${raw.dataAction}`;
    }
    return null;
}
// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function playWrightRole(raw) {
    return PW_ROLE_MAP[raw.role] ?? null;
}
function isInteractiveRole(role) {
    return INTERACTIVE_ROLES.has(role);
}
function esc(value) {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
function trimText(text, maxLen) {
    return text.length > maxLen ? text.slice(0, maxLen) : text;
}
function buildCssByAncestors(raw) {
    const ancestors = raw.ancestorPath.slice(-2);
    const nth = raw.nthIndex > 1 ? `:nth-of-type(${raw.nthIndex})` : '';
    const parts = [...ancestors, `${raw.tag}${nth}`];
    return parts.join(' > ');
}
