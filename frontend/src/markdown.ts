import type { Element, Root } from 'hast';
import remarkGfm from 'remark-gfm';

// The opening fence may follow blockquote lines because /api/explain-context prepends a "> Context" note.
const OUTER_MARKDOWN_FENCE = /^((?:>.*\n|[ \t]*\n)*)```(?:markdown|md)[ \t]*\n([\s\S]*?)\n?```$/i;
const BR = /^<br\s*\/?>$/i;

export function unwrapMarkdownFence(text: string): string {
  const match = text.trim().match(OUTER_MARKDOWN_FENCE);
  return match ? match[1] + match[2] : text;
}

// Model output is untrusted, so no rehype-raw: only exact <br> tags become elements, other HTML stays literal text.
function rehypeBreaks() {
  return function walk(node: Root | Element): void {
    node.children.forEach((child, i) => {
      if (child.type === 'raw' && BR.test(child.value.trim())) {
        node.children[i] = { type: 'element', tagName: 'br', properties: {}, children: [] };
      } else if (child.type === 'element') {
        walk(child);
      }
    });
  };
}

export const remarkPlugins = [remarkGfm];
export const rehypePlugins = [rehypeBreaks];
