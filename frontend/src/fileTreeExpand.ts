/** Folder paths that must be expanded so `filePath` is visible in the tree. */
export function expandPathsFor(filePath: string): string[] {
  const parts = filePath.split('/').filter(Boolean);
  if (parts.length <= 1) return [];
  const folders: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    folders.push(parts.slice(0, i).join('/'));
  }
  return folders;
}
