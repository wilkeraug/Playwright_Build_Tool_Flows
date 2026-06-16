# Playwright Build Tool Flows

Extract visible UI elements from real web pages with Playwright, then turn them into JSON reports, Markdown summaries, QA flow documents, requirements notes, and starter Playwright test projects.

In plain English: this tool opens the pages you configure, looks for useful things like buttons, links, inputs, headings, images, forms, tables, and dialogs, then writes documentation that helps you understand what should be tested.

## Who This Is For

Use this project when you want to:

- Discover what is on a page before writing Playwright tests.
- Find useful locator ideas such as `getByRole`, `getByTestId`, labels, placeholders, and CSS fallbacks.
- Create human-readable QA notes from live pages.
- Generate starter Playwright test projects in JavaScript or Python.
- Speed up test planning for authenticated apps.

## What You Need First

- Node.js 18 or newer.
- npm.
- Access to the website you want to scan.
- Login credentials if any configured page requires authentication.

Check your Node version:

```bash
node --version
```

## Quick Start

From a fresh clone, run these steps in order.

### 1. Install Dependencies

```bash
npm install
```

### 2. Install the Playwright Browser

```bash
npx playwright install chromium
```

The example config uses Chromium. If you later switch `browser` to `firefox` or `webkit`, install that browser too.

### 3. Create Local Config Files

The real config files are intentionally not committed because they can contain private app URLs and login selectors.

Copy the examples:

```bash
cp config/targets.example.js config/targets.js
cp config/auth.example.js config/auth.js
cp .env.example .env
```

### 4. Edit Your Settings

Open these files and replace the example values with your app details:

- `config/targets.js`: project name, pages to scan, browser, page load waits.
- `config/auth.js`: the login steps Playwright should perform.
- `.env`: credentials, login URL, session validation URL, and auth state path.

At minimum, update:

```text
AUTH_USERNAME=your-username-or-email
AUTH_PASSWORD=your-password
AUTH_LOGIN_URL=https://your-app.com/login
AUTH_POST_LOGIN_URL=https://your-app.com/a-page-that-requires-login
```

Do not commit `.env`. It is for your machine only.

### 5. Test Login in a Visible Browser

```bash
npm run auth:headed
```

Use headed mode the first time so you can watch the browser and confirm the login selectors are correct.

If login works, the tool saves a reusable browser session at:

```text
.auth/state.json
```

### 6. Extract Page Elements

```bash
npm run extract
```

This runs auth first, opens each configured page, extracts useful UI elements, and writes reports under:

```text
Documentation/<your-project-slug>/
```

Example output:

```text
Documentation/
└── my-project/
    ├── index.json
    ├── home/
    │   ├── elements.json
    │   └── summary.md
    └── dashboard/
        ├── elements.json
        └── summary.md
```

Start by reading the generated `summary.md` files.

## Common Commands

### Authenticate Only

```bash
npm run auth
```

Runs the login flow headlessly.

```bash
npm run auth:headed
```

Runs login in a visible browser. Best for debugging.

### Extract All Pages

```bash
npm run extract
```

Runs auth, then extracts every page in `config/targets.js`.

### Extract One Page

```bash
npm run extract -- --page dashboard
```

The page filter supports partial matches. For example, `dash` can match `dashboard`.

### Extract in a Visible Browser

```bash
npm run extract:headed
```

Useful when you want to see what Playwright is doing.

### Analyze Clicks

```bash
npm run analyze-clicks -- "My Project" dashboard
```

Reads an existing `elements.json`, opens the page, clicks visible enabled buttons and links, and tries to infer what changed.

It can detect:

- URL changes.
- New tabs.
- Modals.
- Alerts.
- Newly visible elements.

Force re-analysis:

```bash
npm run analyze-clicks -- "My Project" dashboard --force
```

### Build QA Flows

```bash
npm run build-flows
```

This extracts pages, analyzes clicks, writes flow documents, and refreshes requirements docs.

Build flows for one page:

```bash
npm run build-flows -- --target=dashboard
```

There is also an alias:

```bash
npm run build-flow
```

### Generate a JavaScript Playwright Project

```bash
npm run create-playwright-project -- --language=js
```

