type SourceFile = { path: string; content: string; language: string };

const JS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function joinPath(dir: string, relative: string): string {
  const parts = dir ? dir.split('/') : [];
  for (const part of relative.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function jsCandidates(file: SourceFile, files: SourceFile[]): SourceFile[] {
  const byPath = new Map(files.map(f => [f.path, f]));
  const found: SourceFile[] = [];
  for (const match of file.content.matchAll(/\b(?:from|import|require)\s*\(?\s*['"]([^'"\n]+)['"]/g)) {
    if (!match[1].startsWith('.')) continue;
    const base = joinPath(dirname(file.path), match[1]);
    const paths = [
      base,
      ...JS_EXTENSIONS.map(ext => base + ext),
      ...JS_EXTENSIONS.map(ext => `${base}/index${ext}`),
      ...(base.endsWith('.js') ? [base.slice(0, -3) + '.ts', base.slice(0, -3) + '.tsx'] : []),
    ];
    const hit = paths.map(p => byPath.get(p)).find(Boolean);
    if (hit) found.push(hit);
  }
  return found;
}

function pythonCandidates(file: SourceFile, files: SourceFile[]): SourceFile[] {
  const found: SourceFile[] = [];
  const pattern = /^[ \t]*(?:from[ \t]+(\.*[\w.]*)[ \t]+import\b|import[ \t]+([\w.]+))/gm;
  for (const match of file.content.matchAll(pattern)) {
    const spec = match[1] ?? match[2];
    const dots = spec.match(/^\.*/)![0].length;
    const rest = spec.slice(dots).split('.').filter(Boolean).join('/');
    const suffixes = rest ? [`${rest}.py`, `${rest}/__init__.py`] : ['__init__.py'];
    if (dots) {
      const dir = joinPath(dirname(file.path), '../'.repeat(dots - 1));
      const paths = suffixes.map(s => joinPath(dir, s));
      found.push(...files.filter(f => paths.includes(f.path)));
    } else {
      found.push(...files.filter(f => suffixes.some(s => f.path === s || f.path.endsWith(`/${s}`))));
    }
  }
  return found;
}

function javaCandidates(file: SourceFile, files: SourceFile[]): SourceFile[] {
  return [...file.content.matchAll(/^[ \t]*import[ \t]+([\w.]+)[ \t]*;/gm)].flatMap(m => {
    const suffix = `${m[1].replace(/\./g, '/')}.java`;
    return files.filter(f => f.path === suffix || f.path.endsWith(`/${suffix}`));
  });
}

function goCandidates(file: SourceFile, files: SourceFile[]): SourceFile[] {
  const pattern = /^[ \t]*import[ \t]*(?:\(([^)]*)\)|(?:[\w.]+[ \t]+)?"([^"]+)")/gm;
  const importPaths = [...file.content.matchAll(pattern)].flatMap(m =>
    m[1] === undefined ? [m[2]] : [...m[1].matchAll(/"([^"]+)"/g)].map(q => q[1]));
  return importPaths.flatMap(importPath => files.filter(f => {
    const dir = dirname(f.path);
    return f.path.endsWith('.go') && dir !== '' && (importPath === dir || importPath.endsWith(`/${dir}`));
  }));
}

// ponytail: regex scan of import lines, not a module resolver. Path aliases (`@/x`),
// tsconfig paths, Python `from . import name` and Go modules rooted at the repo top
// are missed; a real resolver per language would fix that.
export function findLocalImports<T extends SourceFile>(file: T, files: T[]): T[] {
  const ext = file.path.slice(file.path.lastIndexOf('.')).toLowerCase();
  const scan = ext === '.py' ? pythonCandidates : ext === '.java' ? javaCandidates : ext === '.go' ? goCandidates : jsCandidates;
  const seen = new Set([file.path]);
  return (scan(file, files) as T[]).filter(f => {
    if (seen.has(f.path) || f.language === 'binary') return false;
    seen.add(f.path);
    return true;
  });
}
