import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('root index references only deployed JavaScript chunks', async () => {
  const html = await readFile(path.join(repositoryRoot, 'index.html'), 'utf8');
  const references = [...html.matchAll(
    /(?:src|href)=["']\/?(_next\/static\/chunks\/[^"'?#]+\.js)(?:[?#][^"']*)?["']/g,
  )].map(match => match[1]);
  const uniqueReferences = [...new Set(references)];

  assert.ok(uniqueReferences.length > 0, 'Expected root index.html to reference JavaScript chunks');

  const missing = [];
  for (const reference of uniqueReferences) {
    try {
      await access(path.join(repositoryRoot, ...reference.split('/')));
    } catch {
      missing.push(reference);
    }
  }

  assert.deepEqual(missing, [], `Missing JavaScript chunks referenced by root index.html:\n${missing.join('\n')}`);
});
