import { join } from 'path';
import config from '../config/targets.js';
import authConfig from '../config/auth.js';
import { runAll } from '../src/extractor/pageRunner.js';
import { writePageJson } from '../src/reporter/jsonReporter.js';
import { writePageMarkdown } from '../src/reporter/markdownReporter.js';
import { writeJson, slugify } from '../src/utils/fsUtils.js';
import { logger } from '../src/utils/logger.js';
function parsePageFilter() {
    const idx = process.argv.indexOf('--page');
    return idx !== -1 ? (process.argv[idx + 1] ?? null) : null;
}
function filterPages(filter) {
    if (!filter)
        return config.pages;
    const needle = filter.toLowerCase();
    const matches = config.pages.filter((p) => p.name.toLowerCase().includes(needle));
    if (!matches.length) {
        const names = config.pages.map((p) => p.name).join(', ');
        throw new Error(`No page matches "--page ${filter}". Available: ${names}`);
    }
    return matches;
}
function validate(pages) {
    if (!config.projectName?.trim())
        throw new Error('config.projectName is required');
    if (!pages.length)
        throw new Error('config.pages must have at least one entry');
    for (const p of pages) {
        if (!p.name?.trim())
            throw new Error('Every page must have a name');
        try {
            new URL(p.url);
        }
        catch {
            throw new Error(`Invalid URL for page "${p.name}": ${p.url}`);
        }
    }
}
async function main() {
    const pageFilter = parsePageFilter();
    const pages = filterPages(pageFilter);
    logger.info(`Starting extraction for project: ${config.projectName}`);
    if (pageFilter)
        logger.info(`Page filter: "${pageFilter}" → ${pages.map((p) => p.name).join(', ')}`);
    validate(pages);
    const needsAuth = pages.some((p) => p.requiresAuth);
    const auth = needsAuth ? authConfig : null;
    const OUTPUT_DIR = 'Documentation';
    const { browser, results } = await runAll({ ...config, pages }, auth);
    const successfulPages = [];
    let failed = 0;
    for (const { result, target } of results) {
        if (!result) {
            failed++;
            continue;
        }
        await writePageJson(result, config.projectName, OUTPUT_DIR);
        await writePageMarkdown(result, config.projectName, OUTPUT_DIR);
        successfulPages.push(result);
    }
    const projectResult = {
        projectName: config.projectName,
        extractedAt: new Date().toISOString(),
        totalPages: successfulPages.length,
        pages: successfulPages,
    };
    const indexPath = join(OUTPUT_DIR, slugify(config.projectName), 'index.json');
    await writeJson(indexPath, projectResult);
    await browser.close();
    console.log('\n' + '='.repeat(60));
    console.log(`  Extraction complete — ${config.projectName}`);
    console.log('='.repeat(60));
    console.log(`  Pages processed : ${results.length}`);
    console.log(`  Succeeded       : ${successfulPages.length}`);
    console.log(`  Failed          : ${failed}`);
    console.log(`  Output          : ${join(OUTPUT_DIR, slugify(config.projectName))}/`);
    console.log('='.repeat(60) + '\n');
    if (failed > 0)
        process.exit(1);
}
main().catch((err) => {
    logger.error('Extraction failed with an unhandled error', err);
    process.exit(1);
});
