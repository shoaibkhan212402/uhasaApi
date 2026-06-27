import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const UASA_LOGO_FILE = 'logo-2.png';
export const CMA_LOGO_FILE = 'cma-logo.png';
export const CERTIFICATE_EMAIL_HERO_FILE = 'certificate-email-hero.png';

export function resolveCertificateAssetsDir(): string {
  const candidates = [
    path.join(__dirname, '../assets/certificates'),
    path.join(__dirname, '../../src/assets/certificates'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0];
}

function frontendSrcDir(): string {
  return path.join(__dirname, '../../../frontend/src');
}

/** Prefer logos in backend assets (production), then frontend/src (local dev). */
export function resolveLogoPath(filename: string): string {
  const candidates = [
    path.join(resolveCertificateAssetsDir(), filename),
    path.join(frontendSrcDir(), filename),
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) return filePath;
  }
  throw new Error(`Certificate logo not found: ${filename}`);
}

export function logoDataUri(filename: string): string {
  const filePath = resolveLogoPath(filename);
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filename).toLowerCase();
  const mime =
    ext === '.svg'
      ? 'image/svg+xml'
      : ext === '.png'
        ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : 'application/octet-stream';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

export function sanitizeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').slice(0, 80);
}
