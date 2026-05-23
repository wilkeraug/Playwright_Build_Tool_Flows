import { execSync } from 'child_process';
import { readdirSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import targetsConfig from '../config/targets.js';
import { loadPageElements, generateFlows, buildCrossPageFlows } from '../src/flowBuilder/flowGenerator.js';
import { writeFlowsIndex, writeIntegrationIndex, writeCrossPageFlowsIndex } from '../src/flowBuilder/markdownFlowRenderer.js';
import { generateRequirementsTree } from '../src/requirements/requirementsGenerator.js';
import { slugify } from '../src/utils/fsUtils.js';
import { logger } from '../src/utils/logger.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
// ─────────────────────────────────────────────────────────────────────────────
// CLI helpers
// ─────────────────────────────────────────────────────────────────────────────
/** Returns the target page name from --target=<name> or shorthand --<name>. */
function parseTargetFlag() {
    for (const arg of process.argv.slice(2)) {
        if (arg.startsWith('--target=')) {
            return arg.slice('--target='.length) || null;
        }
        if (arg.startsWith('--') && !arg.includes('=') && arg.length > 2) {
            return arg.slice(2);
        }
    }
    return null;
}
function runExtractAll() {
    logger.info('Running extraction for all configured pages');
    execSync('npm run extract', { stdio: 'inherit' });
}
function runExtractForTarget(target) {
    logger.info(`Running extraction for target page: "${target}"`);
    execSync(`npm run extract -- --page ${target}`, { stdio: 'inherit' });
}
function parseForceFlag() {
    return process.argv.includes('--force');
}
function runAnalyzeClicksForTarget(projectName, target) {
    logger.info(`Running click analysis for target page: "${target}"`);
    const force = parseForceFlag() ? ' --force' : '';
    execSync(`npm run analyze-clicks -- "${projectName}" ${target}${force}`, { stdio: 'inherit' });
}
/** Resolve which page names to build. Falls back to all extracted pages when no flag given. */
function resolveTargets(target, projectSlug, outputDir) {
    if (target) {
        return [target];
    }
    // No flag — discover all pages that have an elements.json
    const projectDir = join(outputDir, projectSlug);
    if (!existsSync(projectDir)) {
        throw new Error(`No extracted output found at "${projectDir}". Run npm run extract first.`);
    }
    const pages = readdirSync(projectDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(projectDir, d.name, 'elements.json')))
        .map((d) => d.name);
    if (pages.length === 0) {
        throw new Error(`No extracted pages found under "${projectDir}". Run npm run extract first.`);
    }
    return pages;
}
function discoverExtractedPages(projectSlug, outputDir) {
    const projectDir = join(outputDir, projectSlug);
    if (!existsSync(projectDir)) {
        return [];
    }
    return readdirSync(projectDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(projectDir, d.name, 'elements.json')))
        .map((d) => d.name);
}
function loadMetaWithConfig(projectName, pageName, outputDir) {
    const pageTarget = targetsConfig.pages.find((p) => slugify(p.name) === slugify(pageName));
    const meta = loadPageElements(projectName, pageName, outputDir);
    meta.requiresAuth = pageTarget?.requiresAuth ?? false;
    return { meta, pageTarget };
}
// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
    const target = parseTargetFlag();
    const outputDir = 'Documentation';
    const { projectName } = targetsConfig;
    const projectSlug = slugify(projectName);
    logger.info(`Building flows for project: ${projectName}`);
    if (target) {
        logger.info(`Target page: "${target}" (--target=${target})`);
        runExtractForTarget(target);
        runAnalyzeClicksForTarget(projectName, target);
    }
    else {
        logger.info('No --target specified — extracting all pages before building flows');
        runExtractAll();
    }
    const pages = resolveTargets(target, projectSlug, outputDir);
    if (!target) {
        for (const pageName of pages) {
            runAnalyzeClicksForTarget(projectName, pageName);
        }
    }
    let totalFlows = 0;
    let totalSteps = 0;
    const writtenFiles = [];
    const allMetas = [];
    for (const pageName of pages) {
        logger.info(`\nProcessing page: ${pageName}`);
        const { meta } = loadMetaWithConfig(projectName, pageName, outputDir);
        allMetas.push(meta);
        const { pageFlows, integrationFlows } = generateFlows(meta);
        const indexPath = await writeFlowsIndex(pageFlows, projectName, pageName, outputDir);
        writtenFiles.push(indexPath);
        logger.info(`  wrote ${indexPath} (${pageFlows.length} page flows)`);
        if (integrationFlows.length > 0) {
            const intPath = await writeIntegrationIndex(integrationFlows, projectName, pageName, outputDir);
            writtenFiles.push(intPath);
            logger.info(`  wrote ${intPath} (${integrationFlows.length} integration flows)`);
        }
        totalFlows += pageFlows.length + integrationFlows.length;
        totalSteps += [...pageFlows, ...integrationFlows].reduce((n, f) => n + f.steps.length, 0);
    }
    const crossPageMetas = [...allMetas];
    for (const pageName of discoverExtractedPages(projectSlug, outputDir)) {
        if (crossPageMetas.some((meta) => slugify(meta.pageName) === slugify(pageName)))
            continue;
        crossPageMetas.push(loadMetaWithConfig(projectName, pageName, outputDir).meta);
    }
    if (crossPageMetas.length >= 2) {
        logger.info('\nBuilding cross-page flows...');
        const crossFlows = buildCrossPageFlows(crossPageMetas);
        if (crossFlows.length > 0) {
            const crossPath = await writeCrossPageFlowsIndex(crossFlows, projectName, outputDir);
            writtenFiles.push(crossPath);
            logger.info(`  wrote ${crossPath}`);
            totalFlows += crossFlows.length;
            totalSteps += crossFlows.reduce((n, f) => n + f.steps.length, 0);
        }
        else {
            logger.info('  no cross-page links found between loaded pages — skipping');
        }
    }
    else {
        logger.info('\nSkipping cross-page flows (fewer than 2 pages extracted)');
    }
    const requirementDirs = [];
    for (const pageName of pages) {
        const pageTarget = targetsConfig.pages.find((p) => slugify(p.name) === slugify(pageName));
        if (!pageTarget) {
            logger.warn(`Skipping requirements for unknown page folder: ${pageName}`);
            continue;
        }
        const requirementsResult = await generateRequirementsTree({
            repoRoot,
            projectDir: join(repoRoot, outputDir, projectSlug, slugify(pageTarget.name)),
            outputDir,
            projectName,
            pages: [pageTarget],
            projectSlug,
        });
        requirementDirs.push(requirementsResult.requirementsDir);
        logger.info(`Generated requirements folders at ${requirementsResult.requirementsDir}`);
    }
    console.log('\n' + '='.repeat(60));
    console.log(`  Flow build complete — ${projectName}`);
    console.log('='.repeat(60));
    console.log(`  Pages processed: ${pages.join(', ')}`);
    console.log(`  Flows built    : ${totalFlows}`);
    console.log(`  Total steps    : ${totalSteps}`);
    console.log(`  Documentation  : Documentation/${projectSlug}/<page>/flows/`);
    console.log(`  Requirements   : Documentation/${projectSlug}/<page>/requirements/{00_Onboarding_QA,01_Requirements}/`);
    console.log('='.repeat(60) + '\n');
}
main().catch((err) => {
    logger.error('Flow build failed', err);
    process.exit(1);
});
