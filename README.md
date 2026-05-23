# Playwright Build Tool Flows

> Extract page UI elements with Playwright, generate structured JSON and Markdown reports, build QA flows, create requirements docs, and scaffold runnable Playwright test projects.

This project is a Node.js tool that uses Playwright to open real web pages, inspect what is on the screen, save that information as reports, and then turn those reports into QA flows or starter Playwright test projects.

In plain English: it looks at configured pages in a browser, collects buttons, links, inputs, headings, images, tables, and other visible UI elements, then writes files that help a person or an AI understand what should be tested.

## What This Project Is For

The main goal is to help build Playwright test coverage faster.

Instead of manually opening a page and writing down every button, link, input, and selector, this tool does that first discovery step automatically. The output can then be used to:

- Review what UI elements exist on each page.
- Find good Playwright locators for those elements.
- Build manual QA flow documents.
- Generate starter Playwright tests in JavaScript or Python.
- Generate requirements documents for QA onboarding.

The public example target project is **Sample App**. Example pages are:

- `home`
- `dashboard`
- `reports`

All three configured pages require authentication.

## Big Picture Workflow

The project works in this order:

1. You define the target pages in `config/targets.js`.
2. You define how login works in `config/auth.js`.
3. You run `npm run extract`.
4. The tool logs in if needed.
5. Playwright opens each configured page in a real browser.
6. The extractor scans the DOM and collects useful UI elements.
7. The project writes JSON and Markdown reports under `Documentation/`.
8. Optional scripts analyze clicks and build flow documents.
9. Optional scripts generate a standalone Playwright project from the extracted data.

## Important Folders

### `config/`

This folder controls what the tool should scan.

- `config/targets.js` defines the project name, browser, timeout, and pages.
- `config/auth.js` defines the login flow for authenticated pages.
- `config/targets.example.js` is a safe example target config.
- `config/auth.example.js` is a safe example auth config.
- `config/flows.js` is currently intentionally empty because flows are generated from extracted data.

The non-example `config/*.js` files are treated as local/private configuration and are ignored by Git. For a fresh clone, copy the examples before running commands:

```bash
cp config/targets.example.js config/targets.js
cp config/auth.example.js config/auth.js
```

### `scripts/`

This folder contains command-line entry points. These are the files that run when you use `npm run ...`.

- `scripts/auth.js` creates or validates a saved login session.
- `scripts/extract.js` extracts page elements and writes reports.
- `scripts/analyze-clicks.js` clicks buttons and links to infer what they do.
- `scripts/build-flows.js` extracts pages, analyzes interactions, writes QA flow docs, and refreshes requirements docs.
- `scripts/create-playwright-project.js` creates a separate runnable Playwright project.
- `scripts/generate-requirements.js` regenerates requirements docs inside a generated project.
- `scripts/clean-playwright-projects.js` deletes generated Playwright projects.
- `scripts/load-env.cjs` loads values from `.env` into `process.env`.

### `src/`

This folder contains the reusable project logic.

- `src/extractor/` handles browser page extraction.
- `src/reporter/` writes JSON and Markdown reports.
- `src/flowBuilder/` turns extracted elements into QA flows.
- `src/requirements/` creates requirements documents.
- `src/utils/` contains shared file and logging helpers.

### `Documentation/`

This folder is generated when extraction runs. It is ignored by Git.

For the example project, generated documentation is written under:

```text
Documentation/sample-app/
```

Each page gets its own folder:

```text
Documentation/sample-app/home/
Documentation/sample-app/dashboard/
Documentation/sample-app/reports/
```

### `.auth/`

This folder stores the saved browser login session, usually at:

```text
.auth/state.json
```

It is ignored by Git because it may contain sensitive cookies or storage data.

### `playwright-projects/`

This folder is created only when you generate a standalone Playwright project. Generated projects can be JavaScript or Python.

## Configuration Explained

### `config/targets.js`

This file tells the extractor which pages to visit.

Example project config:

