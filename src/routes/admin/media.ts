import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { insert, pool, query, queryOne } from '../../db/pool.js';
import { cleanupTempFile, deleteFromFtp, detectFileType, resolveMediaUrl, uploadToFtp } from '../../services/ftpService.js';
import { config } from '../../config.js';

const router = Router();

const uploadDir = path.join(os.tmpdir(), 'uasa-uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 100 * 1024 * 1024 },
});

router.get('/', async (req, res) => {
  try {
    const { file_type, folder } = req.query;
    let sql = `SELECT * FROM media_files WHERE 1=1`;
    const params: unknown[] = [];

    if (file_type) {
      sql += ` AND file_type = ?`;
      params.push(file_type);
    }
    if (folder) {
      sql += ` AND folder = ?`;
      params.push(folder);
    }

    sql += ` ORDER BY created_at DESC`;
    const files = await query<{ url: string }>(sql, params);
    res.json(
      files.map((f) => ({
        ...f,
        url: resolveMediaUrl(f.url),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch media' });
  }
});

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const folder = (req.body.folder as string) || 'uploads';

  try {
    const { filename, url, remotePath } = await uploadToFtp(
      req.file.path,
      req.file.originalname,
      folder
    );

    const fileType = detectFileType(req.file.mimetype, req.file.originalname);
    const id = await insert(
      `INSERT INTO media_files (filename, original_name, file_type, mime_type, file_size, url, folder, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        filename,
        req.file.originalname,
        fileType,
        req.file.mimetype,
        req.file.size,
        url,
        folder,
        req.user?.id || null,
      ]
    );

    res.status(201).json({
      id,
      filename,
      url,
      file_type: fileType,
      remote_path: remotePath,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Upload failed' });
  } finally {
    cleanupTempFile(req.file.path);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const file = await queryOne<{ url: string; folder: string; filename: string }>(
      `SELECT url, folder, filename FROM media_files WHERE id = ?`,
      [id]
    );
    if (!file) return res.status(404).json({ error: 'Not found' });

    const remotePath = `${config.ftp.basePath}/${file.folder}/${file.filename}`.replace(/\/+/g, '/');
    try {
      await deleteFromFtp(remotePath);
    } catch {
      // FTP delete may fail if file already removed
    }

    await pool.execute(`DELETE FROM media_files WHERE id = ?`, [id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete media' });
  }
});

export default router;
