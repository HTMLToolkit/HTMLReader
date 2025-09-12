/**
 * @jest-environment jsdom
 *
 * Framework: Jest + jsdom
 * These tests focus on:
 *  - openLibrary: directory handle retrieval, filtering .epub, error handling
 *  - handleLibraryFiles: rendering grid items, toggling UI, click-to-open
 *  - toggleLibrary: class add/remove/toggle logic
 *
 * Implementation notes:
 *  - The test dynamically resolves the library module path; optionally set LIBRARY_MODULE env var to the exact file path.
 *  - Relative imports used by the library module (./indexedDB, ./book, ./main) are mocked by resolving to absolute paths.
 *  - The epubjs package is mocked as a virtual module.
 */

const fs = require('fs');
const path = require('path');

/***** Test utilities *****/
function setupDOM() {
  document.body.innerHTML = `
    <div id="library-container" class=""></div>
    <div id="library-content"></div>
    <div id="overlay" class=""></div>
  `;
}

const flush = () => new Promise((res) => setTimeout(res, 0));

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'tests', '__tests__', 'coverage', 'dist', 'build', '.next', '.turbo', '.cache'
]);

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}
function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function tryCandidates(list) {
  for (const p of list) {
    if (isFile(p)) return p;
  }
  return null;
}

function walkFind(base, names, depth = 0, maxDepth = 5) {
  try {
    if (!fs.statSync(base).isDirectory() || depth > maxDepth) {
      return null;
    }
  } catch {
    return null;
  }

  const entries = fs.readdirSync(base, { withFileTypes: true });
  for (const ent of entries) {
    if (IGNORED_DIRS.has(ent.name)) {
      continue;
    }
    const full = path.join(base, ent.name);
    if (ent.isFile() && names.includes(ent.name)) {
      return full;
    }
  }
  for (const ent of entries) {
    if (!ent.isDirectory() || IGNORED_DIRS.has(ent.name)) {
      continue;
    }
    const found = walkFind(path.join(base, ent.name), names, depth + 1, maxDepth);
    if (found) {
      return found;
    }
  }
  return null;
}

function findLibraryModulePath() {
  if (process.env.LIBRARY_MODULE && isFile(process.env.LIBRARY_MODULE)) {
    return process.env.LIBRARY_MODULE;
  }
  const names = ['library.js', 'library.mjs', 'library.ts'];
  const roots = ['src', 'app', 'web', 'client', 'public', '.'];
  // Try direct candidates first
  const direct = tryCandidates(
    roots.flatMap(r => names.map(n => path.resolve(r, n)))
  );
  if (direct) return direct;
  // Walk search
  for (const root of roots) {
    const found = walkFind(path.resolve(root), names);
    if (found) return found;
  }
  throw new Error('Unable to resolve library module path for tests. Set LIBRARY_MODULE env variable if necessary.');
}

function resolveSibling(modulePath, request) {
  const basedir = path.dirname(modulePath);
  try {
    // Resolve using Node's resolver but with the module's directory as base
    return require.resolve(request, { paths: [basedir] });
  } catch {
    // Fallback common extensions
    const base = path.join(basedir, request);
    const choices = ['.js', '.mjs', '.ts', '/index.js', '/index.mjs', '/index.ts'];
    for (const ext of choices) {
      if (isFile(base + ext)) return base + ext;
    }
    // If still not found, return a likely path to allow virtual mocking
    return base + '.js';
  }
}

function createDirHandle(entries) {
  return {
    values() {
      async function* gen() {
        for (const e of entries) yield e;
      }
      return gen();
    }
  };
}

function makeCreateFakeFile(ePubFactory) {
  return function createFakeFile(name, { hasGetFile = false, title, cover = 'data:image/png;base64,cover' } = {}) {
    const file = {
      name,
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0))
    };
    // One-off behavior per file: cover URL + metadata
    ePubFactory.mockImplementationOnce(() => ({
      coverUrl: jest.fn().mockResolvedValue(cover),
      loaded: {
        metadata: Promise.resolve(title ? { title } : {})
      }
    }));
    if (hasGetFile) {
      return {
        kind: 'file',
        name,
        getFile: jest.fn().mockResolvedValue(file)
      };
    }
    return file;
  };
}