```js
const config = {
  projectName: 'Sample App',
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
      requiresAuth: true,
    },
    {
      name: 'reports',
      url: 'https://example.com/reports',
      waitUntil: 'networkidle',
      requiresAuth: true,
    },
  ],
};
```

Field meanings:

- `projectName`: Used to name the project folder inside `Documentation/`. `Sample App` becomes `sample-app`.
- `browser`: Which Playwright browser to use. Supported values are `chromium`, `firefox`, and `webkit`.
- `timeout`: Maximum time in milliseconds for navigation and waits.
- `pages`: The list of pages to scan.
- `name`: A short page name. This becomes the page folder name inside `Documentation/<project-slug>/`.
- `url`: The real URL Playwright should open.
- `waitUntil`: When Playwright should consider the page loaded. `networkidle` waits until network activity quiets down.
- `waitForSelector`: Optional extra wait. The extractor waits for this selector before scanning the page.
- `requiresAuth`: Whether the page needs the saved auth session.
- `viewport`: Optional page size, for example `{ width: 390, height: 844 }`.

### `config/auth.js`

This file tells the tool how to log in.

The actual sensitive values should come from `.env`, not from hard-coded text in the code.

Important environment variables:

```text
AUTH_USERNAME
AUTH_PASSWORD
AUTH_LOGIN_URL
AUTH_OIDC_URL_PATTERN
AUTH_STORAGE_STATE_PATH
AUTH_POST_LOGIN_URL
AUTH_LOGIN_URL_FRAGMENT
PWHEADLESS
```

What the auth script does:

1. Checks whether `.auth/state.json` already exists.
2. If it exists, opens a browser with that saved state.
3. Visits the post-login URL to see if the session is still valid.
4. If the browser is redirected to a login URL, the session is stale.
5. If the session is missing or stale, it runs the login steps in `authConfig.perform(page)`.
6. After login succeeds, it saves browser cookies and storage to `.auth/state.json`.

That saved session is reused by extraction and generated tests.

## Commands

### Install Dependencies

```bash
npm install
```

Installs the Node dependencies listed in `package.json`.

### Install Playwright Browser

```bash
npx playwright install chromium
```

Installs the Chromium browser that Playwright uses.

### Run Auth Only

```bash
npm run auth
```

Runs the login flow headlessly.

```bash
npm run auth:headed
```

Runs the login flow in a visible browser. Use this when debugging login.

### Extract All Pages

```bash
npm run extract
```

This runs auth first, then extracts all configured pages.

### Extract One Page

```bash
npm run extract -- --page homepage
```

The page filter supports partial matches. For example, `home` can match `homepage`.

### Analyze Clicks

```bash
npm run analyze-clicks -- "Sample App" dashboard
```

This reads an existing `elements.json`, opens the page, clicks visible enabled buttons and links, and tries to infer what changed.

It can detect things like:

- URL changed.
- New tab opened.
- Modal opened.
- Alert appeared.
- More elements appeared.

It writes those hints back into `elements.json`.

On later runs, unchanged elements keep their previous `clickHint` and dropdown option analysis. If every interaction on the page has already been analyzed, the script skips click analysis instead of opening extra browser sessions.

To force re-analysis of items that already have hints:

```bash
npm run analyze-clicks -- "Sample App" dashboard --force
```

### Build Flows

```bash
npm run build-flow
```

or:

```bash
npm run build-flows
```

This extracts all pages, analyzes clicks, creates flow documents under each page's documentation folder, and creates a `requirements/` folder inside each generated page folder.

If extraction produces the same elements as a previous run, existing click/dropdown analysis is preserved and skipped. Use `--force` when you intentionally want to re-run analysis for already-analyzed interactions.

Generated JSON, Markdown, requirements, and Playwright project files are written only when their content changes. Re-running the scripts with the same inputs should avoid unnecessary file churn.

```bash
npm run build-flows -- --target=homepage
```

Builds flows for one target page.

```bash
npm run build-flows:homepage
```

Shortcut for building homepage flows.

