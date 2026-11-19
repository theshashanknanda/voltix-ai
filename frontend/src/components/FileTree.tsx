import { useState, useMemo, memo, createContext, useContext, useEffect } from 'react';
import { expandPathsFor } from '../fileTreeExpand';

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
  expandPaths: Set<string>;
}>({ onFileSelect: () => {}, expandPaths: new Set() });

function fileExt(name: string) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

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

  const expandPaths = useMemo(
    () => new Set(expandPathsFor(selectedFilePath ?? '')),
    [selectedFilePath],
  );

  const contextValue = useMemo(() => ({
    selectedFilePath,
    onFileSelect,
    expandPaths,
  }), [selectedFilePath, onFileSelect, expandPaths]);

  useEffect(() => {
    if (!selectedFilePath) return;
    document.querySelector('.file-tree-container .tree-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [selectedFilePath, expandPaths]);

  return (
    <SelectionContext.Provider value={contextValue}>
      <div className="file-tree-container" role="tree">
        {sortedNodes.map(item => (
          <TreeNode key={item.path} item={item} depth={0} />
        ))}
      </div>
    </SelectionContext.Provider>
  );
});

export default FileTree;

interface TreeNodeProps {
  item: TreeItem;
  depth: number;
}

const TreeNode = memo(function TreeNode({ item, depth }: TreeNodeProps) {
  const { selectedFilePath, onFileSelect, expandPaths } = useContext(SelectionContext);
  const [userExpanded, setUserExpanded] = useState(depth === 0);
  const forceOpen = item.type === 'folder' && expandPaths.has(item.path);
  const isExpanded = forceOpen || userExpanded;
  const isSelected = item.type === 'file' && item.path === selectedFilePath;
  const hasChildren = Object.keys(item.children).length > 0;
  const ext = item.type === 'file' ? fileExt(item.name) : '';

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.type === 'folder') {
      // ponytail: forceOpen wins while the active file lives under this folder;
      // toggling still updates userExpanded for when selection moves away.
      setUserExpanded(!isExpanded);
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
    <div className="tree-node" role="treeitem" aria-expanded={item.type === 'folder' ? isExpanded : undefined}>
      <div
        className={`tree-item ${item.type}${isSelected ? ' active' : ''}${ext ? ` ext-${ext}` : ''}`}
        style={{ paddingLeft: `${depth * 12 + 10}px` }}
        onClick={handleToggle}
        title={item.path}
      >
        <span className="tree-icon" aria-hidden="true">
          {item.type === 'folder' ? (
            <>
              <svg
                className={`chevron ${isExpanded ? 'expanded' : ''}`}
                viewBox="0 0 24 24"
                width="10"
                height="10"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <svg className="folder-glyph" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                {isExpanded ? (
                  <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" opacity="0.9" />
                ) : (
                  <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                )}
              </svg>
            </>
          ) : (
            <span className="file-glyph">{ext.slice(0, 2) || '·'}</span>
          )}
        </span>
        <span className="tree-name">{item.name}</span>
      </div>

      {item.type === 'folder' && isExpanded && hasChildren && (
        <div className="tree-children" role="group">
          {sortedChildren.map(child => (
            <TreeNode key={child.path} item={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
});
