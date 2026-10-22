import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { rehypePlugins, remarkPlugins, unwrapMarkdownFence } from '../markdown';

const components: Components = {
  pre({ children }) {
    if (!isValidElement<{ className?: string; children?: ReactNode }>(children)) return <pre>{children}</pre>;
    const language = /language-([\w+#-]+)/.exec(children.props.className ?? '')?.[1] ?? 'text';
    return (
      <SyntaxHighlighter language={language} style={oneDark} customStyle={{ margin: '0 0 12px', borderRadius: 8, fontSize: '0.8rem' }}>
        {String(children.props.children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    );
  },
};

export default function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
      {unwrapMarkdownFence(children)}
    </ReactMarkdown>
  );
}
