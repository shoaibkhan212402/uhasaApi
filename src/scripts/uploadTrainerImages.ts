import fs from 'fs';
import os from 'os';
import path from 'path';
import { Client } from 'basic-ftp';
import { config } from '../config.js';

const sources = [
  'https://uasatraining.ahwuae.com',
  'https://ahwuae.com',
  'http://www.uasatraining.com',
];

const files = [
  { dest: 'trainer-yasin-arafat.jpg', legacy: '260620240319481.jpg' },
  { dest: 'trainer-mohamed-ashraf.jpg', legacy: '26062024031756Mohamed%20Ashraf%20(1).jpg' },
  { dest: 'trainer-hesham-afifi.jpg', legacy: '260620240320552%20(1).jpg' },
  { dest: 'trainer-hisham-shalaby.jpg', legacy: '26062024032602Untitled%20(1).jpg' },
  { dest: 'trainer-hala-abou-alwan.jpg', legacy: '2606202403431651.jpg' },
];

async function download(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return false;
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return false;
    fs.writeFileSync(dest, buf);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uasa-trainers-'));
  const uploaded: string[] = [];

  for (const file of files) {
    let saved = false;
    for (const base of sources) {
      const url = `${base}/Areas/Adminportal/Content/UPLOADIMG/${file.legacy}`;
      const local = path.join(tmpDir, file.dest);
      if (await download(url, local)) {
        console.log(`Downloaded ${file.dest} from ${base}`);
        saved = true;

        const client = new Client();
        await client.access({
          host: config.ftp.host,
          port: config.ftp.port,
          user: config.ftp.user,
          password: config.ftp.password,
          secure: config.ftp.secure,
        });
        const remoteDir = `${config.ftp.basePath}/uploads`.replace(/\/+/g, '/');
        await client.ensureDir(remoteDir);
        await client.uploadFrom(local, `${remoteDir}/${file.dest}`);
        client.close();
        uploaded.push(file.dest);
        break;
      }
    }
    if (!saved) console.log(`Could not download ${file.dest}`);
  }

  console.log(`Uploaded ${uploaded.length}/${files.length} images`);
}

main().catch(console.error);