Creates:

```text
playwright-projects/<your-project-slug>-js/
```

### Generate a Python Playwright Project

```bash
npm run create-playwright-project -- --language=python
```

Creates:

```text
playwright-projects/<your-project-slug>-python/
```

### Generate Requirements Only

```bash
npm run generate-requirements -- --project-dir=playwright-projects/<your-project-slug>-js
```

### Clean Generated Output

Delete extracted documentation:

```bash
npm run clean
```

Delete generated Playwright projects:

```bash
npm run clean-playwright-projects -- --all
```

Delete one generated project:

```bash
npm run clean-playwright-projects -- --project=my-project-js
```

## Configuring Pages

Edit `config/targets.js`.

Example:

```js
const config = {
  projectName: 'My Project',
  browser: 'chromium',
  timeout: 30000,
  pages: [
    {
      name: 'home',
      url: 'https://example.com',
      waitUntil: 'domcontentloaded',
    },
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
    {
      name: 'mobile-home',
      url: 'https://example.com',
      waitUntil: 'domcontentloaded',
      viewport: { width: 390, height: 844 },
    },
  ],
};

export default config;
```

Important fields:

- `projectName`: Used for output folder names. `My Project` becomes `my-project`.
- `browser`: `chromium`, `firefox`, or `webkit`.
- `timeout`: Maximum navigation and wait time in milliseconds.
- `pages`: The pages to scan.
- `name`: Short page name used in output folders.
- `url`: The page URL.
- `waitUntil`: Usually `domcontentloaded` or `networkidle`.
- `waitForSelector`: Optional selector to wait for before extraction starts.
- `waitForSelectorState`: Optional Playwright selector state, usually `visible` or `attached`. Defaults to `visible`.
- `waitForSelectorTimeout`: Optional selector wait timeout in milliseconds. Defaults to the global `timeout`.
- `waitForSelectorOptional`: Set to `true` when the selector is helpful but should not fail extraction if it is missing.
- `requiresAuth`: Set to `true` for pages that need the saved login session.
- `viewport`: Optional browser size for that page.

## Configuring Login

Edit `config/auth.js`.

This file tells Playwright how to log in. The exact selectors depend on your app, so the example is meant to be changed.

The auth script:

1. Checks whether `.auth/state.json` already exists.
2. Opens a browser with that saved state.
3. Visits `AUTH_POST_LOGIN_URL` to see if the session is still valid.
4. Re-runs login if the session is missing or expired.
5. Saves cookies and browser storage back to `.auth/state.json`.

Useful environment variables:

```text
AUTH_USERNAME
AUTH_PASSWORD
AUTH_LOGIN_URL
AUTH_POST_LOGIN_URL
AUTH_LOGIN_URL_FRAGMENT
AUTH_OIDC_URL_PATTERN
AUTH_STORAGE_STATE_PATH
PWHEADLESS
```

For a simple login form, your `perform(page)` function may look like this:

```js
async perform(page) {
  const username = process.env['AUTH_USERNAME'] ?? '';
  const password = process.env['AUTH_PASSWORD'] ?? '';

  await page.fill('[name="email"]', username);
  await page.fill('[name="password"]', password);
  await page.click('[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 30000 });
}
```

## What Gets Generated

### Extraction Reports

Each extracted page gets:

```text
elements.json
summary.md
```

The project also gets:

```text
index.json
```

### `elements.json`

This is the machine-readable report. It includes extracted element data such as:

- category, tag, role, text, labels, and attributes.
- `locatorHint`, the best Playwright locator the tool found.
- `locatorOptions`, alternate locators.
- `selectorConfidence`, rated as `High`, `Medium`, or `Low`.
- visibility and enabled state.
- click hints when click analysis has run.
- bounding boxes.

### `summary.md`

This is the beginner-friendly human report. It includes:

- Page URL and title.
- Extraction time.
- Total element count.
- Counts by category.
- Tables for buttons, links, inputs, headings, images, tables, lists, forms, and more.
- Locator suggestions and confidence ratings.

### Flow Docs

When you run `npm run build-flows`, flow docs are written under:

```text
Documentation/<your-project-slug>/<page>/flows/
```

They can include:

