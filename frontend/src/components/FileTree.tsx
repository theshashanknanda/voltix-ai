import { useState, useMemo, memo, createContext, useContext } from 'react';

interface ImportedFile {
  path: string;
  name: string;
  content: string;
  language: string;
}

interface FileTreeProps {
  files: ImportedFile[];
  selectedFilePath?: string;
  onFileSelect: (file: ImportedFile) => void;
}

interface TreeItem {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children: Record<string, TreeItem>;
  fileData?: ImportedFile;
}

const SelectionContext = createContext<{
  selectedFilePath?: string;
  onFileSelect: (file: ImportedFile) => void;
}>({ onFileSelect: () => {} });

/* ---------------- Component ---------------- */

const FileTree = memo(function FileTree({ files, selectedFilePath, onFileSelect }: FileTreeProps) {
  const treeData = useMemo(() => {
    const root: Record<string, TreeItem> = {};
    files.forEach(file => {
      const parts = file.path.split('/');
      let currentLevel = root;
      parts.forEach((part, index) => {
        const isLast = index === parts.length - 1;
        if (!currentLevel[part]) {
          currentLevel[part] = {
            name: part,
            path: parts.slice(0, index + 1).join('/'),
            type: isLast ? 'file' : 'folder',
            children: {},
            fileData: isLast ? file : undefined,
          };
        }
        currentLevel = currentLevel[part].children;
      });
    });
    return root;
  }, [files]);

  const sortedNodes = useMemo(() => {
    return Object.values(treeData).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [treeData]);

  const contextValue = useMemo(() => ({
    selectedFilePath,
    onFileSelect
  }), [selectedFilePath, onFileSelect]);

  return (
    <SelectionContext.Provider value={contextValue}>
      <div className="file-tree-container">
        {sortedNodes.map(item => (
          <TreeNode
            key={item.path}
            item={item}
            depth={0}
          />
        ))}
      </div>
    </SelectionContext.Provider>
  );
});

export default FileTree;

/* ---------------- Sub-component ---------------- */

interface TreeNodeProps {
  item: TreeItem;
  depth: number;
}

const TreeNode = memo(function TreeNode({ item, depth }: TreeNodeProps) {
  const { selectedFilePath, onFileSelect } = useContext(SelectionContext);
  const [isExpanded, setIsExpanded] = useState(depth === 0); // Root expanded, others collapsed by default
  const isSelected = item.type === 'file' && item.path === selectedFilePath;
  const hasChildren = Object.keys(item.children).length > 0;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.type === 'folder') {
      setIsExpanded(!isExpanded);
    } else if (item.fileData) {
      onFileSelect(item.fileData);
    }
  };

  const sortedChildren = useMemo(() => {
    if (!hasChildren) return [];
    return Object.values(item.children).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [item.children, hasChildren]);

  return (
    <div className="tree-node">
      <div
        className={`tree-item ${item.type} ${isSelected ? 'active' : ''}`}
        style={{ paddingLeft: `${depth * 14 + 12}px` }}
        onClick={handleToggle}
      >
        <span className="tree-icon">
          {item.type === 'folder' ? (
            <svg
              className={`chevron ${isExpanded ? 'expanded' : ''}`}
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          )}
        </span>
        <span className="tree-name">{item.name}</span>
      </div>

      {item.type === 'folder' && isExpanded && hasChildren && (
        <div className="tree-children">
          {sortedChildren.map(child => (
            <TreeNode
              key={child.path}
              item={child}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
});
