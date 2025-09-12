/** @jest-environment jsdom */
/**
 * Unit tests for the EPUB library module.
 * Testing framework: Jest + JSDOM.
 *
 * If using Vitest, replace jest.* with vi.* and keep the structure identical.
 * These tests focus on exported public functions: openLibrary, handleLibraryFiles, toggleLibrary.
 * Internal helpers (displayLibraryGrid, createLibraryItem) are covered indirectly via DOM effects.
 */

const LIB_PATH = '../../src/library'; // Will be auto-adjusted by the script below if needed

// Mock sibling modules used by the library (paths will be auto-adjusted by script if needed)
jest.mock('../../src/indexedDB', () => ({
  storeLibraryHandle: jest.fn(),
  getStoredLibraryHandle: jest.fn(),
}));
jest.mock('../../src/book', () => ({
  openBookFromEntry: jest.fn(),
}));
jest.mock('../../src/main', () => ({
  showError: jest.fn(),
}));

// Mock epubjs default export
jest.mock('epubjs', () => {
  return jest.fn().mockImplementation(() => ({
    coverUrl: jest.fn().mockResolvedValue('blob:cover-url'),
    loaded: {
      metadata: Promise.resolve({ title: 'Mock EPUB Title' }),
    },
  }));
});

function setupDOM() {
  document.body.innerHTML = `
    <div id="library-container" class=""></div>
    <div id="overlay" class=""></div>
    <div id="library-content"></div>
    <input id="file-input" type="file" multiple />
  `;
}

function getEpub() {
  const mod = require('epubjs');
  return mod.default || mod;
}

function getMockedDeps() {
  const idb = require('../../src/indexedDB');
  const book = require('../../src/book');
  const main = require('../../src/main');
  return {
    storeLibraryHandle: idb.storeLibraryHandle,
    getStoredLibraryHandle: idb.getStoredLibraryHandle,
    openBookFromEntry: book.openBookFromEntry,
    showError: main.showError,
  };
}

function makeFileLike(name, content = 'dummy', type = 'application/epub+zip') {
  return {
    name,
    type,
    arrayBuffer: async () => new TextEncoder().encode(content).buffer,
  };
}

function makeFSFileHandle(name, fileObj) {
  return {
    kind: 'file',
    name,
    getFile: async () => fileObj,
  };
}

async function loadLibraryModule() {
  jest.resetModules(); // ensure module reads the fresh DOM at import time
  setupDOM();
  return await import(LIB_PATH);
}

