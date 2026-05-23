import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { slugify } from '../src/utils/fsUtils.js';
import { logger } from '../src/utils/logger.js';
const AUTH_STORAGE_STATE = process.env['AUTH_STORAGE_STATE_PATH'] ?? '.auth/state.json';
async function analyzeButtonClick(pageUrl, button) {
    const browser = await chromium.launch({ headless: true });
    const storageState = existsSync(AUTH_STORAGE_STATE) ? AUTH_STORAGE_STATE : undefined;
    const context = await browser.newContext(storageState ? { storageState } : {});
    const page = await context.newPage();
    try {
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        // Record initial state
        const initialUrl = page.url();
        const initialElements = await page.locator('*').count();
        // Set up alert listener
        let alertTriggered = false;
        page.on('dialog', () => { alertTriggered = true; });
        // Set up new page listener for links that open in new tabs
        let newPageUrl = null;
        context.on('page', async (newPage) => {
            try {
                await newPage.waitForLoadState('domcontentloaded', { timeout: 5000 });
                newPageUrl = newPage.url();
            }
            catch (error) {
                // Ignore timeout errors for new pages
            }
        });
        // Click the button/link
        const locator = page.locator(button.cssSelector);
        await locator.waitFor({ state: 'visible', timeout: 5000 });
        await locator.click({ timeout: 5000 });
        // Wait a bit for changes
        await page.waitForTimeout(2000);
        const finalUrl = page.url();
        const finalElements = await page.locator('*').count();
        // Check for modal (common patterns)
        const modalSelectors = [
            '[role="dialog"]',
            '.modal',
            '.popup',
            '[aria-modal="true"]',
            '.MuiDialog-root', // Material-UI
            '.ant-modal', // Ant Design
        ];
        let modalOpened = false;
        for (const selector of modalSelectors) {
            if (await page.locator(selector).count() > 0) {
                modalOpened = true;
                break;
            }
        }
        return {
            urlChanged: finalUrl !== initialUrl ? finalUrl : undefined,
            newTabOpened: newPageUrl || undefined,
            newElements: finalElements > initialElements ? [`${finalElements - initialElements} new elements appeared`] : undefined,
            alertTriggered,
            modalOpened,
        };
    }
    catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
    finally {
        await browser.close();
    }
}
function generateClickHint(outcome) {
    if (outcome.error)
        return null;
    if (outcome.newTabOpened)
        return `opens ${outcome.newTabOpened} in a new tab`;
    if (outcome.urlChanged)
        return `navigates to ${outcome.urlChanged}`;
    if (outcome.modalOpened)
        return 'opens a modal or dialog';
    if (outcome.alertTriggered)
        return 'triggers an alert or confirmation';
    if (outcome.newElements)
        return 'reveals additional content or elements';
    return 'triggers a UI interaction';
}
async function readPopupOptions(pageUrl, element) {
    const browser = await chromium.launch({ headless: true });
    const storageState = existsSync(AUTH_STORAGE_STATE) ? AUTH_STORAGE_STATE : undefined;
    const context = await browser.newContext(storageState ? { storageState } : {});
    const page = await context.newPage();
    try {
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        const locator = page.locator(element.cssSelector);
        await locator.waitFor({ state: 'visible', timeout: 5000 });
        await locator.click({ timeout: 5000 });
        await page.waitForTimeout(800);
        // MUI listbox options appear as li[role=option] inside a ul[role=listbox]
        const optionTexts = await page.locator('[role="listbox"] [role="option"]').allInnerTexts();
        if (optionTexts.length > 0)
            return optionTexts.map((t) => t.trim()).filter(Boolean);
        // Fallback: any visible [role=option] that appeared after click
        const fallback = await page.locator('[role="option"]').allInnerTexts();
        return fallback.map((t) => t.trim()).filter(Boolean);
    }
    catch {
        return [];
    }
    finally {
        await browser.close();
    }
}
function parseForceFlag() {
    return process.argv.includes('--force');
}
function writeJsonIfChanged(filePath, data) {
    const content = JSON.stringify(data, null, 2);
    if (existsSync(filePath) && readFileSync(filePath, 'utf-8') === content) {
        logger.success('Analysis output is unchanged — skipping elements.json write.');
        return false;
    }
    writeFileSync(filePath, content);
    return true;
}
async function analyzeClicks(projectName, pageName, outputDir) {
    const force = parseForceFlag();
    const elementsPath = join(outputDir, slugify(projectName), slugify(pageName), 'elements.json');
    const data = JSON.parse(readFileSync(elementsPath, 'utf-8'));
    logger.info(`Analyzing clicks for ${data.pageName} (${data.elements.length} elements)${force ? ' [--force]' : ''}`);
    const buttons = data.elements.filter(el => el.category === 'button' && el.isVisible && el.isEnabled);
    const links = data.elements.filter(el => el.category === 'link' && el.isVisible && el.isEnabled && el.href);
    const allInteractives = [...buttons, ...links];
    // Skip elements that already have a clickHint unless --force is passed
    const toAnalyze = force
        ? allInteractives
        : allInteractives.filter(el => !el.clickHint);
    const skipped = allInteractives.length - toAnalyze.length;
    if (skipped > 0) {
        logger.info(`  Skipping ${skipped} already-analyzed element(s) (pass --force to re-analyze all)`);
    }
    if (toAnalyze.length > 0) {
        logger.info(`  Analyzing ${toAnalyze.length} element(s) in parallel...`);
        // Run all browser sessions concurrently
        await Promise.all(toAnalyze.map(async (element) => {
            const label = element.text || element.ariaLabel || element.alt || 'unnamed';
            const outcome = await analyzeButtonClick(data.url, element);
            const hint = generateClickHint(outcome);
            if (hint && hint !== element.clickHint) {
                logger.info(`  [${element.category}] "${label}" → ${hint}`);
                element.clickHint = hint;
            }
            else {
                logger.info(`  [${element.category}] "${label}" → no change`);
            }
        }));
    }
    // Read options for popup comboboxes (MUI dropdowns with ariaHasPopup=listbox)
    const popupComboboxes = data.elements.filter((el) => el.category === 'input' &&
        el.role === 'combobox' &&
        el.tag !== 'select' &&
        (el.ariaHasPopup === 'listbox' || el.ariaHasPopup === 'true' || el.ariaHasPopup === 'dialog') &&
        el.isVisible &&
        el.isEnabled);
    const comboboxesToScan = force
        ? popupComboboxes
        : popupComboboxes.filter((el) => !el.popupOptions || el.popupOptions.length === 0);
    if (!force && toAnalyze.length === 0 && comboboxesToScan.length === 0) {
        logger.success('No new interactions need analysis — skipping click analysis.');
        return;
    }
    if (comboboxesToScan.length > 0) {
        logger.info(`  Reading options for ${comboboxesToScan.length} popup combobox(es)...`);
        for (const el of comboboxesToScan) {
            const elLabel = el.text || el.ariaLabel || el.placeholder || 'unnamed';
            const options = await readPopupOptions(data.url, el);
            if (options.length > 0) {
                logger.info(`  [combobox] "${elLabel}" → ${options.length} option(s): ${options.slice(0, 5).join(', ')}${options.length > 5 ? '…' : ''}`);
                el.popupOptions = options;
            }
            else {
                logger.info(`  [combobox] "${elLabel}" → no options found`);
            }
        }
    }
    // Write back the updated elements only when the analysis changed.
    if (writeJsonIfChanged(elementsPath, data)) {
        logger.success(`Updated elements.json with click analysis results`);
    }
}
function parseArgs() {
    const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
    const projectName = positional[0];
    const pageName = positional[1];
    const outputDir = positional[2] || 'Documentation';
    if (!projectName || !pageName) {
        console.error('Usage: node scripts/analyze-clicks.js <projectName> <pageName> [outputDir]');
        process.exit(1);
    }
    return { projectName, pageName, outputDir };
}
async function main() {
    const { projectName, pageName, outputDir } = parseArgs();
    await analyzeClicks(projectName, pageName, outputDir);
}
main().catch(console.error);
