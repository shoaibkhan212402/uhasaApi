import { Router } from 'express';
import multer from 'multer';
import os from 'os';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';

const router = Router();

const uploadDir = path.join(os.tmpdir(), 'uasa-admin-import');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 5 * 1024 * 1024 },
});

function sheetToRows(buffer: Buffer): Record<string, string>[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  return raw.map((row) => {
    const mapped: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      mapped[String(key).trim()] = String(value ?? '').trim();
    }
    return mapped;
  });
}

router.post('/parse', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'File is required' });
  }

  try {
    const buffer = fs.readFileSync(file.path);
    const rows = sheetToRows(buffer);
    res.json({ rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to parse spreadsheet' });
  } finally {
    fs.unlink(file.path, () => undefined);
  }
});

export default router;
