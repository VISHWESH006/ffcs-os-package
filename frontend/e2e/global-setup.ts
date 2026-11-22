import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default async function globalSetup() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const results = path.join(root, 'test-results');
  await mkdir(results, { recursive: true });
  await rm(path.join(results, 'phase17-store.json'), { force: true });
}