describe('library module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // DOM is set in loadLibraryModule before import
  });

  describe('toggleLibrary', () => {
    test('forces open when forceOpen === true', async () => {
      const LibraryModule = await loadLibraryModule();
      LibraryModule.toggleLibrary(true);
      expect(document.getElementById('library-container').classList.contains('open')).toBe(true);
      expect(document.getElementById('overlay').classList.contains('open')).toBe(true);
    });

    test('forces closed when forceOpen === false', async () => {
      const LibraryModule = await loadLibraryModule();
      // open first
      LibraryModule.toggleLibrary(true);
      LibraryModule.toggleLibrary(false);
      expect(document.getElementById('library-container').classList.contains('open')).toBe(false);
      expect(document.getElementById('overlay').classList.contains('open')).toBe(false);
    });

    test('toggles when forceOpen is undefined', async () => {
      const LibraryModule = await loadLibraryModule();
      const container = document.getElementById('library-container');
      const overlay = document.getElementById('overlay');

      expect(container.classList.contains('open')).toBe(false);
      expect(overlay.classList.contains('open')).toBe(false);

      LibraryModule.toggleLibrary();
      expect(container.classList.contains('open')).toBe(true);
      expect(overlay.classList.contains('open')).toBe(true);

      LibraryModule.toggleLibrary();
      expect(container.classList.contains('open')).toBe(false);
      expect(overlay.classList.contains('open')).toBe(false);
    });
  });

  describe('handleLibraryFiles', () => {
    test('renders selected EPUB files and opens library', async () => {
      const LibraryModule = await loadLibraryModule();
      const { openBookFromEntry } = getMockedDeps();

      const file1 = makeFileLike('book1.epub');
      const file2 = makeFileLike('book2.epub');
      const event = { target: { files: [file1, file2] } };

      await LibraryModule.handleLibraryFiles(event);

      const container = document.getElementById('library-container');
      const overlay = document.getElementById('overlay');
      const grid = document.getElementById('library-content');

      expect(container.classList.contains('open')).toBe(true);
      expect(overlay.classList.contains('open')).toBe(true);
      expect(grid.children.length).toBe(2);

      // clicking opens the book
      grid.children[0].dispatchEvent(new window.Event('click'));
      expect(openBookFromEntry).toHaveBeenCalledWith(file1);
    });

    test('shows "No EPUB files found." when given empty selection', async () => {
      const LibraryModule = await loadLibraryModule();
      const event = { target: { files: [] } };

      await LibraryModule.handleLibraryFiles(event);

      const grid = document.getElementById('library-content');
      expect(grid.textContent).toContain('No EPUB files found.');
      expect(grid.children.length).toBe(1);
      // Library should still open
      expect(document.getElementById('library-container').classList.contains('open')).toBe(true);
      expect(document.getElementById('overlay').classList.contains('open')).toBe(true);
    });
  });

  describe('openLibrary', () => {
    test('uses stored directory handle when available; renders only .epub files', async () => {
      const LibraryModule = await loadLibraryModule();
      const { getStoredLibraryHandle } = getMockedDeps();
      const ePub = getEpub();

      const file1 = makeFileLike('keep.epub');
      const file2 = makeFileLike('skip.txt');
      const file3 = makeFileLike('another.epub');

      const handleKeep = makeFSFileHandle('keep.epub', file1);
      const handleSkip = { kind: 'file', name: 'skip.txt' };
      const handleAnother = makeFSFileHandle('another.epub', file3);

      const dirHandle = {
        async *values() {
          yield handleKeep;
          yield handleSkip;
          yield handleAnother;
        },
      };

      getStoredLibraryHandle.mockResolvedValue(dirHandle);

      await LibraryModule.openLibrary();

      const grid = document.getElementById('library-content');
      expect(grid.children.length).toBe(2);
      expect(ePub).toHaveBeenCalledTimes(2);
      const titles = Array.from(grid.querySelectorAll('.library-title')).map(n => n.textContent);
      expect(titles).toEqual(['Mock EPUB Title', 'Mock EPUB Title']);
    });

    test('prompts for directory and stores handle when none was previously stored', async () => {
      const LibraryModule = await loadLibraryModule();
      const { getStoredLibraryHandle, storeLibraryHandle } = getMockedDeps();

      const file1 = makeFileLike('fresh.epub');
      const handleFresh = makeFSFileHandle('fresh.epub', file1);

      const dirHandle = {
        async *values() {
          yield handleFresh;
        },
      };

      getStoredLibraryHandle.mockResolvedValue(null);
      window.showDirectoryPicker = jest.fn().mockResolvedValue(dirHandle);

      await LibraryModule.openLibrary();

      expect(window.showDirectoryPicker).toHaveBeenCalled();
      expect(storeLibraryHandle).toHaveBeenCalledWith(dirHandle);

      const grid = document.getElementById('library-content');
      expect(grid.children.length).toBe(1);
    });

    test('handles errors gracefully and reports via showError without throwing', async () => {
      const LibraryModule = await loadLibraryModule();
      const { getStoredLibraryHandle, showError } = getMockedDeps();

      getStoredLibraryHandle.mockRejectedValue(new Error('boom'));

      await expect(LibraryModule.openLibrary()).resolves.toBeUndefined();
      expect(showError).toHaveBeenCalledWith(expect.stringContaining('Failed to open library: boom'));
    });

    test('continues rendering even if cover/metadata fetch fails for a file', async () => {
      const LibraryModule = await loadLibraryModule();
      const { getStoredLibraryHandle } = getMockedDeps();
      const ePub = getEpub();

      const badFile = makeFileLike('bad.epub');
      const goodFile = makeFileLike('good.epub');

      const badHandle = makeFSFileHandle('bad.epub', badFile);
      const goodHandle = makeFSFileHandle('good.epub', goodFile);

      // First ePub call: simulate failures; second: success
      ePub.mockImplementationOnce(() => ({
        coverUrl: jest.fn().mockRejectedValue(new Error('cover fail')),
        loaded: { metadata: Promise.reject(new Error('meta fail')) },
      })).mockImplementationOnce(() => ({
        coverUrl: jest.fn().mockResolvedValue('blob:ok'),
        loaded: { metadata: Promise.resolve({ title: 'OK Title' }) },
      }));

      const dirHandle = {
        async *values() {
          yield badHandle;
          yield goodHandle;
        },
      };

      getStoredLibraryHandle.mockResolvedValue(dirHandle);

      await LibraryModule.openLibrary();

      const grid = document.getElementById('library-content');
      expect(grid.children.length).toBe(2);
      const items = Array.from(grid.children);
      // First item falls back to file name because metadata failed
      expect(items[0].querySelector('.library-title').textContent).toBe('bad.epub');
      // Second item uses metadata title
      expect(items[1].querySelector('.library-title').textContent).toBe('OK Title');
      // Image may remain empty on failure; ensure element exists (no crash)
      expect(items[0].querySelector('.library-cover')).not.toBeNull();
    });
  });

  describe('interaction', () => {
    test('clicking a rendered item calls openBookFromEntry with its entry', async () => {
      const LibraryModule = await loadLibraryModule();
      const { getStoredLibraryHandle, openBookFromEntry } = getMockedDeps();

      const file = makeFileLike('clickable.epub');
      const handle = makeFSFileHandle('clickable.epub', file);
      const dirHandle = {
        async *values() {
          yield handle;
        },
      };
      getStoredLibraryHandle.mockResolvedValue(dirHandle);

      await LibraryModule.openLibrary();

      const grid = document.getElementById('library-content');
      const item = grid.querySelector('.library-item');
      item.dispatchEvent(new window.Event('click'));

      expect(openBookFromEntry).toHaveBeenCalledWith(handle);
    });
  });
});