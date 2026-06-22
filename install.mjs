#!/usr/bin/env node
// install.mjs — Copy pi-delegate and pi-structured-output to Pi's extension directory
import { cp as realCp, mkdir as realMkdir, readFile as realReadFile, writeFile as realWriteFile } from 'fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFilePromise = promisify(execFile);
import { join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Install extensions into Pi's config directory and register them in settings.json.
 *
 * @param {object} [options]
 * @param {object}   [options.fs]          - Mockable fs/promises (mkdir, cp, readFile, writeFile)
 * @param {Function} [options.exec]         - Mockable execFile(cmd, args, opts) -> { stdout, stderr }
 * @param {string[]} [options.pkgs]        - Package directory names under srcDir
 * @param {string}   [options.srcDir]      - Directory containing source packages
 * @param {string}   [options.piConfigDir] - Pi config directory (~/.config/pi)
 * @param {string}   [options.piExtDir]    - Pi extensions directory
 */
export async function install({
  fs = { cp: realCp, mkdir: realMkdir, readFile: realReadFile, writeFile: realWriteFile },
  exec = (cmd, args, opts) => execFilePromise(cmd, args, opts),
  pkgs = ['pi-delegate', 'pi-structured-output'],
  srcDir = __dirname,
  piConfigDir = join(homedir(), '.config', 'pi'),
  piExtDir = join(homedir(), '.config', 'pi', 'extensions'),
} = {}) {
  await fs.mkdir(piExtDir, { recursive: true });

  for (const pkg of pkgs) {
    const src = join(srcDir, 'packages', pkg);
    const dest = join(piExtDir, pkg);
    await fs.cp(src, dest, {
      recursive: true,
      filter: (srcPath) => {
        const parts = srcPath.split(/[/\\]/);
        // Skip pnpm-managed node_modules to avoid broken symlinks
        if (parts.includes('node_modules')) return false;
        // Skip pnpm-generated lock file to avoid pnpm-style symlinks in npm install
        if (parts.includes('package-lock.json')) return false;
        return true;
      },
    });

    // Remove any stale node_modules before installing
    try {
      await fs.rm(join(dest, 'node_modules'), { recursive: true, force: true });
    } catch {
      // Ignore if already absent
    }

    // Install runtime dependencies — --install-strategy=nested avoids pnpm-style symlinks
    await exec('npm', ['install', '--install-strategy=nested', '--production'], { cwd: dest });
    console.log(`✓ Installed ${pkg} → ${dest}`);
  }

  // Update ~/.config/pi/settings.json with the extension paths
  const settingsPath = join(piConfigDir, 'settings.json');
  let settings = { extensions: [] };
  let existing;

  try {
    existing = await fs.readFile(settingsPath, 'utf-8');
    const parsed = JSON.parse(existing);
    settings.extensions = parsed.extensions ?? [];
  } catch {
    // File doesn't exist or is invalid — start fresh
  }

  let changed = false;
  for (const pkg of pkgs) {
    const extPath = join(piExtDir, pkg);
    if (!settings.extensions.includes(extPath)) {
      settings.extensions.push(extPath);
      changed = true;
    }
  }

  if (changed) {
    // Preserve any other fields from the original config
    let merged = {};
    if (typeof existing !== 'undefined') {
      try { merged = JSON.parse(existing); } catch {}
    }
    merged.extensions = settings.extensions;
    await fs.writeFile(settingsPath, JSON.stringify(merged, null, 2) + '\n');
    console.log(`\n✓ Updated ${settingsPath}`);
  } else {
    console.log('\n✓ Extensions already registered in settings.json');
  }
}

// Auto-run when executed directly
const isMain = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith('/install.mjs')
);

if (isMain) {
  install().catch(err => {
    console.error('Install failed:', err.message);
    process.exit(1);
  });
}