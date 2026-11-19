import assert from 'node:assert/strict';
import { expandPathsFor } from './fileTreeExpand.ts';

assert.deepEqual(expandPathsFor('README.md'), []);
assert.deepEqual(expandPathsFor('src/app.ts'), ['src']);
assert.deepEqual(expandPathsFor('src/components/FileTree.tsx'), ['src', 'src/components']);
assert.deepEqual(expandPathsFor('a/b/c/d.ts'), ['a', 'a/b', 'a/b/c']);
assert.deepEqual(expandPathsFor(''), []);
assert.deepEqual(expandPathsFor('/src/app.ts'), ['src']);

console.log('fileTreeExpand checks passed');
