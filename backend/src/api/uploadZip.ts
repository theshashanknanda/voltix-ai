import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { unzipSync, UnzipFileInfo } from 'fflate';
import requireAuth from '../middleware/requireAuth';
import { isSecretPath } from '../secrets';
import { MAX_FILES, getLanguage, isSupportedFile } from './uploadRepo';

const router = Router();

const MAX_ZIP_BYTES = 20 * 1024 * 1024;
const MAX_ENTRY_BYTES = 1024 * 1024;

// Kept in memory only; the archive is never written to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ZIP_BYTES },
});

const escapesArchive = (name: string): boolean =>
  name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').includes('..');

const utf8 = new TextDecoder('utf-8', { fatal: true });

// Returns null for binary (NUL bytes) or non-UTF-8 content.
const decodeText = (bytes?: Uint8Array): string | null => {
  if (!bytes || bytes.includes(0)) return null;
  try {
    return utf8.decode(bytes);
  } catch {
    return null;
  }
};

/**
 * POST /api/upload-zip
 * Body: multipart/form-data with field "file" (a .zip, max 20 MB).
 * Returns the same { files, meta } shape as /api/upload-repo, with meta.name
 * (the ZIP file name) in place of owner/repo/branch.
 */
router.post('/upload-zip', requireAuth, upload.single('file'), (req: Request, res: Response): void => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded. Please upload a .zip file.' });
    return;
  }
  if (!req.file.size) {
    res.status(400).json({ error: 'Uploaded ZIP is empty.' });
    return;
  }
  const zip = req.file.buffer;

  // First pass reads only the central directory; nothing is inflated.
  const entries: UnzipFileInfo[] = [];
  try {
    unzipSync(zip, { filter: (f) => { entries.push(f); return false; } });
  } catch {
    res.status(400).json({ error: 'Uploaded file is not a valid ZIP archive.' });
    return;
  }

  const fileEntries = entries
    .map((f) => ({ ...f, path: f.name.replace(/\\/g, '/') }))
    .filter((f) => !f.path.endsWith('/') && !f.path.startsWith('__MACOSX/'));
  if (fileEntries.length === 0) {
    res.status(400).json({ error: 'The ZIP archive is empty.' });
    return;
  }
  const unsafe = fileEntries.find((f) => escapesArchive(f.path));
  if (unsafe) {
    res.status(400).json({ error: `ZIP entry "${unsafe.path}" points outside the archive.` });
    return;
  }

  const top = `${fileEntries[0].path.split('/')[0]}/`;
  if (fileEntries.every((f) => f.path.startsWith(top))) {
    fileEntries.forEach((f) => { f.path = f.path.slice(top.length); });
  }

  let skippedSecrets = 0;
  let skippedLarge = 0;
  const candidates = fileEntries
    .filter((f) => {
      if (isSecretPath(f.path)) {
        skippedSecrets++;
        return false;
      }
      if (!isSupportedFile(f.path) || (f.compression !== 0 && f.compression !== 8)) return false;
      if (f.originalSize > MAX_ENTRY_BYTES) {
        skippedLarge++;
        return false;
      }
      return true;
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const truncated = candidates.length > MAX_FILES;
  const selected = candidates.slice(0, MAX_FILES);
  const wanted = new Set(selected.map((f) => f.name));

  // ponytail: up to MAX_FILES x 1 MB is inflated in memory at once; stream with fflate's Unzip if that gets too heavy.
  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(zip, { filter: (f) => wanted.has(f.name) });
  } catch {
    res.status(400).json({ error: 'The ZIP archive could not be read.' });
    return;
  }

  const files = selected.flatMap((f) => {
    const content = decodeText(unpacked[f.name]);
    return content === null
      ? []
      : [{ path: f.path, name: path.posix.basename(f.path), content, language: getLanguage(f.path) }];
  });
  if (files.length === 0) {
    res.status(400).json({ error: 'The ZIP contains no supported text files.' });
    return;
  }

  const warnings = [
    truncated && `Archive contains ${candidates.length} supported files. Only the first ${MAX_FILES} files were imported.`,
    skippedSecrets > 0 && `Skipped ${skippedSecrets} secret file(s) (.env or private keys).`,
    skippedLarge > 0 && `Skipped ${skippedLarge} file(s) larger than 1 MB.`,
  ].filter(Boolean);

  res.json({
    files,
    meta: {
      name: req.file.originalname,
      totalFiles: candidates.length,
      returnedFiles: files.length,
      truncated,
      skippedSecrets,
      skippedLarge,
      ...(warnings.length > 0 && { warning: warnings.join(' ') }),
    },
  });
});

router.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (!(err instanceof multer.MulterError)) {
    next(err);
    return;
  }
  res.status(400).json({
    error: err.code === 'LIMIT_FILE_SIZE' ? 'ZIP file is larger than 20 MB.' : `Upload error: ${err.message}`,
  });
});

export default router;
