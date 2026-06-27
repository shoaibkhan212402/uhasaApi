import { Client } from 'basic-ftp';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export type FileCategory = 'image' | 'video' | 'pdf' | 'document' | 'other';

export function detectFileType(mimeType: string, filename: string): FileCategory {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType === 'application/pdf') return 'pdf';
  const ext = path.extname(filename).toLowerCase();
  if (['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv'].includes(ext)) return 'document';
  return 'other';
}

function generateFilename(originalName: string): string {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext).replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 50);
  return `${Date.now()}-${base}${ext}`;
}

export function buildPublicUrl(folder: string, filename: string): string {
  const publicBase = config.ftp.publicUrl.replace(/\/$/, '');
  return `${publicBase}/${folder}/${filename}`;
}

/** Fix legacy URLs that omit the inner uasatrainingftp web folder segment. */
export function resolveMediaUrl(url: string | null | undefined): string {
  if (!url) return '';

  const publicBase = config.ftp.publicUrl.replace(/\/$/, '');
  if (!publicBase) return url;

  if (url.startsWith('http://') || url.startsWith('https://')) {
    const legacyPattern = new RegExp(
      `^https?://ahwuae\\.com/uasatrainingftp/(?!uasatrainingftp/)(uploads|workshops|trainers|elearning|documents)/`,
      'i'
    );
    if (legacyPattern.test(url)) {
      return url.replace(legacyPattern, `${publicBase}/$1/`);
    }
    return url;
  }

  const pathPart = url.replace(/^\/+/, '');
  return `${publicBase}/${pathPart}`;
}

export async function uploadToFtp(
  localPath: string,
  originalName: string,
  folder = 'uploads'
): Promise<{ filename: string; url: string; remotePath: string }> {
  if (!config.ftp.host || !config.ftp.user) {
    throw new Error('FTP is not configured. Set FTP_HOST, FTP_USER, FTP_PASSWORD in .env');
  }

  const filename = generateFilename(originalName);
  const remoteDir = `${config.ftp.basePath}/${folder}`.replace(/\/+/g, '/');
  const remotePath = `${remoteDir}/${filename}`;

  const client = new Client();
  client.ftp.verbose = config.nodeEnv === 'development';

  try {
    await client.access({
      host: config.ftp.host,
      port: config.ftp.port,
      user: config.ftp.user,
      password: config.ftp.password,
      secure: config.ftp.secure,
    });

    await client.ensureDir(remoteDir);
    await client.uploadFrom(localPath, remotePath);

    const url = buildPublicUrl(folder, filename);

    return { filename, url, remotePath };
  } finally {
    client.close();
  }
}

export async function deleteFromFtp(remotePath: string): Promise<void> {
  if (!config.ftp.host || !config.ftp.user) return;

  const client = new Client();
  try {
    await client.access({
      host: config.ftp.host,
      port: config.ftp.port,
      user: config.ftp.user,
      password: config.ftp.password,
      secure: config.ftp.secure,
    });
    await client.remove(remotePath);
  } finally {
    client.close();
  }
}

export function cleanupTempFile(filePath: string) {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
