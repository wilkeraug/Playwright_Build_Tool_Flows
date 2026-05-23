import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { writeJson, slugify } from '../utils/fsUtils.js';

const ANALYSIS_FIELDS = ['clickHint', 'popupOptions'];

function elementFingerprint(element) {
    const stableFields = {
        category: element.category,
        tag: element.tag,
        role: element.role,
        text: element.text,
        ownText: element.ownText,
        id: element.id,
        name: element.name,
        placeholder: element.placeholder,
        ariaLabel: element.ariaLabel,
        ariaLabelledBy: element.ariaLabelledBy,
        ariaDescribedBy: element.ariaDescribedBy,
        dataTestId: element.dataTestId,
        type: element.type,
        href: element.href,
        src: element.src,
        alt: element.alt,
        formAction: element.formAction,
        ariaControls: element.ariaControls,
        ariaHasPopup: element.ariaHasPopup,
        locatorHint: element.locatorHint,
        cssSelector: element.cssSelector,
        selectorConfidence: element.selectorConfidence,
        isVisible: element.isVisible,
        isEnabled: element.isEnabled,
    };
    return JSON.stringify(stableFields);
}

function buildPreviousElementMap(elements) {
    const map = new Map();
    for (const element of elements ?? []) {
        const key = elementFingerprint(element);
        const list = map.get(key) ?? [];
        list.push(element);
        map.set(key, list);
    }
    return map;
}

function mergePreviousAnalysis(result, filePath) {
    if (!existsSync(filePath))
        return result;
    const previous = JSON.parse(readFileSync(filePath, 'utf-8'));
    const previousByFingerprint = buildPreviousElementMap(previous.elements);
    const elements = result.elements.map((element) => {
        const matches = previousByFingerprint.get(elementFingerprint(element));
        const previousElement = matches?.shift();
        if (!previousElement)
            return element;
        const merged = { ...element };
        for (const field of ANALYSIS_FIELDS) {
            if (previousElement[field] != null) {
                merged[field] = previousElement[field];
            }
        }
        return merged;
    });
    return { ...result, elements };
}

export async function writePageJson(result, projectName, outputDir = 'Documentation') {
    const filePath = join(outputDir, slugify(projectName), slugify(result.pageName), 'elements.json');
    await writeJson(filePath, mergePreviousAnalysis(result, filePath));
    return filePath;
}
