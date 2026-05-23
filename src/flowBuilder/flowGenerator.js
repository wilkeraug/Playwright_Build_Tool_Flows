import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { slugify } from '../utils/fsUtils.js';
export function loadPageElements(projectName, pageName, outputDir) {
    const filePath = join(outputDir, slugify(projectName), slugify(pageName), 'elements.json');
    if (!existsSync(filePath)) {
        throw new Error(`No elements.json found for page "${pageName}" at ${filePath}. Run npm run extract first.`);
    }
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    return {
        pageName: raw.pageName,
        pageTitle: raw.pageTitle,
        url: raw.url,
        elements: raw.elements ?? [],
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// Element helpers
// ─────────────────────────────────────────────────────────────────────────────
function label(el) {
    return (el.ariaLabel ??
        el.dataTestId ??
        el.text ??
        el.placeholder ??
        el.alt ??
        el.name ??
        el.id ??
        el.tag);
}
function isInteractive(el) {
    return ['button', 'link', 'input', 'interactive', 'widget'].includes(el.category);
}
function isGenericElementLabel(text) {
    const normal = normalise(text);
    return [
        'button',
        'a',
        'link',
        'input',
        'field',
        'item',
        'icon',
        'text',
        'label',
        'value',
        'submit',
        'click',
        'page',
        'section',
    ].includes(normal);
}
function elementMetaHint(el) {
    if (el.dataTestId)
        return `data-testid="${el.dataTestId}"`;
    if (el.ariaLabel)
        return `aria-label="${el.ariaLabel}"`;
    if (el.id)
        return `id="${el.id}"`;
    if (el.name)
        return `name="${el.name}"`;
    if (el.placeholder)
        return `placeholder="${el.placeholder}"`;
    if (el.href)
        return `href="${el.href}"`;
    return null;
}
function hasMeaningfulLabel(el) {
    const elLabel = label(el);
    if (!isGenericElementLabel(elLabel))
        return true;
    return Boolean(elementMetaHint(el));
}
function specificElementLabel(el) {
    const base = label(el) || el.tag || 'element';
    if (!isGenericElementLabel(base))
        return base;
    const hint = elementMetaHint(el);
    if (hint)
        return `${base} (${hint})`;
    if (el.role)
        return `${base} (${el.role})`;
    return base;
}
function deriveAssertState(el, elLabel) {
    const lower = elLabel.toLowerCase();
    if (isLink(el) && el.href)
        return 'url';
    if (/\b(close|hide|collapse|dismiss)\b/.test(lower))
        return 'hidden';
    if (/\b(open|show|expand|view|launch|display)\b/.test(lower))
        return 'visible';
    if (/\b(submit|send|save|apply|confirm|create|add)\b/.test(lower))
        return 'visible';
    if (/\b(delete|remove|clear|reset)\b/.test(lower))
        return 'visible';
    if (/\b(search|filter|find)\b/.test(lower))
        return 'visible';
    if (/\b(next|continue|proceed|back|previous|cancel)\b/.test(lower))
        return 'visible';
    if (/\b(login|sign in|log in)\b/.test(lower))
        return 'url';
    if (/\b(logout|sign out|log out)\b/.test(lower))
        return 'url';
    if (/\b(download|export|upload|import)\b/.test(lower))
        return undefined;
    if (/\b(toggle|enable|disable|switch)\b/.test(lower))
        return 'visible';
    return 'visible';
}
function extractUrlFromClickHint(hint) {
    const navMatch = hint.match(/navigates to\s+"?([^"'\s]+)"?/i);
    if (navMatch && navMatch[1])
        return navMatch[1];
    const tabMatch = hint.match(/opens\s+"?([^"'\s]+)"?\s+in a new tab/i);
    if (tabMatch && tabMatch[1])
        return tabMatch[1];
    return null;
}
function deriveExpectedAssertionStep(el, elLabel, meta) {
    if (isLink(el) && el.href) {
        return {
            action: 'assert',
            description: outcomeFromHref(el.href),
            state: 'url',
            expectedText: el.href,
        };
    }
    if (isLink(el)) {
        return {
            action: 'assert',
            description: `The "${elLabel}" link activates and the corresponding page or section loads.`,
            element: elLabel,
            state: 'visible',
        };
    }
    if (el.clickHint) {
        const expectedText = extractUrlFromClickHint(el.clickHint);
        const state = /navigate|url|external|site|new tab/i.test(el.clickHint)
            ? 'url'
            : /close|hide|collapse/i.test(el.clickHint)
                ? 'hidden'
                : 'visible';
        return {
            action: 'assert',
            description: `The "${elLabel}" ${el.category} ${el.clickHint}.`,
            element: isButton(el) ? undefined : elLabel,
            state,
            expectedText: expectedText ?? undefined,
        };
    }
    const description = deriveExpectedOutcome(el, elLabel, meta);
    return {
        action: 'assert',
        description,
        element: isButton(el) ? undefined : elLabel,
        state: deriveAssertState(el, elLabel),
    };
}
function isButton(el) {
    return el.category === 'button' || el.role === 'button';
}
function isLink(el) {
    return el.category === 'link' || el.role === 'link';
}
function isInput(el) {
    return el.category === 'input';
}
function inputAction(el) {
    if (el.type === 'checkbox' || el.role === 'checkbox')
        return 'check';
    // Native <select> or combobox that is a real HTML select — use selectOption
    if (el.tag === 'select' || el.role === 'listbox')
        return 'select';
    // Custom MUI/JS comboboxes backed by a listbox popup must be clicked, not .selectOption()
    if (el.role === 'combobox')
        return 'fill';
    return 'fill';
}
/** Returns true for a combobox element that opens a popup (custom MUI select / autocomplete).
 *  These are not form fields — they are navigation/filter controls and should be
 *  treated as click interactions, not form-submit flows. */
function isPopupCombobox(el) {
    return (el.role === 'combobox' &&
        el.tag !== 'select' &&
        (el.ariaHasPopup === 'listbox' || el.ariaHasPopup === 'true' || el.ariaHasPopup === 'dialog'));
}
function placeholderValue(el) {
    if (el.type === 'email')
        return 'user@example.com';
    if (el.type === 'tel')
        return '555-000-0000';
    if (el.type === 'number')
        return '100';
    if (el.type === 'date')
        return '2024-01-01';
    return 'example value';
}
// ─────────────────────────────────────────────────────────────────────────────
// ResolvedStep factory — locator already known from elements.json
// ─────────────────────────────────────────────────────────────────────────────
function resolved(step, el, pageName) {
    return {
        ...step,
        resolvedLocator: el?.locatorHint ?? null,
        resolvedPage: pageName,
        confidence: el?.selectorConfidence ?? null,
    };
}
function resolvedNoEl(step, pageName) {
    return { ...step, resolvedLocator: null, resolvedPage: pageName, confidence: null };
}
// ─────────────────────────────────────────────────────────────────────────────
// Smart precondition detection
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Elevated-permission URL segments. When a page URL contains any of these,
 * a permissions precondition is added.
 */
const ELEVATED_PERMISSION_SEGMENTS = [
    { pattern: /\badmin\b/i, label: 'admin' },
    { pattern: /\bmanage\b/i, label: 'manager' },
    { pattern: /\bsettings\b/i, label: 'settings access' },
    { pattern: /\bconfigur/i, label: 'configuration access' },
    { pattern: /\breport[s]?\b/i, label: 'reporting access' },
    { pattern: /\banalytics\b/i, label: 'analytics access' },
    { pattern: /\bbilling\b/i, label: 'billing access' },
    { pattern: /\bpermissions?\b/i, label: 'permissions management' },
];
/**
 * Labels that signal an "Add / Create / New" action — used to detect whether
 * a flow requires pre-existing data vs. creates a new record.
 */
const ADD_VERB_PATTERN = /\b(add|create|new|invite)\b/i;
/**
 * Labels that signal a destructive / edit action that requires a record to exist.
 */
const EDIT_VERB_PATTERN = /\b(edit|update|delete|remove|archive|restore|export|send)\b/i;
/**
 * Entity nouns derived from the page title or name.
 * Used to phrase data-requirement preconditions naturally.
 */
function deriveEntityNoun(meta) {
    // Prefer the page title (e.g. "Client Manager" → "client") over the slug
    const source = meta.pageTitle || meta.pageName;
    // Strip common generic suffixes to get the entity word
    const cleaned = source
        .replace(/\s*(manager|list|dashboard|page|view|overview|center|hub|portal)\s*/gi, ' ')
        .trim();
    const words = cleaned.split(/\s+/).filter(Boolean);
    // Take the last meaningful word as the entity noun
    const noun = words[words.length - 1] ?? source.split(/[-\s]/)[0] ?? 'record';
    return noun.toLowerCase();
}
/**
 * Returns true when the page contains a visible data table or list with at least
 * one row (i.e. there is live data being displayed).
 */
function hasDataTable(meta) {
    return meta.elements.some((e) => e.category === 'table' && e.isVisible);
}
/**
 * Returns true when the page has a search/filter input that acts on the data list.
 */
function hasSearchInput(meta) {
    return meta.elements.some((e) => isInput(e) &&
        e.isVisible &&
        (e.dataTestId?.toLowerCase().includes('search') ||
            e.ariaLabel?.toLowerCase().includes('search') ||
            e.placeholder?.toLowerCase().includes('search') ||
            e.name?.toLowerCase().includes('search')));
}
/**
 * Returns true when the page has a visible filter control (button or combobox).
 */
function hasFilterControl(meta) {
    return meta.elements.some((e) => e.isVisible &&
        (e.dataTestId?.toLowerCase().includes('filter') ||
            e.ariaLabel?.toLowerCase().includes('filter') ||
            e.text?.toLowerCase().includes('filter') ||
            e.text?.toLowerCase() === 'filters'));
}
/**
 * Derives the list of preconditions for a flow.
 *
 * @param meta       - Page metadata (url, elements, requiresAuth, etc.)
 * @param context    - What kind of flow this is, used to pick relevant conditions
 * @param flowElement - The primary element being interacted with (if any)
 */
function detectPreconditions(meta, context, flowElement) {
    const conditions = [];
    // ── 1. Auth ──────────────────────────────────────────────────────────────
    if (meta.requiresAuth) {
        conditions.push('User must be logged in with a valid account.');
    }
    // ── 2. Elevated permissions (URL-based) ──────────────────────────────────
    for (const { pattern, label: permLabel } of ELEVATED_PERMISSION_SEGMENTS) {
        if (pattern.test(meta.url)) {
            conditions.push(`User account must have ${permLabel} permissions.`);
            break; // one permission condition is enough
        }
    }
    // ── 3. Current page (not needed for navigation flow — that flow navigates TO the page) ──
    if (context !== 'navigate') {
        conditions.push(`User must be on the ${meta.pageName} page.`);
    }
    // ── 4. Search/filter state — reset when the flow operates on the data list ──
    if (context !== 'navigate' && hasSearchInput(meta)) {
        const elLabel = flowElement ? label(flowElement).toLowerCase() : '';
        const isSearchFlow = /search|filter|find/i.test(elLabel);
        if (!isSearchFlow) {
            conditions.push('Search field must be empty and no active filters applied.');
        }
    }
    else if (context !== 'navigate' && hasFilterControl(meta) && !hasSearchInput(meta)) {
        const elLabel = flowElement ? label(flowElement).toLowerCase() : '';
        if (!/filter/i.test(elLabel)) {
            conditions.push('No active filters applied (default filter state).');
        }
    }
    // ── 5. Data requirements ─────────────────────────────────────────────────
    if (hasDataTable(meta)) {
        const entity = deriveEntityNoun(meta);
        const elLabel = flowElement ? label(flowElement) : '';
        const isAddAction = ADD_VERB_PATTERN.test(elLabel);
        const isEditOrDestructive = EDIT_VERB_PATTERN.test(elLabel);
        if (isEditOrDestructive) {
            // Editing/deleting requires an existing record
            conditions.push(`At least one existing ${entity} record must be present in the list.`);
        }
        else if (!isAddAction) {
            // General data-list interaction (sort, row click, export, etc.)
            conditions.push(`At least one ${entity} record must exist in the system.`);
        }
        // Add-flows don't need existing records, so no condition added
    }
    // ── 6. Form field requirements ───────────────────────────────────────────
    if (context === 'form' && flowElement == null) {
        // For a form group flow, list the visible required fields as a hint
        const requiredInputs = meta.elements.filter((e) => isInput(e) &&
            e.isVisible &&
            (e.ariaLabel?.toLowerCase().includes('required') ||
                e.placeholder?.toLowerCase().includes('required') ||
                e.name?.toLowerCase().includes('required')));
        if (requiredInputs.length > 0) {
            const fieldNames = requiredInputs.map((e) => specificElementLabel(e)).join(', ');
            conditions.push(`Required fields must be filled: ${fieldNames}.`);
        }
    }
    return conditions;
}
// ─────────────────────────────────────────────────────────────────────────────
// Flow 1 — Navigation & key landmarks visible
// ─────────────────────────────────────────────────────────────────────────────
function buildNavigationFlow(meta, flowIdPrefix) {
    const headings = meta.elements.filter((e) => e.category === 'heading' && e.isVisible);
    const landmarks = meta.elements.filter((e) => e.category === 'landmark' && e.isVisible);
    const steps = [
        resolved({ action: 'navigate', description: `Go to the ${meta.pageName} page`, path: meta.url }, null, meta.pageName),
    ];
    // Assert first heading
    const firstHeading = headings[0];
    if (firstHeading && firstHeading.text) {
        steps.push(resolved({
            action: 'assert',
            description: `Page heading is visible: "${firstHeading.text}"`,
            element: firstHeading.text,
            state: 'visible',
        }, firstHeading, meta.pageName));
    }
    // Assert up to 3 landmark regions
    landmarks.slice(0, 3).forEach((lm) => {
        const lmLabel = label(lm);
        if (lmLabel && lmLabel !== lm.tag) {
            steps.push(resolved({
                action: 'assert',
                description: `Landmark region "${lmLabel}" is present`,
                element: lmLabel,
                state: 'visible',
            }, lm, meta.pageName));
        }
    });
    const preconditions = detectPreconditions(meta, 'navigate');
    return {
        id: `${flowIdPrefix}.1`,
        name: `Navigate to ${meta.pageName}`,
        description: `Navigate to the ${meta.pageName} page and verify key landmarks are visible.`,
        pages: [meta.pageName],
        preconditions,
        steps,
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// Expected outcome derivation
// ─────────────────────────────────────────────────────────────────────────────
/** Normalise a string for loose comparison: lowercase, strip punctuation/spaces. */
function normalise(s) {
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
/** Derive a destination sentence from an href string (shared by link + button logic). */
function outcomeFromHref(href) {
    if (href.startsWith('http://') || href.startsWith('https://')) {
        try {
            const hostname = new URL(href).hostname.replace(/^www\./, '');
            return `The browser navigates to the external site "${hostname}" in a new tab or the current window.`;
        }
        catch {
            return `The browser navigates to the external URL: ${href}.`;
        }
    }
    const segment = href.split('?')[0].split('/').filter(Boolean).pop() ?? '';
    const pageName = segment.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return pageName
        ? `The browser navigates to the "${pageName}" page and its content is visible.`
        : `The browser navigates to "${href}" and the page content is visible.`;
}
/**
 * Derives a concrete expected-result sentence for a click action.
 *
 * For links: uses href to name the destination page or domain.
 * For buttons: first checks if a sibling link on the same page shares the
 *   same label (nav menu pattern), then falls back to label keyword matching.
 */
function deriveExpectedOutcome(el, elLabel, meta) {
    // ── Link with href ──────────────────────────────────────────────────────
    if (isLink(el) && el.href) {
        return outcomeFromHref(el.href);
    }
    // ── Link without href (JS-driven anchor) ────────────────────────────────
    if (isLink(el)) {
        return `The "${elLabel}" link activates and the corresponding page or section loads.`;
    }
    if (el.clickHint) {
        return `The "${elLabel}" button ${el.clickHint}.`;
    }
    // ── Button: cross-reference sibling links on the same page ─────────────
    // Catches nav-menu buttons whose destination is implied by a nearby link.
    // Strategy 1 — exact label match against link text or aria-label.
    // Strategy 2 — label normalised == last path segment of a link's href.
    // Strategy 3 — any path segment of any sibling href contains the label
    //              (e.g. button "Marketing" → href /members/marketing-kit).
    const normLabel = normalise(elLabel);
    const allLinks = meta.elements.filter((e) => isLink(e) && e.href);
    const siblingLink = allLinks.find((e) => normalise(e.text ?? '') === normLabel ||
        normalise(e.ariaLabel ?? '') === normLabel ||
        normalise(e.href.split('?')[0].split('/').filter(Boolean).pop() ?? '') === normLabel) ??
        allLinks.find((e) => e
            .href.split('?')[0]
            .split('/')
            .filter(Boolean)
            .some((seg) => normalise(seg).includes(normLabel) || normLabel.includes(normalise(seg))));
    if (siblingLink?.href) {
        return outcomeFromHref(siblingLink.href);
    }
    // ── Button: keyword pattern matching on label ────────────────────────────
    const lower = elLabel.toLowerCase();
    if (/\b(open|show|expand|view)\b/.test(lower)) {
        return `The "${elLabel}" panel, modal, or section opens and its content is visible.`;
    }
    if (/\b(close|hide|collapse|dismiss)\b/.test(lower)) {
        return `The "${elLabel}" panel, modal, or section closes and is no longer visible.`;
    }
    if (/\b(submit|send|save|apply|confirm|create|add)\b/.test(lower)) {
        return `The action is submitted and a success confirmation or the updated state is visible.`;
    }
    if (/\b(delete|remove|clear|reset)\b/.test(lower)) {
        return `The targeted item is removed or the field is cleared and the updated state reflects the change.`;
    }
    if (/\b(search|filter|find)\b/.test(lower)) {
        return `The results area updates to reflect the search or filter criteria applied.`;
    }
    if (/\b(next|continue|proceed)\b/.test(lower)) {
        return `The flow advances to the next step or screen.`;
    }
    if (/\b(back|previous|cancel)\b/.test(lower)) {
        return `The user is returned to the previous step or the action is cancelled.`;
    }
    if (/\b(login|sign in|log in)\b/.test(lower)) {
        return `The user is authenticated and redirected to the authenticated area of the application.`;
    }
    if (/\b(logout|sign out|log out)\b/.test(lower)) {
        return `The user session is ended and the login page or public home page is displayed.`;
    }
    if (/\b(download|export)\b/.test(lower)) {
        return `A file download is triggered and the file is saved to the user's device.`;
    }
    if (/\b(upload|import)\b/.test(lower)) {
        return `The file picker or upload flow is triggered.`;
    }
    if (/\b(toggle|enable|disable|switch)\b/.test(lower)) {
        return `The "${elLabel}" state toggles and the UI reflects the new state.`;
    }
    if (/\b(chat|message|support|help)\b/.test(lower)) {
        return `The "${elLabel}" chat or support widget opens and is ready for interaction.`;
    }
    if (/\b(menu|nav|navigation)\b/.test(lower)) {
        return `The "${elLabel}" navigation menu opens and its items are visible.`;
    }
    // Proper-noun / feature-name buttons (title-case, no recognised action verb):
    // these are navigation items or feature launchers — they open a section or page.
    const isProperNoun = /^[A-Z]/.test(elLabel) && !/^(button|btn)$/i.test(elLabel);
    if (isProperNoun) {
        return `The "${elLabel}" section or feature opens and its content is visible.`;
    }
    // Default
    return `The action completes and the resulting state or screen is visible.`;
}
// ─────────────────────────────────────────────────────────────────────────────
// Flow 2 — Per-interactive-element flows (buttons & links)
// ─────────────────────────────────────────────────────────────────────────────
function buildInteractiveFlows(meta, flowIdPrefix) {
    const interactives = meta.elements.filter((e) => (isButton(e) || isLink(e)) && e.isVisible && e.isEnabled && !isSharedChrome(e));
    // Deduplicate by locatorHint
    const seen = new Set();
    const unique = interactives.filter((e) => {
        if (seen.has(e.locatorHint))
            return false;
        seen.add(e.locatorHint);
        return true;
    });
    const meaningful = unique.filter((el) => {
        if (isButton(el) && !hasMeaningfulLabel(el))
            return false;
        return true;
    });
    return meaningful.map((el, i) => {
        const elLabel = label(el);
        const displayLabel = specificElementLabel(el);
        const assertStep = deriveExpectedAssertionStep(el, elLabel, meta);
        const preconditions = detectPreconditions(meta, 'interact', el);
        const steps = [
            resolved({
                action: 'click',
                description: isLink(el)
                    ? `Click the "${displayLabel}" link`
                    : `Click the "${displayLabel}" button`,
                element: elLabel,
                page: meta.pageName,
            }, el, meta.pageName),
            resolvedNoEl(assertStep, meta.pageName),
        ];
        return {
            id: `${flowIdPrefix}.${i + 2}`,
            name: isLink(el) ? `Follow "${displayLabel}" link` : `Click "${displayLabel}"`,
            description: isLink(el)
                ? `Click the "${displayLabel}" link and verify navigation or state change.`
                : `Interact with the "${displayLabel}" button and verify the outcome.`,
            pages: [meta.pageName],
            preconditions,
            steps,
        };
    });
}
// ─────────────────────────────────────────────────────────────────────────────
// Flow 3 — Form fill flows (group inputs by proximity)
// ─────────────────────────────────────────────────────────────────────────────
function buildFormFlows(meta, flowIdBase, flowIdPrefix) {
    const allInputs = meta.elements.filter((e) => isInput(e) && e.isVisible && e.isEnabled && !isSharedChrome(e));
    // Popup comboboxes (custom MUI dropdowns) are navigation/filter controls, not form fields.
    // Generate click flows for them separately instead of wrapping them in a form-submit flow.
    const popupComboboxes = allInputs.filter(isPopupCombobox);
    const inputs = allInputs.filter((e) => !isPopupCombobox(e));
    const comboboxFlows = popupComboboxes.map((el, i) => {
        const elLabel = label(el);
        const displayLabel = specificElementLabel(el);
        const options = el.popupOptions ?? [];
        const optionsNote = options.length > 0
            ? `Available options: ${options.map((o) => `"${o}"`).join(', ')}.`
            : 'Run `npm run build-flows -- --target=<page> --force` to populate available options.';
        const preconditions = detectPreconditions(meta, 'interact', el);
        const steps = [
            resolved({ action: 'click', description: `Click the "${displayLabel}" dropdown to open it`, element: elLabel, page: meta.pageName }, el, meta.pageName),
            resolvedNoEl({
                action: 'assert',
                description: `The "${displayLabel}" options list opens and its items are visible.`,
                state: 'visible',
                notes: optionsNote,
            }, meta.pageName),
        ];
        return {
            id: `${flowIdPrefix}.${flowIdBase + i}`,
            name: `Open "${displayLabel}" dropdown`,
            description: options.length > 0
                ? `Click the "${displayLabel}" dropdown and verify the options list opens. Options: ${options.map((o) => `"${o}"`).join(', ')}.`
                : `Click the "${displayLabel}" dropdown and verify the options list opens.`,
            pages: [meta.pageName],
            preconditions,
            steps,
        };
    });
    if (inputs.length === 0)
        return comboboxFlows;
    // Group real form inputs by proximity: split on vertical gaps > 200px
    const sorted = [...inputs].sort((a, b) => (a.boundingBox?.y ?? 0) - (b.boundingBox?.y ?? 0));
    const groups = [];
    let current = [];
    for (const el of sorted) {
        if (current.length === 0) {
            current.push(el);
            continue;
        }
        const lastY = current[current.length - 1].boundingBox?.y ?? 0;
        const thisY = el.boundingBox?.y ?? 0;
        if (thisY - lastY > 200) {
            groups.push(current);
            current = [el];
        }
        else {
            current.push(el);
        }
    }
    if (current.length > 0)
        groups.push(current);
    const formIdBase = flowIdBase + comboboxFlows.length;
    const formFlows = groups.map((group, gi) => {
        const steps = group.map((el) => {
            const act = inputAction(el);
            const elLabel = label(el);
            const displayLabel = specificElementLabel(el);
            const step = act === 'fill'
                ? { action: 'fill', description: `Fill "${displayLabel}"`, element: elLabel, value: placeholderValue(el) }
                : act === 'select'
                    ? { action: 'select', description: `Select a value in "${displayLabel}"`, element: elLabel, value: 'option' }
                    : { action: 'check', description: `Toggle "${displayLabel}"`, element: elLabel };
            return resolved(step, el, meta.pageName);
        });
        const submitBtn = meta.elements.find((e) => isButton(e) &&
            e.isVisible &&
            (e.text?.toLowerCase().includes('submit') ||
                e.text?.toLowerCase().includes('save') ||
                e.text?.toLowerCase().includes('search') ||
                e.text?.toLowerCase().includes('apply') ||
                e.text?.toLowerCase().includes('send')));
        const submitLabel = submitBtn ? specificElementLabel(submitBtn) : null;
        if (submitBtn) {
            steps.push(resolved({ action: 'click', description: `Submit the form via "${submitLabel ?? label(submitBtn)}"`, element: label(submitBtn) }, submitBtn, meta.pageName));
        }
        steps.push(resolvedNoEl({
            action: 'assert',
            description: submitLabel
                ? `The form is submitted successfully via "${submitLabel}" and a confirmation message or the next screen is visible.`
                : `The form is submitted successfully and a confirmation message or the next screen is visible.`,
            state: 'visible',
            notes: 'Update this assertion to match the actual success/error state after submission.',
        }, meta.pageName));
        const formName = group.length === 1 ? `Fill "${specificElementLabel(group[0])}"` : `Fill form group ${gi + 1}`;
        const preconditions = detectPreconditions(meta, 'form', group[0]);
        return {
            id: `${flowIdPrefix}.${formIdBase + gi}`,
            name: formName,
            description: `Fill and submit the form containing: ${group.map((el) => specificElementLabel(el)).join(', ')}.`,
            pages: [meta.pageName],
            preconditions,
            steps,
        };
    });
    return [...comboboxFlows, ...formFlows];
}
// ─────────────────────────────────────────────────────────────────────────────
// Public API — single-page
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Derives a 2-letter ID prefix from the page name using the first letter of
 * each hyphen/space-separated word. Falls back to the first 2 chars.
 * Examples: "morning-update" → "MU", "homepage" → "HO", "strike-rate" → "SR"
 */
function pageIdPrefix(pageName) {
    const words = pageName.trim().split(/[-_\s]+/).filter(Boolean);
    if (words.length >= 2) {
        return (words[0][0] + words[1][0]).toUpperCase();
    }
    return (words[0] ?? 'PG').slice(0, 2).toUpperCase();
}
/**
 * Returns true when an element is part of the shared page chrome (top navigation
 * bar or left sidebar) rather than the page-specific main content area.
 *
 * Thresholds are derived from observed bounding boxes:
 *   - Left sidebar:  x < 128  (sidebar items sit at x ≈ 16–95)
 *   - Top bar:       y < 56   (top bar items sit at y ≈ 0–55)
 *
 * Elements without a bounding box are assumed to be main-content.
 */
function isSharedChrome(el) {
    const bb = el.boundingBox;
    if (!bb)
        return false;
    return bb.x < 128 || bb.y < 56;
}
// ─────────────────────────────────────────────────────────────────────────────
// Integration flows — shared chrome elements that navigate away from the page
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Builds integration flows from shared chrome elements (sidebar nav, top bar).
 * These are elements that exist on every page and navigate to other pages,
 * making them cross-page integration tests rather than page-scoped unit tests.
 *
 * ID prefix: "IN" + 1-based index, e.g. IN.1, IN.2 …
 * The prefix is scoped to this page so IDs remain unique per page output file.
 */
function buildIntegrationFlows(meta, idPrefix) {
    const chromeInteractives = meta.elements.filter((e) => (isButton(e) || isLink(e)) && e.isVisible && e.isEnabled && isSharedChrome(e));
    // Deduplicate by locatorHint
    const seen = new Set();
    const unique = chromeInteractives.filter((e) => {
        if (seen.has(e.locatorHint))
            return false;
        seen.add(e.locatorHint);
        return true;
    });
    const meaningful = unique.filter((el) => {
        if (isButton(el) && !hasMeaningfulLabel(el))
            return false;
        return true;
    });
    return meaningful.map((el, i) => {
        const elLabel = label(el);
        const displayLabel = specificElementLabel(el);
        const assertStep = deriveExpectedAssertionStep(el, elLabel, meta);
        const preconditions = detectPreconditions(meta, 'interact', el);
        const steps = [
            resolved({
                action: 'navigate',
                description: `Start on the ${meta.pageName} page`,
                path: meta.url,
            }, null, meta.pageName),
            resolved({
                action: 'click',
                description: isLink(el)
                    ? `Click the "${displayLabel}" link in the shared navigation`
                    : `Click the "${displayLabel}" button in the shared navigation`,
                element: elLabel,
                page: meta.pageName,
            }, el, meta.pageName),
            resolvedNoEl(assertStep, meta.pageName),
        ];
        return {
            id: `${idPrefix}INT.${i + 1}`,
            name: isLink(el) ? `Nav: "${displayLabel}"` : `Nav: Click "${displayLabel}"`,
            description: isLink(el)
                ? `From ${meta.pageName}, click the "${displayLabel}" navigation link and verify the destination page loads.`
                : `From ${meta.pageName}, click the "${displayLabel}" navigation button and verify the resulting state.`,
            pages: [meta.pageName],
            preconditions,
            steps,
        };
    });
}
export function generateFlows(meta) {
    const idPrefix = pageIdPrefix(meta.pageName);
    const navFlow = buildNavigationFlow(meta, idPrefix);
    const interactiveFlows = buildInteractiveFlows(meta, idPrefix);
    const formFlowBase = 2 + interactiveFlows.length;
    const formFlows = buildFormFlows(meta, formFlowBase, idPrefix);
    const integrationFlows = buildIntegrationFlows(meta, idPrefix);
    return {
        pageFlows: [navFlow, ...interactiveFlows, ...formFlows],
        integrationFlows,
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// Public API — cross-page
// ─────────────────────────────────────────────────────────────────────────────
function normalizeUrlPath(value, baseUrl) {
    if (!value)
        return null;
    try {
        const parsed = new URL(value, baseUrl);
        return parsed.pathname.replace(/\/+$/, '') || '/';
    }
    catch {
        const path = value.split(/[?#]/)[0];
        return path ? path.replace(/\/+$/, '') || '/' : null;
    }
}
function pathSegments(path) {
    return path.split('/').filter(Boolean).map(slugify);
}
function extractNavigationTargets(el) {
    const targets = [el.href, el.dataHref, el.dataUrl].filter(Boolean);
    const clickUrl = el.clickHint ? extractUrlFromClickHint(el.clickHint) : null;
    if (clickUrl)
        targets.push(clickUrl);
    return [...new Set(targets)];
}
function makeDestinationMatcher(metas) {
    return metas.map((meta) => {
        const pageSlug = slugify(meta.pageName);
        const path = normalizeUrlPath(meta.url, meta.url);
        const segments = path ? pathSegments(path) : [];
        return { meta, pageSlug, path, segments };
    });
}
function resolveDestination(src, targetUrl, destinations) {
    const targetPath = normalizeUrlPath(targetUrl, src.url);
    if (!targetPath)
        return null;
    const targetSegments = pathSegments(targetPath);
    for (const dest of destinations) {
        if (dest.meta.pageName === src.pageName)
            continue;
        if (dest.path && targetPath === dest.path)
            return dest;
        if (targetSegments.includes(dest.pageSlug))
            return dest;
        const destLast = dest.segments[dest.segments.length - 1];
        const targetLast = targetSegments[targetSegments.length - 1];
        if (destLast && targetLast && destLast === targetLast)
            return dest;
    }
    return null;
}
function makeCrossPageFlow(src, dest, navLink, flowIndex, targetUrl) {
    const srcWithAuth = src.requiresAuth || dest.requiresAuth
        ? { ...src, requiresAuth: true }
        : src;
    const preconditions = detectPreconditions(srcWithAuth, 'cross-page', navLink);
    const linkLabel = label(navLink);
    const displayLabel = specificElementLabel(navLink);
    const step1 = resolved({ action: 'navigate', description: `Go to the ${src.pageName} page`, path: src.url }, null, src.pageName);
    const step2 = resolved({
        action: 'click',
        description: `Click the "${displayLabel}" navigation link`,
        element: linkLabel,
        page: src.pageName,
    }, navLink, src.pageName);
    const step3 = resolvedNoEl({
        action: 'assert',
        description: `URL contains the ${dest.pageName} path`,
        state: 'url',
        expectedText: targetUrl ?? navLink.href ?? undefined,
    }, dest.pageName);
    const firstHeading = dest.elements.find((e) => e.category === 'heading' && e.isVisible);
    const step4 = firstHeading
        ? resolved({
            action: 'assert',
            description: `The ${dest.pageName} page heading is visible: "${firstHeading.text ?? dest.pageName}"`,
            element: firstHeading.text ?? dest.pageName,
            state: 'visible',
        }, firstHeading, dest.pageName)
        : resolvedNoEl({
            action: 'assert',
            description: `The ${dest.pageName} page heading is visible`,
            element: dest.pageName,
            state: 'visible',
            notes: `Run \`npm run extract -- --page ${slugify(dest.pageName)}\` to resolve this locator.`,
        }, dest.pageName);
    return {
        id: `XP.${flowIndex}`,
        name: `Navigate from ${src.pageName} to ${dest.pageName}`,
        description: `Click the "${displayLabel}" link on ${src.pageName} and verify navigation to ${dest.pageName}.`,
        pages: [src.pageName, dest.pageName],
        preconditions,
        steps: [step1, step2, step3, step4],
    };
}
export function buildCrossPageFlows(metas) {
    if (metas.length < 2)
        return [];
    const destinations = makeDestinationMatcher(metas);
    const flows = [];
    const seen = new Set();
    let idx = 1;
    for (const src of metas) {
        const srcSlug = slugify(src.pageName);
        const navigationElements = src.elements.filter((e) => isInteractive(e) && extractNavigationTargets(e).length > 0);
        for (const el of navigationElements) {
            const target = extractNavigationTargets(el)
                .map((targetUrl) => ({ targetUrl, dest: resolveDestination(src, targetUrl, destinations) }))
                .find((match) => match.dest);
            const dest = target?.dest;
            if (!dest)
                continue;
            const destSlug = slugify(dest.meta.pageName);
            const pairKey = `${srcSlug}→${destSlug}`;
            if (seen.has(pairKey))
                continue;
            seen.add(pairKey);
            flows.push(makeCrossPageFlow(src, dest.meta, el, idx++, target.targetUrl));
        }
    }
    return flows;
}
