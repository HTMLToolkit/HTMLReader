import fs from 'fs-extra';
import path from 'path';
import { rimrafSync } from 'rimraf';
import { fileURLToPath } from 'url';
import process from 'process';

// ES module __dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, '..'); // repo root
const dist = path.join(__dirname, 'dist');  // build folder

// Files/folders to keep
const keep = new Set(['README.md', 'LICENSE', 'Build']);

// Clean repo root (skip hidden files/folders)
fs.readdirSync(root).forEach(file => {
  if (!fs.existsSync(dist) || fs.readdirSync(dist).length === 0) {
    console.error('ERROR: dist is missing or empty:', dist);
    process.exit(1);
  }

  if (!keep.has(file) && !file.startsWith('.')) {  // <-- skip hidden
    rimrafSync(path.join(root, file));
    console.log('Deleted:', file);
  }
});

// Copy each item inside dist individually
fs.readdirSync(dist).forEach(item => {
  const srcPath = path.join(dist, item);
  const destPath = path.join(root, item);

  // Skip copying if destination exists and is in keep set
  if (keep.has(item)) {
    console.log(`Skipping copy of ${item} (keep folder/file)`);
    return;
  }

  fs.copySync(srcPath, destPath, { overwrite: true });
  console.log('Copied:', item);
});
