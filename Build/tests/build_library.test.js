/**
 * Tests for library UI builder module:
 * - openLibrary: happy path (stored handle), prompt path (showDirectoryPicker), error path
 * - handleLibraryFiles: populates grid and toggles library
 * - toggleLibrary: opens, closes, toggles classes on container and overlay
 * - Indirectly validates displayLibraryGrid and createLibraryItem via DOM mutations
 *
 * Framework note:
 * These tests are written to run under Jest or Vitest with a jsdom-like environment.
 * - If using Jest: expect/jest.fn/jest.mock are available and testEnvironment is jsdom (default).
 * - If using Vitest: expect/vi.fn/vi.mock are available and environment: 'jsdom' is typical; we alias jest->vi when needed.
 */

 // Lightweight compatibility shim between Jest and Vitest
 // If vi is defined (Vitest), alias jest to vi for mocks/timers usage in the test file.
 // This avoids adding new dependencies and keeps tests portable.
 // eslint-disable-next-line no-undef

const isVitest = typeof vi !== 'undefined';
// eslint-disable-next-line no-undef

const jestLike = isVitest ? vi : jest;


// We dynamically require the module under test after setting up DOM and mocks
// so that it reads the correct document.getElementById references.

// Resolve import path heuristically:
// Most projects place this module in src/ or root. Try to require with multiple fallbacks.

function loadModule() {
  const candidates = [
    './build_library.js',
    './src/build_library.js',
    './lib/build_library.js',
    './app/build_library.js',
    './frontend/build_library.js',
    './client/build_library.js',
  ];
  for (const p of candidates) {

    try {

      // Use require to allow reloading between tests

      // eslint-disable-next-line global-require, import/no-dynamic-require

      return { mod: require(p), path: p };

    } catch (e) {

      // continue

    }

  }

  throw new Error('Could not locate build_library module. Ensure the file is named build_library.js and is in the project root or src/.');
}

// Mocks for side-effect imports
// We need to mock: ./indexedDB, ./book, ./main, and epubjs
// Because the module under test will resolve these relative to its file location,
// We will use jest/vi moduleNameMapper-style runtime mocks via jestLike.mock with factory.


let mockStoreLibraryHandle;
let mockGetStoredLibraryHandle;
let mockOpenBookFromEntry;
let mockShowError;
let mockEPubCtor;
let mockEPubInstance;


// Will hold the loaded module's exports

let openLibrary, handleLibraryFiles, toggleLibrary;


// Utilities to build a minimal DOM environment expected by the module
function setupDOM() {
  document.body.innerHTML = `
    <div id="library-container" class=""></div>
    <div id="library-content"></div>
    <div id="overlay" class=""></div>
    <input id="file-input" type="file" multiple />
  `;
}


// Helper to reset and (re)load the module under test with fresh mocks and DOM
async function reloadModule() {
  if (jestLike.resetModules) jestLike.resetModules();

  // Reset DOM
  setupDOM();


  mockStoreLibraryHandle = jestLike.fn(async () => {});
  mockGetStoredLibraryHandle = jestLike.fn(async () => null);
  mockOpenBookFromEntry = jestLike.fn();
  mockShowError = jestLike.fn();


  mockEPubInstance = {

    coverUrl: jestLike.fn(async () => 'https://example.test/cover.png'),

    loaded: { metadata: Promise.resolve({ title: 'Mock Book Title' }) },

  };
  mockEPubCtor = jestLike.fn(() => mockEPubInstance);


  // Because the module uses relative imports like "./indexedDB" relative to its own path,

  // we create runtime mocks with paths matching whichever candidate resolved.
  const { path } = loadModule(); // We only need path to compute neighbors; actual require deferred after mocks.

  const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const baseDir = lastSlash === -1 ? '' : path.slice(0, lastSlash + 1); // directory containing build_library.js

  // Build relative specifiers used by the module
  const idxDBPath = baseDir + 'indexedDB';
  const bookPath = baseDir + 'book';
  const mainPath = baseDir + 'main';
  const epubjsPath = 'epubjs';

  // Apply mocks
  if (jestLike.doMock) {
    jestLike.doMock(idxDBPath, () => ({
      storeLibraryHandle: mockStoreLibraryHandle,
      getStoredLibraryHandle: mockGetStoredLibraryHandle,
    }), { virtual: true });

    jestLike.doMock(bookPath, () => ({
      openBookFromEntry: mockOpenBookFromEntry,
    }), { virtual: true });

    jestLike.doMock(mainPath, () => ({
      showError: mockShowError,
    }), { virtual: true });

    jestLike.doMock(epubjsPath, () => {
      const e = function(...args) { return mockEPubCtor(...args); };
      e.default = e; // default export for transpiled ESM interop
      return e;
    }, { virtual: true });
  }

  // Now actually require the module
  const { mod } = loadModule();
  openLibrary = mod.openLibrary;
  handleLibraryFiles = mod.handleLibraryFiles;
  toggleLibrary = mod.toggleLibrary;


  if ([openLibrary, handleLibraryFiles, toggleLibrary].some(fn => typeof fn !== 'function')) {

    throw new Error('build_library module does not export expected functions: openLibrary, handleLibraryFiles, toggleLibrary');

  }
}


