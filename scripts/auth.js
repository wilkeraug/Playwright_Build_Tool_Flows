/**
 * Standalone auth script — run this before extract to ensure a valid session.
 *
 * Behaviour:
 *   1. If no state file exists → run full login flow, save state.
 *   2. If state file exists → open a context with the saved state, navigate to
 *      the post-login URL, and check whether the session is still valid.
 *      If invalid (redirected to login) → re-run login and overwrite state.
 *   3. Exit 0 on success, exit 1 on failure.
 *
 * Usage:
 *   npm run auth          # headed=false (default)
 *   npm run auth:headed   # headed=true (useful for debugging login flow)
 */
import { chromium } from 'playwright';
import { existsSync } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { dirname } from 'path';
import authConfig from '../config/auth.js';
import { logger } from '../src/utils/logger.js';
const POST_LOGIN_URL = process.env['AUTH_POST_LOGIN_URL'] ?? authConfig.postLoginUrl;
/** URL fragment that indicates we're on a login/auth page (i.e. session is invalid) */
const LOGIN_URL_FRAGMENT = process.env['AUTH_LOGIN_URL_FRAGMENT'] ?? '/login';
async function isSessionValid(statePath) {
    logger.info('Validating existing session...');
    const browser = await chromium.launch({ headless: process.env['PWHEADLESS'] !== 'false' });
    const context = await browser.newContext({ storageState: statePath });
    const page = await context.newPage();
    try {
        await page.goto(POST_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
        // Allow redirects to settle
        await page.waitForTimeout(2000);
        const currentUrl = page.url();
        const valid = !currentUrl.includes(LOGIN_URL_FRAGMENT);
        logger.info(`Session check — landed on: ${currentUrl}`);
        return valid;
    }
    catch {
        return false;
    }
    finally {
        await context.close();
        await browser.close();
    }
}
async function runLogin() {
    logger.info('Running login flow...');
    await mkdir(dirname(authConfig.storageStatePath), { recursive: true });
    const browser = await chromium.launch({ headless: process.env['PWHEADLESS'] !== 'false' });
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
        await page.goto(authConfig.loginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await authConfig.perform(page);
        await context.storageState({ path: authConfig.storageStatePath });
        logger.success(`Session saved → ${authConfig.storageStatePath}`);
    }
    finally {
        await context.close();
        await browser.close();
    }
}
async function main() {
    logger.info('=== Playwright Auth ===');
    if (!POST_LOGIN_URL) {
        logger.error('AUTH_POST_LOGIN_URL is not set — check your .env file');
        process.exit(1);
    }
    if (!authConfig.loginUrl) {
        logger.error('AUTH_LOGIN_URL is not set — check your .env file');
        process.exit(1);
    }
    if (!process.env['AUTH_USERNAME'] || !process.env['AUTH_PASSWORD']) {
        logger.error('AUTH_USERNAME or AUTH_PASSWORD is not set — check your .env file');
        process.exit(1);
    }
    const stateExists = existsSync(authConfig.storageStatePath);
    if (stateExists) {
        const valid = await isSessionValid(authConfig.storageStatePath);
        if (valid) {
            logger.success('Existing session is valid — no login needed.');
            return;
        }
        logger.warn('Session is stale or expired — removing and re-authenticating...');
        await rm(authConfig.storageStatePath);
    }
    await runLogin();
    logger.success('Auth complete.');
}
main().catch((err) => {
    logger.error('Auth script failed', err);
    process.exit(1);
});