- Page navigation flows.
- Button click flows.
- Link navigation flows.
- Form fill flows.
- Dropdown flows.
- Shared navigation flows.
- Cross-page flows.

### Requirements Docs

Requirements docs are written under:

```text
Documentation/<your-project-slug>/<page>/requirements/
```

They are meant for QA onboarding and test planning. They summarize visible page structure, likely features, important flows, fields, states, edge cases, and out-of-scope notes.

### Generated Playwright Projects

Generated JavaScript and Python projects can include:

- Smoke tests for configured pages.
- Flow-based tests when extracted elements exist.
- Cross-page tests when matching links are detected.
- Auth state reuse for authenticated pages.
- Requirements documentation.

## What Elements Are Collected

The extractor looks for useful UI and test targets, including:

- Buttons.
- Links.
- Inputs.
- Headings.
- Text.
- Images and media.
- Landmarks.
- Dialogs.
- Tables.
- Lists.
- Forms.
- Interactive widgets.

It skips things that usually are not useful as test targets, such as scripts, styles, templates, meta tags, hidden inputs, inaccessible elements, and layout-only containers.

It also attempts to scan:

- Normal DOM content.
- Shadow DOM content.
- Same-origin iframe content.

Cross-origin iframes are skipped because browsers do not allow direct access to their documents.

## How Locator Confidence Works

The tool prefers stable locators first:

1. `data-testid`
2. unique `id`
3. heading role and text
4. `aria-label`
5. native select attributes
6. input `name`
7. placeholder
8. accessible role and visible text
9. image alt text
10. exact text
11. visible text
12. `src`
13. `aria-labelledby`
14. CSS fallback

Confidence levels:

- `High`: Usually stable, often based on test IDs, labels, IDs, or strong role/name data.
- `Medium`: Useful, but may depend on visible text or less stable attributes.
- `Low`: Fragile fallback, often based on DOM structure.

Prefer high-confidence locators when writing tests.

## Project Structure

```text
config/
  targets.example.js
  auth.example.js
scripts/
  auth.js
  extract.js
  analyze-clicks.js
  build-flows.js
  create-playwright-project.js
  generate-requirements.js
  clean-playwright-projects.js
src/
  extractor/
  reporter/
  flowBuilder/
  requirements/
  utils/
Documentation/
  generated after extraction
.auth/
  generated after successful login
playwright-projects/
  generated test projects
```

Generated and sensitive folders are ignored by Git.

## Troubleshooting

### `Cannot find module '../config/targets.js'`

Create local config files:

```bash
cp config/targets.example.js config/targets.js
cp config/auth.example.js config/auth.js
```

### Login Fails

Run auth in a visible browser:

```bash
npm run auth:headed
```

Then check:

- `.env` has the correct username, password, login URL, and post-login URL.
- `config/auth.js` uses selectors that match your actual login page.
- `AUTH_LOGIN_URL_FRAGMENT` matches a URL fragment that appears when the session is expired.
- OIDC or multi-step login waits use the correct URL pattern.

### Extraction Times Out

Try one or more of these:

- Increase `timeout` in `config/targets.js`.
- Change `waitUntil` from `networkidle` to `domcontentloaded`.
- Add or fix `waitForSelector`.
- For slow or conditional embeds, set `waitForSelectorState: 'attached'`, `waitForSelectorTimeout`, and `waitForSelectorOptional: true`.
- Run `npm run extract:headed` to watch the page load.

### No Elements Are Found

Check whether:

- The page requires auth but `requiresAuth` is missing.
- Login failed and the browser is actually on a login page.
- The page content loads after a selector you should wait for.
- The app is inside a cross-origin iframe.

### Old Login Session Is Stuck

Delete the saved state and run auth again:

```bash
rm .auth/state.json
npm run auth:headed
```

### Generated Project Has Only Smoke Tests

Run extraction first:

```bash
npm run extract
```

Then generate the project again:

```bash
npm run create-playwright-project -- --language=js
```

## Safety Notes

- Do not commit `.env`.
- Do not commit `.auth/state.json`.
- Review generated reports before sharing them because they may contain page text, URLs, labels, or other product details.
- Use a test account when possible.