### Generate a JavaScript Playwright Project

```bash
npm run create-playwright-project -- --language=js
```

Creates a separate generated project under:

```text
playwright-projects/sample-app-js/
```

### Generate a Python Playwright Project

```bash
npm run create-playwright-project -- --language=python
```

Creates:

```text
playwright-projects/sample-app-python/
```

### Generate Requirements Only

```bash
npm run generate-requirements -- --project-dir=playwright-projects/sample-app-js
```

Rebuilds only the `requirements/` folder inside an existing generated project.

### Clean Generated Projects

```bash
npm run clean-playwright-projects -- --all
```

Deletes every generated project under `playwright-projects/`.

```bash
npm run clean-playwright-projects -- --project=sample-app-js
```

Deletes one exact generated project folder.

```bash
npm run clean-playwright-projects -- --language=js
```

Deletes all generated JavaScript projects.

### Clean Extracted Output

```bash
npm run clean
```

Deletes the `Documentation/` folder.

## What Extraction Produces

After `npm run extract`, each successful page gets:

```text
elements.json
summary.md
```

The project also gets:

```text
index.json
```

Example layout:

```text
Documentation/
└── sample-app/
    ├── index.json
    ├── home/
    │   ├── elements.json
    │   └── summary.md
    ├── dashboard/
    │   ├── elements.json
    │   └── summary.md
    └── reports/
        ├── elements.json
        └── summary.md
```

### `elements.json`

This is the machine-readable file. It contains all extracted element data.

Each element can include:

- `category`
- `tag`
- `role`
- `text`
- `ownText`
- `id`
- `name`
- `placeholder`
- `ariaLabel`
- `ariaLabelledBy`
- `ariaDescribedBy`
- `ariaExpanded`
- `ariaSelected`
- `ariaChecked`
- `dataTestId`
- `type`
- `href`
- `src`
- `alt`
- `value`
- `onclick`
- `dataHref`
- `dataUrl`
- `dataAction`
- `formAction`
- `ariaControls`
- `ariaHasPopup`
- `headingLevel`
- `nthIndex`
- `isVisible`
- `isEnabled`
- `locatorHint`
- `cssSelector`
- `locatorOptions`
- `clickHint`
- `selectorConfidence`
- `boundingBox`

The most important fields for testing are usually:

- `locatorHint`: The best Playwright locator the tool could generate.
- `selectorConfidence`: How stable the locator probably is.
- `text`, `ariaLabel`, `dataTestId`, `id`: Useful labels or identifiers.
- `isVisible` and `isEnabled`: Whether the element can currently be used.
- `clickHint`: What the tool thinks happens when the element is clicked.

### `summary.md`

This is the human-readable report. It contains:

- Page URL.
- Page title.
- Extraction time.
- Total element count.
- Count by category.
- Tables for buttons, links, inputs, headings, images, tables, lists, forms, and more.
- Locator options and confidence ratings.

### Locator Confidence

The project rates generated selectors like this:

- `High`: Usually stable. Based on `data-testid`, `aria-label`, unique ID, or strong role/name information.
- `Medium`: Useful, but may depend on visible text or less stable attributes.
- `Low`: Fragile. Usually a CSS fallback based on DOM structure.

High-confidence locators are best for tests.

## What Elements Are Collected

The extractor does more than collect only buttons and inputs. It classifies many categories:

- `button`
- `link`
- `input`
- `heading`
- `text`
- `image`
- `media`
- `landmark`
- `dialog`
- `table`
- `list`
- `form`
- `interactive`
- `widget`
- `labelled`

It skips things that are not useful as test targets, such as:

- `<script>`
- `<style>`
- `<template>`
- `<meta>`
- hidden inputs
- elements hidden from the accessibility tree
- pure layout containers with no meaningful text or attributes

It also attempts to scan:

- Normal DOM content.
- Shadow DOM content.
- Same-origin iframe content.

Cross-origin iframes are skipped because the browser does not allow direct access to their documents.

## How Selectors Are Built