async function importWithMocks() {
  jest.resetModules();
  setupDOM();

  const modulePath = findLibraryModulePath();
  const idxPath = resolveSibling(modulePath, './indexedDB');
  const bookPath = resolveSibling(modulePath, './book');
  const mainPath = resolveSibling(modulePath, './main');

  const mocks = {
    storeLibraryHandle: jest.fn(),
    getStoredLibraryHandle: jest.fn(),
    openBookFromEntry: jest.fn(),
    showError: jest.fn()
  };

  const ePubFactory = jest.fn(() => ({
    coverUrl: jest.fn().mockResolvedValue('data:image/png;base64,cover'),
    loaded: { metadata: Promise.resolve({ title: 'Mock Book Title' }) }
  }));

  // Virtual mock for package import
  jest.doMock('epubjs', () => ePubFactory, { virtual: true });

  // Mock relative siblings using absolute resolved paths
  jest.doMock(idxPath, () => ({
    storeLibraryHandle: mocks.storeLibraryHandle,
    getStoredLibraryHandle: mocks.getStoredLibraryHandle
  }));
  jest.doMock(bookPath, () => ({
    openBookFromEntry: mocks.openBookFromEntry
  }));
  jest.doMock(mainPath, () => ({
    showError: mocks.showError
  }));

  const mod = await import(modulePath);
  return { mod, mocks, ePubFactory, modulePath };
}

