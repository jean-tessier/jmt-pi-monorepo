#!/usr/bin/env node
// install.mjs — Copy pi-delegate and pi-structured-output to Pi's extension directory
import { cp, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const piExtDir = join(homedir(), '.config', 'pi', 'extensions');

async function install() {
  await mkdir(piExtDir, { recursive: true });

  const packages = ['pi-delegate', 'pi-structured-output'];
  for (const pkg of packages) {
    const src = join(__dirname, 'packages', pkg);
    const dest = join(piExtDir, pkg);
    await cp(src, dest, { recursive: true });
    console.log(`✓ Installed ${pkg} → ${dest}`);
  }

  console.log('\nDone. Add the extensions to your Pi config:');
  packages.forEach(pkg => console.log(`  ${join(piExtDir, pkg)}/src/...`));
}

install().catch(err => {
  console.error('Install failed:', err.message);
  process.exit(1);
});