The selector builder tries multiple locator strategies and keeps a list of options.

It prefers stable selectors first:

1. `data-testid`
2. `id`
3. heading role and text
4. `aria-label`
5. native select attributes
6. input `name`
7. placeholder
8. accessible role and visible text
9. alt text for images
10. exact text
11. visible text
12. `src`
13. `aria-labelledby`
14. CSS fallback

The first option becomes `locatorHint`.

Example:

```js
page.getByTestId('form-submit')
```

or:

```js
page.getByRole('button', { name: 'Submit', exact: false })
```

## Flow Generation

Flow generation turns extracted UI elements into QA-style steps.

When you run:

```bash
npm run build-flow
```

or:

```bash
npm run build-flows
```

The project creates flow docs under:

```text
Documentation/sample-app/<page>/flows/
```

It also creates requirements docs under:

```text
Documentation/sample-app/<page>/requirements/
```

It can create:

- Page navigation flows.
- Button click flows.
- Link navigation flows.
- Form fill flows.
- Dropdown opening flows.
- Shared navigation integration flows.
- Cross-page integration flows.

### Page Flows

Every page gets a navigation flow that opens the page and verifies key visible headings or landmarks.

### Interactive Flows

Visible enabled buttons and links become individual flows.

The tool tries to describe the expected result using:

- `href`
- `onclick`
- `aria-controls`
- `aria-haspopup`
- click analysis hints
- label keywords like `save`, `search`, `delete`, `open`, `close`, `download`, `login`, or `logout`

### Form Flows

Visible enabled inputs are grouped by vertical position on the screen. Inputs close together become one form group.

The tool chooses example values:

- Email inputs get `user@example.com`.
- Telephone inputs get `555-000-0000`.
- Number inputs get `100`.
- Date inputs get `2024-01-01`.
- Other text inputs get `example value`.

If it finds a submit, save, search, apply, or send button, it adds a click step for that button.

### Shared Chrome Integration Flows

The flow builder treats elements near the left edge or top of the page as shared navigation chrome.

Current heuristic:

- Left sidebar: `x < 128`
- Top bar: `y < 56`

Those elements are put into integration flows because they usually navigate away from the current page.

### Cross-Page Flows

If multiple pages have been extracted, the tool looks for navigation from one extracted page to another. It checks link `href` values, `data-href`, `data-url`, and navigation URLs inferred from `clickHint`, then compares those destinations with the extracted page URLs and page slugs.

When you build flows for one target page, the tool also loads other already-extracted page folders from `Documentation/<project-slug>/` so cross-page flows can still be generated when enough page data exists.

If it finds a matching destination page, it creates a cross-page flow that:

1. Opens the source page.
2. Clicks the navigation link.
3. Checks that the URL changes.
4. Checks that the destination page heading is visible if available.

## Generated Playwright Projects

The project can create a separate test project based on `config/targets.js` and the extracted data.

JavaScript output includes:

- `package.json`
- `playwright.config.js`
- `tests/*.spec.js`
- `README.md`
- `.gitignore`
- `requirements/`

Python output includes:

- `requirements.txt`
- `pytest.ini`
- `tests/test_*.py`
- `tests/conftest.py`
- `README.md`
- `.gitignore`
- `requirements/`

Generated tests include:

- Smoke tests for every configured page.
- Flow-based tests when extracted elements exist.
- Cross-page tests when cross-page links are detected.
- Auth state reuse when any configured page requires auth.

If no extracted data exists yet, the generator still creates smoke tests from the configured URLs.

## Requirements Generation

The requirements generator reads each page's `summary.md` and creates QA documentation.

Requirements are created in two places:

- `npm run build-flow` or `npm run build-flows` creates `requirements/` inside each generated page folder under `Documentation/<project-slug>/<page>/`.
- `npm run create-playwright-project -- --language=js|python` creates `requirements/` inside the generated Playwright project.

You can also regenerate only the QA documentation folders for an existing generated project:

