import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, '..');
const frontendSrc = path.join(backendRoot, '../frontend/src');
const backendAssets = path.join(backendRoot, 'src/assets/certificates');
const distAssets = path.join(backendRoot, 'dist/assets/certificates');

const ASSET_FILES = ['logo-2.png', 'cma-logo.png', 'certificate-email-hero.png'];
const BACKEND_ONLY_ASSETS = ['emailbodyformatforcertificate.png'];

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

for (const file of ASSET_FILES) {
  const frontendSource = path.join(frontendSrc, file);
  const backendSource = path.join(backendAssets, file);
  const source = fs.existsSync(frontendSource)
    ? frontendSource
    : fs.existsSync(backendSource)
      ? backendSource
      : null;

  if (!source) {
    console.warn(`Asset not found: ${file} (checked frontend/src and backend assets)`);
    continue;
  }

  if (source !== backendSource) {
    copyFile(source, path.join(backendAssets, file));
  }
  if (fs.existsSync(path.join(backendRoot, 'dist'))) {
    copyFile(source, path.join(distAssets, file));
  }
  console.log(`Synced ${file}`);
}

console.log('Certificate logos synced.');
