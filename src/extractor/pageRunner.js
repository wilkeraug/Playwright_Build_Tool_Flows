import { chromium, firefox, webkit } from 'playwright';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { extractElements } from './elementExtractor.js';
import { logger } from '../utils/logger.js';
async function launchBrowser(config) {
    const headless = process.env['PWHEADLESS'] !== 'false';
    const launcher = config.browser === 'firefox' ? firefox : config.browser === 'webkit' ? webkit : chromium;
    return launcher.launch({ headless });
}
async function isSessionValid(browser, authConfig) {
    const context = await browser.newContext({ storageState: authConfig.storageStatePath });
    const page = await context.newPage();
    try {
        await page.goto(authConfig.postLoginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(2000);
        const loginFragment = authConfig.loginUrlFragment ?? '/login';
        return !page.url().includes(loginFragment);
    }
    catch {
        return false;
    }
    finally {
        await context.close();
    }
}
async function ensureAuth(browser, authConfig) {
    const stateExists = existsSync(authConfig.storageStatePath);
    if (stateExists) {
        logger.info('Auth state found — validating session...');
        const valid = await isSessionValid(browser, authConfig);
        if (valid) {
            logger.success('Session is valid — skipping login.');
            return;
        }
        logger.warn('Session expired — re-authenticating...');
    }
    else {
        logger.info('Auth state not found — running login flow...');
    }
    await mkdir(dirname(authConfig.storageStatePath), { recursive: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(authConfig.loginUrl);
    await authConfig.perform(page);
    await context.storageState({ path: authConfig.storageStatePath });
    await context.close();
    logger.success(`Auth state saved to ${authConfig.storageStatePath}`);
}
async function createContext(browser, target, authConfig) {
    const viewport = target.viewport ?? { width: 1280, height: 720 };
    const storageState = target.requiresAuth && authConfig ? authConfig.storageStatePath : undefined;
    return browser.newContext({
        viewport,
        ...(storageState ? { storageState } : {}),
    });
}
export async function runExtraction(config, target, authConfig, browser) {
    const timeout = config.timeout ?? 30000;
    const context = await createContext(browser, target, authConfig);
    const page = await context.newPage();
    try {
        await page.goto(target.url, {
            waitUntil: target.waitUntil ?? 'domcontentloaded',
            timeout,
        });
        if (target.waitForSelector) {
            await page.waitForSelector(target.waitForSelector, { timeout });
        }
        // Allow SPA frameworks time to settle after navigation events fire
        await page.waitForTimeout(4000);
        const elements = await extractElements(page);
        const pageTitle = await page.title();
        const count = (cat) => elements.filter((e) => e.category === cat).length;
        const stats = {
            buttons: count('button'),
            links: count('link'),
            inputs: count('input'),
            headings: count('heading'),
            texts: count('text'),
            images: count('image'),
            media: count('media'),
            landmarks: count('landmark'),
            dialogs: count('dialog'),
            tables: count('table'),
            lists: count('list'),
            forms: count('form'),
            interactive: count('interactive'),
            widgets: count('widget'),
            labelled: count('labelled'),
        };
        return {
            url: target.url,
            pageName: target.name,
            pageTitle,
            extractedAt: new Date().toISOString(),
            totalElements: elements.length,
            elements,
            stats,
        };
    }
    finally {
        await context.close();
    }
}
export async function runAll(config, authConfig) {
    const browser = await launchBrowser(config);
    const requiresAuth = config.pages.some((p) => p.requiresAuth);
    if (requiresAuth && authConfig) {
        await ensureAuth(browser, authConfig);
    }
    const results = [];
    for (const target of config.pages) {
        try {
            logger.info(`Extracting: ${target.name} — ${target.url}`);
            const result = await runExtraction(config, target, authConfig, browser);
            results.push({ result, target });
            logger.success(`Done: ${target.name} — ${result.totalElements} elements`);
        }
        catch (err) {
            logger.error(`Failed: ${target.name}`, err);
            results.push({ result: null, target });
        }
    }
    return { browser, results };
}