```bash
npm run generate-requirements -- --project-dir=playwright-projects/sample-app-js
```

The generated requirements folder includes:

```text
requirements/
├── 00_Onboarding_QA/
│   ├── 00_Project_About.md
│   ├── 01_<inferred_feature>.md
│   ├── 02_<inferred_feature>.md
│   └── ...
└── 01_Requirements/
    ├── 01_home.md
    ├── 01_dashboard.md
    └── 01_reports.md
```

The feature onboarding files are created only when visible page information supports them, such as forms, search fields, tables, media, dialogs, navigation links, and action buttons. Stale onboarding files that no longer match the page are removed on the next requirements run.

Each feature file reads like normal QA notes: documentation safety, purpose, feature area, page evidence, primary controls or surfaces, and QA notes. Onboarding docs avoid assuming authentication, roles, permissions, backend APIs, data models, or business rules unless those details are visible on the page.

The page requirement docs include:

- Page overview.
- UI structure.
- Important flows.
- Field definitions.
- Business rules.
- Permissions.
- States and transitions.
- Edge cases.
- Out-of-scope notes.

If a page has no `summary.md`, the generator creates a placeholder requirements file instead of failing.

## Source File Details

### `src/extractor/pageRunner.js`

This file controls browser execution.

It:

- Launches Chromium, Firefox, or WebKit.
- Checks whether authentication is needed.
- Validates or creates auth state.
- Creates browser contexts with the correct viewport.
- Opens each configured page.
- Waits for page load and optional selectors.
- Calls `extractElements(page)`.
- Builds per-page stats.
- Returns extraction results.

### `src/extractor/elementExtractor.js`

This file runs code inside the browser page.

It:

- Walks through every DOM element.
- Determines visibility.
- Determines enabled state.
- Resolves ARIA roles.
- Classifies elements into categories.
- Reads useful attributes.
- Captures bounding boxes.
- Captures ancestor paths.
- Walks shadow roots.
- Walks same-origin iframes.
- Sends raw results to the selector builder.

### `src/extractor/selectorBuilder.js`

This file turns raw DOM data into useful Playwright locators.

It:

- Generates locator options.
- Chooses the best locator.
- Assigns confidence.
- Builds fallback CSS selectors.
- Adds basic action hints from `href`, `onclick`, `aria-controls`, `aria-haspopup`, and form attributes.

### `src/reporter/jsonReporter.js`

This writes `elements.json` for each page.

### `src/reporter/markdownReporter.js`

This writes `summary.md` for each page.

It creates tables for every category and includes locator confidence explanations.

### `src/flowBuilder/flowGenerator.js`

This creates QA flows from extracted elements.

It:

- Loads `elements.json`.
- Builds navigation flows.
- Builds button and link flows.
- Builds form flows.
- Builds dropdown flows.
- Builds shared navigation integration flows.
- Builds cross-page flows.
- Adds preconditions based on auth, page URL, search fields, filters, data tables, and form context.

### `src/flowBuilder/elementResolver.js`

This resolves human-readable step names to actual extracted locators.

It scores possible matches by:

- `data-testid`
- `aria-label`
- visible text
- placeholder
- name
- id
- locator hint

### `src/flowBuilder/markdownFlowRenderer.js`

This writes flow Markdown files.

Each flow document has:

- A Manual QA section.
- A Technical section with locators.
- Preconditions.
- Actions.
- Expected result.
- Locator confidence.
- Unresolved element warnings.

### `src/requirements/requirementsGenerator.js`

This reads generated `summary.md` reports and creates QA requirements docs.

It parses Markdown tables, extracts useful counts and examples, and writes onboarding and page-level requirement files.

### `src/utils/fsUtils.js`

This contains shared file helpers:

- `slugify(value)` converts names like `Sample App` into `sample-app`.
- `writeJson(filePath, data)` writes pretty JSON and creates folders if needed.
- `writeText(filePath, content)` writes text files and creates folders if needed.

### `src/utils/logger.js`

This contains a small timestamped logger for info, success, warning, and error messages.

