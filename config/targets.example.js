// Run all pages:       npm run extract
// Run a single page:   npm run extract -- --page dashboard
// Partial name match:  npm run extract -- --page dash
const config = {
    projectName: 'My Project',
    browser: 'chromium', // 'chromium' | 'firefox' | 'webkit'
    timeout: 30000,
    pages: [
        // Public page — no auth required
        {
            name: 'home',
            url: 'https://example.com',
            waitUntil: 'domcontentloaded',
        },
        // Authenticated page — auth script runs first, session loaded from AUTH_STORAGE_STATE_PATH
        {
            name: 'dashboard',
            url: 'https://example.com/dashboard',
            waitUntil: 'networkidle',
            waitForSelector: '[data-testid="dashboard-loaded"]',
            waitForSelectorState: 'visible',
            waitForSelectorTimeout: 10000,
            waitForSelectorOptional: false,
            requiresAuth: true,
        },
        // Custom viewport
        {
            name: 'mobile-home',
            url: 'https://example.com',
            waitUntil: 'domcontentloaded',
            viewport: { width: 390, height: 844 },
        },
    ],
};
export default config;
