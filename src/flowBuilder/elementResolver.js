import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { slugify } from '../utils/fsUtils.js';
// ─────────────────────────────────────────────────────────────────────────────
// Page element cache
// ─────────────────────────────────────────────────────────────────────────────
const pageCache = new Map();
function loadPage(projectName, pageName, outputDir) {
    const key = `${projectName}::${pageName}`;
    if (pageCache.has(key))
        return pageCache.get(key);
    const filePath = join(outputDir, slugify(projectName), slugify(pageName), 'elements.json');
    if (!existsSync(filePath)) {
        return [];
    }
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    const elements = raw.elements ?? [];
    pageCache.set(key, elements);
    return elements;
}
function score(el, needle) {
    const n = needle.toLowerCase();
    // Exact matches rank highest
    if (el.dataTestId?.toLowerCase() === n)
        return 100;
    if (el.ariaLabel?.toLowerCase() === n)
        return 95;
    if (el.text?.toLowerCase() === n)
        return 90;
    if (el.placeholder?.toLowerCase() === n)
        return 85;
    if (el.name?.toLowerCase() === n)
        return 80;
    if (el.id?.toLowerCase() === n)
        return 75;
    // Partial matches
    if (el.dataTestId?.toLowerCase().includes(n))
        return 60;
    if (el.ariaLabel?.toLowerCase().includes(n))
        return 55;
    if (el.text?.toLowerCase().includes(n))
        return 50;
    if (el.placeholder?.toLowerCase().includes(n))
        return 45;
    if (el.name?.toLowerCase().includes(n))
        return 40;
    if (el.locatorHint?.toLowerCase().includes(n))
        return 30;
    return 0;
}
function bestMatch(elements, needle) {
    const candidates = elements
        .map((el) => ({ el, score: score(el, needle) }))
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score);
    return candidates[0]?.el ?? null;
}
export function resolveStep(step, opts) {
    // Steps with no element reference or explicit locator override
    if (!step.element && !step.locator) {
        return { ...step, resolvedLocator: step.locator ?? null, resolvedPage: null, confidence: null };
    }
    if (step.locator) {
        return { ...step, resolvedLocator: step.locator, resolvedPage: null, confidence: 'high' };
    }
    const needle = step.element;
    const pagesToSearch = step.page
        ? [step.page, ...opts.flowPages.filter((p) => p !== step.page)]
        : opts.flowPages;
    for (const pageName of pagesToSearch) {
        const elements = loadPage(opts.projectName, pageName, opts.outputDir);
        const match = bestMatch(elements, needle);
        if (match) {
            return {
                ...step,
                resolvedLocator: match.locatorHint,
                resolvedPage: pageName,
                confidence: match.selectorConfidence,
            };
        }
    }
    // No match found — return unresolved
    return { ...step, resolvedLocator: null, resolvedPage: null, confidence: null };
}
