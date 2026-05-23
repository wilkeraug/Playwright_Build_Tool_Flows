// Session management env vars (set in .env):
//   AUTH_LOGIN_URL            — URL of the login page
//   AUTH_USERNAME             — login username / email
//   AUTH_PASSWORD             — login password
//   AUTH_STORAGE_STATE_PATH   — where to persist cookies/localStorage (default: .auth/state.json)
//   AUTH_POST_LOGIN_URL       — URL to check for session validation (should require auth)
//   AUTH_LOGIN_URL_FRAGMENT   — fragment that indicates you're on the login page (default: /login)
//   AUTH_OIDC_URL_PATTERN     — glob pattern for OIDC redirect URL (if applicable)
//
// The auth script (npm run auth) will:
//   1. If no session file → run perform() and save state
//   2. If session file exists and valid → skip login
//   3. If session file exists but expired → re-run perform() and overwrite state
//
// npm run auth          — run auth only
// npm run extract       — runs auth first, then extracts all pages
// npm run extract -- --page dashboard  — runs auth first, then extracts one page
// Example A: single-step login (email + password on one page)
// const authConfig = {
//   loginUrl: process.env['AUTH_LOGIN_URL'] ?? '',
//   storageStatePath: process.env['AUTH_STORAGE_STATE_PATH'] ?? '.auth/state.json',
//   postLoginUrl: process.env['AUTH_POST_LOGIN_URL'] ?? '',
//
//   async perform(page) {
//     const username = process.env['AUTH_USERNAME'] ?? '';
//     const password = process.env['AUTH_PASSWORD'] ?? '';
//
//     await page.fill('[name="email"]', username);
//     await page.fill('[name="password"]', password);
//     await page.click('[type="submit"]');
//     await page.waitForURL('**/dashboard', { timeout: 30000 });
//   },
// };
// Example B: two-step login with OIDC redirect
// Step 1 — enter username on the primary login page, click Continue
// Step 2 — redirected to OIDC provider; email is pre-filled, only enter password
// Step 3 — OIDC redirects back to the app
const authConfig = {
    loginUrl: process.env['AUTH_LOGIN_URL'] ?? '',
    storageStatePath: process.env['AUTH_STORAGE_STATE_PATH'] ?? '.auth/state.json',
    postLoginUrl: process.env['AUTH_POST_LOGIN_URL'] ?? '',
    async perform(page) {
        const username = process.env['AUTH_USERNAME'] ?? '';
        const password = process.env['AUTH_PASSWORD'] ?? '';
        // Step 1: primary login page
        await page.fill('#ContentPlaceholder1_UsernameEmail', username);
        await page.click('#ContentPlaceholder1_BtnContinueSignIn');
        // Step 2: OIDC provider — email is pre-filled, only enter password
        const oidcPattern = process.env['AUTH_OIDC_URL_PATTERN'] ?? '**/login-idp**';
        await page.waitForURL(oidcPattern, { timeout: 15000 });
        await page.waitForSelector('[name="username"]', { state: 'visible', timeout: 10000 });
        await page.fill('[name="password"]', password);
        await page.locator('button[type="submit"]').first().click();
        // Step 3: wait for redirect back to the app
        await page.waitForURL('**/members/**', { timeout: 30000 });
    },
};
export default authConfig;
