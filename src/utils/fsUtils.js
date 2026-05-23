import { existsSync, readFileSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
export function slugify(value) {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
export async function writeJson(filePath, data) {
    const content = JSON.stringify(data, null, 2);
    await mkdir(dirname(filePath), { recursive: true });
    if (existsSync(filePath) && readFileSync(filePath, 'utf-8') === content)
        return false;
    await writeFile(filePath, content, 'utf-8');
    return true;
}
export async function writeText(filePath, content) {
    await mkdir(dirname(filePath), { recursive: true });
    if (existsSync(filePath) && readFileSync(filePath, 'utf-8') === content)
        return false;
    await writeFile(filePath, content, 'utf-8');
    return true;
}