// Utility to create a mock File-like object
function makeFile(name, content = 'dummy', type = 'application/epub+zip') {

  // In jsdom, File may not be fully implemented; mimic enough for .arrayBuffer()

  return {

    name,

    type,

    async arrayBuffer() { return new TextEncoder().encode(content).buffer; },

  };
}


// Utility to create a FileSystemFileHandle-like entry
function makeFileEntry(name, content = 'dummy') {

  const f = makeFile(name, content);

  return {

    kind: 'file',

    name,

    async getFile() { return f; },

  };
}

describe('build_library module', () => {

  beforeEach(async () => {

    await reloadModule();

  });


  describe('toggleLibrary', () => {

    test('forces open when true', () => {

      const lib = document.getElementById('library-container');

      const ov = document.getElementById('overlay');

      expect(lib.classList.contains('open')).toBe(false);

      expect(ov.classList.contains('open')).toBe(false);


      toggleLibrary(true);


      expect(lib.classList.contains('open')).toBe(true);

      expect(ov.classList.contains('open')).toBe(true);

    });


    test('forces close when false', () => {

      const lib = document.getElementById('library-container');

      const ov = document.getElementById('overlay');

      lib.classList.add('open');

      ov.classList.add('open');


      toggleLibrary(false);


      expect(lib.classList.contains('open')).toBe(false);

      expect(ov.classList.contains('open')).toBe(false);

    });


    test('toggles when no arg', () => {

      const lib = document.getElementById('library-container');

      const ov = document.getElementById('overlay');

      expect(lib.classList.contains('open')).toBe(false);

      expect(ov.classList.contains('open')).toBe(false);


      toggleLibrary();


      expect(lib.classList.contains('open')).toBe(true);

      expect(ov.classList.contains('open')).toBe(true);


      toggleLibrary();


      expect(lib.classList.contains('open')).toBe(false);

      expect(ov.classList.contains('open')).toBe(false);

    });
  });


  describe('openLibrary', () => {

    test('uses stored directory handle when available (happy path)', async () => {

      const entries = [

        makeFileEntry('a.epub', 'A'),

        makeFileEntry('b.txt', 'B'),     // should be filtered out

        makeFileEntry('c.epub', 'C'),

      ];


      // Mock stored handle and its async iterator

      const dirHandle = {

        async *values() {

          for (const e of entries) yield e;

        },

      };
      mockGetStoredLibraryHandle.mockResolvedValueOnce(dirHandle);


      await openLibrary();


      // Should not prompt user

      expect(window.showDirectoryPicker).toBeUndefined();


      // Library toggled open

      const lib = document.getElementById('library-container');

      const ov = document.getElementById('overlay');

      expect(lib.classList.contains('open')).toBe(true);

      expect(ov.classList.contains('open')).toBe(true);


      // Library content populated with only .epub items

      const content = document.getElementById('library-content');

      const items = content.querySelectorAll('.library-item');

      expect(items.length).toBe(2);


      // Each item should have title from metadata override and cover src set

      items.forEach((item) => {

        const img = item.querySelector('img.library-cover');

        const title = item.querySelector('.library-title');

        expect(img).toBeTruthy();

        expect(img.src).toContain('https://example.test/cover.png');

        expect(title.textContent).toBe('Mock Book Title');

      });

    });


    test('prompts user with showDirectoryPicker if no stored handle and stores it', async () => {

      // First call returns null to force prompt
      mockGetStoredLibraryHandle.mockResolvedValueOnce(null);

      const entries = [ makeFileEntry('only.epub', 'X') ];

      const dirHandle = {
        async *values() { yield* entries; }
      };


      // Provide a stub for directory picker

      // jsdom does not define it; define on window

      // eslint-disable-next-line no-undef

      global.window = global.window || {};

      // eslint-disable-next-line no-undef

      window.showDirectoryPicker = jestLike.fn(async () => dirHandle);


      await openLibrary();


      expect(window.showDirectoryPicker).toHaveBeenCalledTimes(1);

      expect(mockStoreLibraryHandle).toHaveBeenCalledWith(dirHandle);


      const content = document.getElementById('library-content');

      expect(content.querySelectorAll('.library-item').length).toBe(1);

    });


    test('handles errors by calling showError', async () => {

      // Force getStoredLibraryHandle to throw

      const error = new Error('boom');

      mockGetStoredLibraryHandle.mockRejectedValueOnce(error);


      await openLibrary();


      expect(mockShowError).toHaveBeenCalledTimes(1);

      expect(mockShowError.mock.calls[0][0]).toMatch(/Failed to open library: boom/);

    });


    test('displays placeholder cover when no coverUrl', async () => {

      mockGetStoredLibraryHandle.mockResolvedValueOnce({
        async *values() { yield makeFileEntry('x.epub', 'X'); }
      });


      // For this test, no coverUrl

      mockEPubInstance.coverUrl.mockResolvedValueOnce(null);


      await openLibrary();


      const img = document.querySelector('.library-item img.library-cover');

      expect(img).toBeTruthy();

      // data URL placeholder should be set; just assert it starts with data:image/png

      expect(img.src.startsWith('data:image/png')).toBe(true);

    });


    test('logs error but still creates item if cover/metadata loading fails', async () => {

      mockGetStoredLibraryHandle.mockResolvedValueOnce({
        async *values() { yield makeFileEntry('err.epub', 'E'); }
      });


      // Make ePub constructor throw to simulate parsing failure

      mockEPubCtor.mockImplementationOnce(() => { throw new Error('parse-fail'); });


      // Spy on console.error without polluting output

      const origError = console.error;

      const errorSpy = jestLike.spyOn(console, 'error').mockImplementation(() => {});


      await openLibrary();


      expect(errorSpy).toHaveBeenCalled();

      const items = document.querySelectorAll('.library-item');

      expect(items.length).toBe(1); // item still exists with fallback title (file name)

      const title = items[0].querySelector('.library-title').textContent;

      expect(title).toBe('err.epub');


      errorSpy.mockRestore();

      console.error = origError;

    });
  });


  describe('handleLibraryFiles', () => {

    test('renders provided FileList entries and toggles library', async () => {

      const files = [

        makeFile('local.epub', 'L'),

        makeFile('skip.txt', 'S'),

      ];
      // e.target.files should be array-like; we provide directly as Array with target.files

      const evt = { target: { files } };


      await handleLibraryFiles(evt);


      // Should toggle open

      const lib = document.getElementById('library-container');

      const ov = document.getElementById('overlay');

      expect(lib.classList.contains('open')).toBe(true);

      expect(ov.classList.contains('open')).toBe(true);


      // displayLibraryGrid should accept all passed entries (not filtering by extension here),
      // but createLibraryItem will still work; verify items render count equals files.length

      const items = document.querySelectorAll('.library-item');

      expect(items.length).toBe(files.length);

    });


    test('shows "No EPUB files found." message when given empty list', async () => {

      const evt = { target: { files: [] } };


      await handleLibraryFiles(evt);


      const content = document.getElementById('library-content');

      expect(content.textContent).toMatch(/No EPUB files found\./);

    });
  });


  describe('interaction', () => {

    test('clicking a library item calls openBookFromEntry with the associated entry', async () => {

      mockGetStoredLibraryHandle.mockResolvedValueOnce({
        async *values() { yield makeFileEntry('clickme.epub', 'C'); }
      });


      await openLibrary();


      const item = document.querySelector('.library-item');

      expect(item).toBeTruthy();


      item.click();


      expect(mockOpenBookFromEntry).toHaveBeenCalledTimes(1);

      const arg = mockOpenBookFromEntry.mock.calls[0][0];

      expect(arg && arg.name).toBe('clickme.epub');

    });
  });
});