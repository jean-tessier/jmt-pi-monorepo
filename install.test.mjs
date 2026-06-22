// install.test.mjs — Tests for install.mjs using a virtual file system
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// ── Virtual file system ────────────────────────────────────────────────
class VirtualFS {
  #files = new Map();   // normalized path → string content
  #dirs = new Set();    // normalized path → exists

  constructor() {
    this.#dirs.add('/'); // root always exists
  }

  // Normalize path: remove trailing slash
  #norm(p) {
    const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
    return '/' + parts.join('/');
  }

  // ── fs/promises API ──────────────────────────────────────────────────

  async mkdir(path, options = {}) {
    const p = this.#norm(path);
    if (options.recursive) {
      const segments = p.split('/').filter(Boolean);
      let cur = '';
      for (const seg of segments) {
        cur += '/' + seg;
        this.#dirs.add(cur);
      }
    } else {
      const parent = this.#norm(p.split('/').slice(0, -1).join('/') || '/');
      if (!this.#dirs.has(parent)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      this.#dirs.add(p);
    }
  }

  async readFile(path, encoding) {
    const p = this.#norm(path);
    const content = this.#files.get(p);
    if (content === undefined) {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
    }
    return content;
  }

  async writeFile(path, content) {
    const p = this.#norm(path);
    this.#files.set(p, content);
    const parent = this.#norm(p.split('/').slice(0, -1).join('/') || '/');
    this.#dirs.add(parent);
  }

  async cp(src, dest, options = {}) {
    const srcNorm = this.#norm(src);
    const destNorm = this.#norm(dest);
    const filter = options.filter;

    if (options.recursive) {
      const prefix = srcNorm === '/' ? '' : srcNorm;
      const entries = [];

      for (const key of this.#files.keys()) {
        if (key.startsWith(prefix + '/') || key === prefix) {
          const rel = key.slice(prefix.length) || '/';
          if (filter && !filter(key)) continue;
          entries.push({ type: 'file', rel, abs: key });
        }
      }
      for (const key of this.#dirs) {
        if ((key.startsWith(prefix + '/') || key === prefix) && key !== '/') {
          const rel = key.slice(prefix.length) || '/';
          if (filter && !filter(key)) continue;
          entries.push({ type: 'dir', rel, abs: key });
        }
      }

      for (const e of entries) {
        const target = destNorm + (e.rel === '/' ? '' : e.rel);
        if (e.type === 'dir') {
          this.#dirs.add(target);
        } else {
          this.#files.set(target, this.#files.get(e.abs));
        }
      }
    } else {
      const content = this.#files.get(srcNorm);
      if (content === undefined) throw Object.assign(new Error(`ENOENT: ${src}`), { code: 'ENOENT' });
      this.#files.set(destNorm, content);
    }
  }

  // ── Inspection helpers ───────────────────────────────────────────────
  isFile(path) { return this.#files.has(this.#norm(path)); }
  readFileRaw(path) { return this.#files.get(this.#norm(path)) ?? null; }
  listFiles() { return [...this.#files.keys()].sort(); }
  listDirs() { return [...this.#dirs].sort(); }
  isDir(path) { return this.#dirs.has(this.#norm(path)); }

  populate(entries) {
    for (const [path, content] of Object.entries(entries)) {
      const p = this.#norm(path);
      const segments = p.split('/').filter(Boolean);
      let cur = '';
      for (const seg of segments.slice(0, -1)) {
        cur += '/' + seg;
        this.#dirs.add(cur);
      }
      this.#files.set(p, content);
      this.#dirs.add(p.split('/').slice(0, -1).join('/') || '/');
    }
  }
}

// ── Import the install function ────────────────────────────────────────
let install;
before(async () => {
  install = (await import('./install.mjs')).install;
});

// ── Helpers ────────────────────────────────────────────────────────────
function mockExec(tracker) {
  return async (cmd, args, opts) => {
    tracker.push({ cmd, args, cwd: opts.cwd });
    return { stdout: '', stderr: '' };
  };
}

// ── Tests ──────────────────────────────────────────────────────────────
describe('install()', () => {
  it('copies extension files excluding node_modules', async () => {
    const vfs = new VirtualFS();
    const npmCalls = [];
    const exec = mockExec(npmCalls);

    vfs.populate({
      '/src/packages/pi-delegate/package.json': JSON.stringify({
        pi: { extensions: ['./src/parent/index.ts'] }
      }),
      '/src/packages/pi-delegate/src/parent/index.ts': 'export default function(pi) {}',
      '/src/packages/pi-delegate/README.md': '# pi-delegate',
      '/src/packages/pi-delegate/node_modules/vitest/index.js': '// vitest',
      '/src/packages/pi-delegate/node_modules/yaml/index.js': '// yaml',

      '/src/packages/pi-structured-output/package.json': JSON.stringify({
        pi: { extensions: ['./src/index.ts'] }
      }),
      '/src/packages/pi-structured-output/src/index.ts': 'export default function(pi) {}',
      '/src/packages/pi-structured-output/README.md': '# pi-structured-output',
    });

    await install({
      fs: vfs,
      exec,
      pkgs: ['pi-delegate', 'pi-structured-output'],
      srcDir: '/src',
      piConfigDir: '/tmp/config/pi',
      piExtDir: '/tmp/config/pi/extensions',
    });

    // Verify extensions were copied
    assert(vfs.isDir('/tmp/config/pi/extensions/pi-delegate'));
    assert(vfs.isDir('/tmp/config/pi/extensions/pi-structured-output'));

    // Verify source files exist in dest
    assert(vfs.isFile('/tmp/config/pi/extensions/pi-delegate/package.json'));
    assert(vfs.isFile('/tmp/config/pi/extensions/pi-delegate/src/parent/index.ts'));
    assert(vfs.isFile('/tmp/config/pi/extensions/pi-structured-output/package.json'));
    assert(vfs.isFile('/tmp/config/pi/extensions/pi-structured-output/src/index.ts'));

    // Verify node_modules was NOT copied
    assert(!vfs.isDir('/tmp/config/pi/extensions/pi-delegate/node_modules'));
    assert(!vfs.isFile('/tmp/config/pi/extensions/pi-delegate/node_modules/vitest/index.js'));
    assert(!vfs.isFile('/tmp/config/pi/extensions/pi-delegate/node_modules/yaml/index.js'));
    assert(!vfs.isDir('/tmp/config/pi/extensions/pi-structured-output/node_modules'));
  });

  it('runs npm install --production for each package', async () => {
    const vfs = new VirtualFS();
    const npmCalls = [];
    const exec = mockExec(npmCalls);

    vfs.populate({
      '/src/packages/pi-delegate/package.json': JSON.stringify({
        dependencies: { '@sinclair/typebox': '^0.34.0' }
      }),
      '/src/packages/pi-structured-output/package.json': '{}',
    });

    await install({
      fs: vfs,
      exec,
      pkgs: ['pi-delegate', 'pi-structured-output'],
      srcDir: '/src',
      piConfigDir: '/tmp/config/pi',
      piExtDir: '/tmp/config/pi/extensions',
    });

    assert.equal(npmCalls.length, 2);
    assert.equal(npmCalls[0].cmd, 'npm');
    assert.deepEqual(npmCalls[0].args, ['install', '--production']);
    assert(npmCalls[0].cwd.endsWith('/pi-delegate'));
    assert.equal(npmCalls[1].cmd, 'npm');
    assert.deepEqual(npmCalls[1].args, ['install', '--production']);
    assert(npmCalls[1].cwd.endsWith('/pi-structured-output'));
  });

  it('creates settings.json if missing and adds extensions', async () => {
    const vfs = new VirtualFS();
    vfs.populate({
      '/src/packages/pi-delegate/package.json': '{}',
      '/src/packages/pi-structured-output/package.json': '{}',
    });

    await install({
      fs: vfs,
      exec: mockExec([]),
      pkgs: ['pi-delegate', 'pi-structured-output'],
      srcDir: '/src',
      piConfigDir: '/tmp/config/pi',
      piExtDir: '/tmp/config/pi/extensions',
    });

    assert(vfs.isFile('/tmp/config/pi/settings.json'));
    const settings = JSON.parse(vfs.readFileRaw('/tmp/config/pi/settings.json'));
    assert(Array.isArray(settings.extensions));
    assert(settings.extensions.includes('/tmp/config/pi/extensions/pi-delegate'));
    assert(settings.extensions.includes('/tmp/config/pi/extensions/pi-structured-output'));
  });

  it('appends to existing extensions array in settings.json', async () => {
    const vfs = new VirtualFS();
    vfs.populate({
      '/tmp/config/pi/settings.json': JSON.stringify({ extensions: ['/existing/ext'] }),
      '/src/packages/pi-delegate/package.json': '{}',
      '/src/packages/pi-structured-output/package.json': '{}',
    });

    await install({
      fs: vfs,
      exec: mockExec([]),
      pkgs: ['pi-delegate', 'pi-structured-output'],
      srcDir: '/src',
      piConfigDir: '/tmp/config/pi',
      piExtDir: '/tmp/config/pi/extensions',
    });

    const settings = JSON.parse(vfs.readFileRaw('/tmp/config/pi/settings.json'));
    assert.equal(settings.extensions.length, 3);
    assert(settings.extensions.includes('/existing/ext'));
    assert(settings.extensions.includes('/tmp/config/pi/extensions/pi-delegate'));
    assert(settings.extensions.includes('/tmp/config/pi/extensions/pi-structured-output'));
  });

  it('does not duplicate extension paths on re-run', async () => {
    const vfs = new VirtualFS();
    vfs.populate({
      '/src/packages/pi-delegate/package.json': '{}',
      '/src/packages/pi-structured-output/package.json': '{}',
    });

    const exec = mockExec([]);

    // First run
    await install({
      fs: vfs, exec,
      pkgs: ['pi-delegate', 'pi-structured-output'],
      srcDir: '/src',
      piConfigDir: '/tmp/config/pi',
      piExtDir: '/tmp/config/pi/extensions',
    });

    // Second run
    await install({
      fs: vfs, exec,
      pkgs: ['pi-delegate', 'pi-structured-output'],
      srcDir: '/src',
      piConfigDir: '/tmp/config/pi',
      piExtDir: '/tmp/config/pi/extensions',
    });

    const settings = JSON.parse(vfs.readFileRaw('/tmp/config/pi/settings.json'));
    assert.equal(settings.extensions.length, 2);
  });

  it('preserves existing settings.json fields', async () => {
    const vfs = new VirtualFS();
    vfs.populate({
      '/tmp/config/pi/settings.json': JSON.stringify({
        packages: ['npm:@foo/bar'],
        extensions: [],
        theme: 'dark',
      }),
      '/src/packages/pi-delegate/package.json': '{}',
      '/src/packages/pi-structured-output/package.json': '{}',
    });

    await install({
      fs: vfs,
      exec: mockExec([]),
      pkgs: ['pi-delegate', 'pi-structured-output'],
      srcDir: '/src',
      piConfigDir: '/tmp/config/pi',
      piExtDir: '/tmp/config/pi/extensions',
    });

    const settings = JSON.parse(vfs.readFileRaw('/tmp/config/pi/settings.json'));
    assert.equal(settings.theme, 'dark');
    assert.deepEqual(settings.packages, ['npm:@foo/bar']);
    assert(settings.extensions.includes('/tmp/config/pi/extensions/pi-delegate'));
  });
});