## Environment Files

### `.env.example`

This is the template showing which environment variables are needed.

### `.env`

This is the real local environment file. It is ignored by Git and should contain real credentials and URLs.

Do not commit `.env`.

## Git Ignore Behavior

The `.gitignore` ignores generated or sensitive files such as:

- `node_modules/`
- `Documentation/`
- `.env`
- `.env.local`
- `.auth/`
- Playwright reports
- test results
- cache folders

This is important because extracted reports, auth state, and credentials should not be committed accidentally.

## Typical Beginner Workflow

Use this when starting fresh:

```bash
npm install
npx playwright install chromium
```

Create or update `.env` from `.env.example`.

Create local config files from the safe examples:

```bash
cp config/targets.example.js config/targets.js
cp config/auth.example.js config/auth.js
```

Then run:

```bash
npm run auth:headed
```

Use headed mode first so you can see whether login works.

After auth succeeds:

```bash
npm run extract
```

Review:

```text
Documentation/sample-app/<page>/summary.md
```

Then build flows:

```bash
npm run build-flow
```

Review:

```text
Documentation/sample-app/<page>/flows/index.md
Documentation/sample-app/<page>/requirements/
```

Finally, generate a runnable Playwright project:

```bash
npm run create-playwright-project -- --language=js
```

## Things To Know Before Editing

- Add or remove pages in `config/targets.js`.
- Change login behavior in `config/auth.js`.
- Do not put real credentials directly in committed code.
- Re-run extraction after changing target pages.
- Re-run flow generation after extraction if you want updated flows.
- Re-run generated project creation if you want tests refreshed from the latest extracted data.
- Re-running scripts with unchanged inputs preserves existing files and skips unchanged writes where possible.
- Low-confidence locators are a sign that the app may need better `data-testid` or accessibility labels.

## Common Problems

### Auth Fails

Check:

- `.env` exists.
- `AUTH_USERNAME` is set.
- `AUTH_PASSWORD` is set.
- `AUTH_LOGIN_URL` is correct.
- `AUTH_OIDC_URL_PATTERN` matches the identity provider redirect.
- The selectors in `config/auth.js` still match the login page.

Run:

```bash
npm run auth:headed
```

### Extraction Finds Too Few Elements

Check:

- The page URL is correct.
- Auth state is valid.
- `waitUntil` is appropriate.
- `waitForSelector` is present for slow pages.
- The page content is inside a cross-origin iframe, which cannot be scanned directly.

### Locators Are Low Confidence

The page probably lacks stable attributes. Prefer adding:

- `data-testid`
- meaningful `aria-label`
- accessible roles and names
- stable input labels

### Generated Tests Are Only Smoke Tests

That means the generator did not find extracted `elements.json` for that page.

Run extraction first:

```bash
npm run extract
```

Then generate the project again.

## One-Sentence Summary

This project is a Playwright-powered discovery and generation tool: it logs into configured web pages, extracts their UI structure, writes JSON and Markdown reports, turns those reports into QA flows and requirements, and can generate starter Playwright test projects from the discovered page data.

## Using Output for AI Test Generation

The `elements.json` files are structured as prompt-ready payloads.

Example prompt:

```text
Given this elements.json for the Login page, generate Playwright test cases
covering: form validation, happy path login, and error handling.
Use the locatorHint field directly for all selectors.

[paste elements.json content here]
```

The `locatorHint` values are valid Playwright code, so an AI tool does not need to guess selectors.

## Known Limitations

- Shadow DOM content is scanned by the current extractor, but complex closed shadow roots still cannot be inspected from normal page JavaScript.
- Same-origin iframes are scanned, but cross-origin iframes are not accessible because browsers block direct DOM access across origins.
- Some sites block headless Chromium or automation-like behavior.
- Single-page apps may need `waitUntil: 'networkidle'` or a page-specific `waitForSelector` before extraction.
- Low-confidence CSS fallback locators can break if the page layout or class names change.

## License

MIT