/***** Tests *****/
describe('library module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('toggleLibrary', () => {
    test('adds open class when forceOpen === true', async () => {
      const { mod } = await importWithMocks();
      const container = document.getElementById('library-container');
      const overlay = document.getElementById('overlay');

      mod.toggleLibrary(true);

      expect(container.classList.contains('open')).toBe(true);
      expect(overlay.classList.contains('open')).toBe(true);
    });

    test('removes open class when forceOpen === false', async () => {
      const { mod } = await importWithMocks();
      const container = document.getElementById('library-container');
      const overlay = document.getElementById('overlay');

      container.classList.add('open');
      overlay.classList.add('open');

      mod.toggleLibrary(false);

      expect(container.classList.contains('open')).toBe(false);
      expect(overlay.classList.contains('open')).toBe(false);
    });

    test('toggles classes when forceOpen is undefined', async () => {
      const { mod } = await importWithMocks();
      const container = document.getElementById('library-container');
      const overlay = document.getElementById('overlay');

      expect(container.classList.contains('open')).toBe(false);
      expect(overlay.classList.contains('open')).toBe(false);

      mod.toggleLibrary();

      expect(container.classList.contains('open')).toBe(true);
      expect(overlay.classList.contains('open')).toBe(true);

      mod.toggleLibrary();

      expect(container.classList.contains('open')).toBe(false);
      expect(overlay.classList.contains('open')).toBe(false);
    });
  });

  describe('handleLibraryFiles', () => {
    test('renders items for provided files and toggles library open', async () => {
      const { mod, mocks, ePubFactory } = await importWithMocks();
      const createFakeFile = makeCreateFakeFile(ePubFactory);

      const fileWithTitle = createFakeFile('first.epub', { title: 'First Title' });
      const fileNoTitle = createFakeFile('second.epub', { title: undefined });
      const evt = { target: { files: [fileWithTitle, fileNoTitle] } };

      mod.handleLibraryFiles(evt);
      await flush();

      const content = document.getElementById('library-content');
      expect(content.children.length).toBe(2);

      const titles = Array.from(content.querySelectorAll('.library-title')).map(n => n.textContent);
      expect(titles).toEqual(['First Title', 'second.epub']);

      const imgs = Array.from(content.querySelectorAll('.library-cover'));
      expect(imgs.length).toBe(2);
      expect(imgs[0].getAttribute('src')).toContain('data:image/png;base64');
      expect(imgs[1].getAttribute('src')).toContain('data:image/png;base64');

      // Verify click wiring
      content.children[0].dispatchEvent(new window.Event('click'));
      expect(mocks.openBookFromEntry).toHaveBeenCalledTimes(1);
      expect(mocks.openBookFromEntry).toHaveBeenCalledWith(fileWithTitle);

      // UI toggled open
      expect(document.getElementById('library-container').classList.contains('open')).toBe(true);
      expect(document.getElementById('overlay').classList.contains('open')).toBe(true);
    });

    test('shows "No EPUB files found." message when list empty', async () => {
      const { mod } = await importWithMocks();

      mod.handleLibraryFiles({ target: { files: [] } });
      await flush();

      const content = document.getElementById('library-content');
      expect(content.textContent).toMatch(/No EPUB files found\./);
    });

    test('falls back to filename when metadata title missing; placeholder cover when coverUrl null', async () => {
      const { mod, ePubFactory } = await importWithMocks();
      const createFakeFile = makeCreateFakeFile(ePubFactory);

      // Simulate no cover and no title
      const noMetaNoCover = createFakeFile('untitled.epub', { title: undefined, cover: null });
      mod.handleLibraryFiles({ target: { files: [noMetaNoCover] } });
      await flush();

      const content = document.getElementById('library-content');
      expect(content.children.length).toBe(1);

      expect(content.querySelector('.library-title').textContent).toBe('untitled.epub');

      const src = content.querySelector('.library-cover').getAttribute('src');
      expect(typeof src).toBe('string');
      expect(src).toMatch(/^data:image\/png;base64,/); // placeholder data URI used
    });
  });

  describe('openLibrary', () => {
    test('uses stored directory handle when available and filters only .epub', async () => {
      const { mod, mocks, ePubFactory } = await importWithMocks();
      const createFakeFile = makeCreateFakeFile(ePubFactory);

      const epubEntry = createFakeFile('only.epub', { hasGetFile: true, title: 'Stored Book' });
      const txtEntry = { kind: 'file', name: 'notes.txt' };
      const subdir = { kind: 'directory', name: 'sub' };
      mocks.getStoredLibraryHandle.mockResolvedValue(createDirHandle([epubEntry, txtEntry, subdir]));

      await mod.openLibrary();
      await flush();

      const content = document.getElementById('library-content');
      expect(content.children.length).toBe(1);
      expect(content.querySelector('.library-title')?.textContent).toBe('Stored Book');

      expect(document.getElementById('library-container').classList.contains('open')).toBe(true);
      expect(document.getElementById('overlay').classList.contains('open')).toBe(true);
    });

    test('prompts user via showDirectoryPicker when no stored handle, then stores it', async () => {
      const { mod, mocks, ePubFactory } = await importWithMocks();
      const createFakeFile = makeCreateFakeFile(ePubFactory);

      mocks.getStoredLibraryHandle.mockResolvedValue(null);

      const epubEntry = createFakeFile('picked.epub', { hasGetFile: true, title: 'Picked Book' });
      const handle = createDirHandle([epubEntry]);

      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        value: jest.fn().mockResolvedValue(handle)
      });

      await mod.openLibrary();
      await flush();

      expect(window.showDirectoryPicker).toHaveBeenCalledTimes(1);
      expect(mocks.storeLibraryHandle).toHaveBeenCalledWith(handle);

      const content = document.getElementById('library-content');
      expect(content.children.length).toBe(1);
      expect(content.querySelector('.library-title')?.textContent).toBe('Picked Book');
    });

    test('reports errors via showError and does not throw', async () => {
      const { mod, mocks } = await importWithMocks();

      mocks.getStoredLibraryHandle.mockRejectedValue(new Error('boom'));

      await expect(mod.openLibrary()).resolves.toBeUndefined();

      expect(mocks.showError).toHaveBeenCalledTimes(1);
      expect(mocks.showError).toHaveBeenCalledWith(expect.stringMatching(/^Failed to open library: boom/));
    });
  });
});