import assert from 'node:assert/strict';
import { findLocalImports } from './localImports.ts';

const file = (path: string, content = '', language = 'typescript') => ({ path, name: path.split('/').pop()!, content, language });
const paths = (files: { path: string }[]) => files.map(f => f.path);

const util = file('src/util.ts');
const widgetsIndex = file('src/widgets/index.tsx');
const app = file('src/app.ts', [
  "import React from 'react';",
  "import { add } from './util';",
  "import Widgets from './widgets';",
  "const lazy = import('./util');",
].join('\n'));
assert.deepEqual(paths(findLocalImports(app, [app, util, widgetsIndex, file('src/react.ts')])), ['src/util.ts', 'src/widgets/index.tsx']);

const helpers = file('pkg/helpers.py', '', 'python');
const core = file('pkg/core/__init__.py', '', 'python');
const main = file('pkg/main.py', 'import os\nfrom .helpers import tidy\nfrom .core import run\n', 'python');
assert.deepEqual(paths(findLocalImports(main, [main, helpers, core])), ['pkg/helpers.py', 'pkg/core/__init__.py']);

const many = ['a', 'b', 'c', 'd'].map(name => file(`lib/${name}.ts`));
const index = file('lib/index.ts', many.map(f => `export * from './${f.path.slice(4, -3)}.js';`).join('\n'));
const binary = file('lib/logo.ts', '', 'binary');
assert.deepEqual(paths(findLocalImports(index, [index, binary, ...many])), ['lib/a.ts', 'lib/b.ts', 'lib/c.ts', 'lib/d.ts']);
assert.deepEqual(findLocalImports(file('lib/x.ts', "import './logo';"), [binary]), []);

console.log('localImports checks passed');
