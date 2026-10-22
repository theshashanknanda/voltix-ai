import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { rehypePlugins, remarkPlugins, unwrapMarkdownFence } from './markdown.ts';

const render = (text: string) =>
  renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins, rehypePlugins }, unwrapMarkdownFence(text)));

const answer = [
  '## Overview',
  '',
  '| Function | Notes |',
  '|---|---|',
  '| `load` | reads file<br>parses JSON<br/>returns `<br>` |',
  '',
  '- outer',
  '  - nested ~~old~~',
  '- [x] done',
  '',
  '```ts',
  'const a = 1;',
  '```',
  '',
  'Line one<br>line two <script>alert(1)</script>',
].join('\n');

const html = render('```markdown\n' + answer + '\n```\n');
assert.match(html, /<h2>Overview<\/h2>/);
assert.match(html, /<td>reads file<br\/>parses JSON<br\/>returns <code>&lt;br&gt;<\/code><\/td>/);
assert.match(html, /<ul>\s*<li>nested <del>old<\/del><\/li>\s*<\/ul>/);
assert.match(html, /type="checkbox"/);
assert.match(html, /<pre><code class="language-ts">const a = 1;\n<\/code><\/pre>/);
assert.match(html, /Line one<br\/>line two &lt;script&gt;/);
assert.ok(!html.includes('<script>'));

assert.equal(unwrapMarkdownFence('> Context: a.ts\n\n```md\n# Hi\n```'), '> Context: a.ts\n\n# Hi');
const example = 'Example README:\n\n```markdown\n# Hi\n```';
assert.equal(unwrapMarkdownFence(example), example);

console.log('markdown checks passed');
