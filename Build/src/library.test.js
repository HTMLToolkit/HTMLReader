/**
 * Test suite for library module.
 * Assumed testing framework: Jest with jsdom testEnvironment.
 * If your project uses Vitest, these tests are largely compatible; replace jest.fn with vi.fn and adjust imports.
 */

import * as LibraryModule from './library';

// Mocks for external modules used by the library
jest.mock('./indexedDB', () => ({
  storeLibraryHandle: jest.fn(),
  getStoredLibraryHandle: jest.fn(),
}));
jest.mock('./book', () => ({
  openBookFromEntry: jest.fn(),
}));
jest.mock('./main', () => ({
  showError: jest.fn(),
}));

// Mock epubjs default export
const makeEpubMock = () => {
  const coverUrl = jest.fn().mockResolvedValue('https://example.com/cover.jpg');
  const loaded = { metadata: Promise.resolve({ title: 'Mock Title' }) };
  return { coverUrl, loaded };
};
jest.mock('epubjs', () => {
  const fn = jest.fn(() => makeEpubMock());
  // expose helper to adjust behavior in specific tests
  fn.__makeNext = (implFactory) => {
    fn.mockImplementationOnce(() => implFactory());
  };
  return fn;
});

const { storeLibraryHandle, getStoredLibraryHandle } = require('./indexedDB');
const { openBookFromEntry } = require('./book');
const { showError } = require('./main');
const ePub = require('epubjs').default || require('epubjs');

function createDOM() {
  document.body.innerHTML = `
    <div id="library-container" class=""></div>
    <div id="library-content"></div>
    <div id="overlay" class=""></div>
    <input id="file-input" type="file" multiple />
  `;
}

beforeEach(() => {
  jest.useFakeTimers(); // safety for any timers, none expected
  jest.clearAllMocks();
  createDOM();
});

afterEach(() => {
  // Ensure DOM is clean between tests
  document.body.innerHTML = '';
});

function makeFile(name, ok = true, arrayBufferBytes = 8) {
  return {
    name,
    arrayBuffer: ok
      ? jest.fn().mockResolvedValue(new ArrayBuffer(arrayBufferBytes))
      : jest.fn().mockRejectedValue(new Error('arrayBuffer failed')),
  };
}

function makeFSFileEntry(name, fileObj) {
  return {
    kind: 'file',
    name,
    getFile: jest.fn().mockResolvedValue(fileObj),
  };
}

function makeDirHandle(entries) {
  // entries: array of {kind,name,getFile?}
  return {
    values: async function* () {
      for (const e of entries) yield e;
    },
  };
}

describe('toggleLibrary', () => {
  test('opens when forceOpen === true', () => {
    const { toggleLibrary } = LibraryModule;
    const container = document.getElementById('library-container');
    const overlay = document.getElementById('overlay');

    toggleLibrary(true);

    expect(container.classList.contains('open')).toBe(true);
    expect(overlay.classList.contains('open')).toBe(true);
  });

  test('closes when forceOpen === false', () => {
    const { toggleLibrary } = LibraryModule;
    const container = document.getElementById('library-container');
    const overlay = document.getElementById('overlay');
    container.classList.add('open');
    overlay.classList.add('open');

    toggleLibrary(false);

    expect(container.classList.contains('open')).toBe(false);
    expect(overlay.classList.contains('open')).toBe(false);
  });

  test('toggles when forceOpen is undefined', () => {
    const { toggleLibrary } = LibraryModule;
    const container = document.getElementById('library-container');
    const overlay = document.getElementById('overlay');

    expect(container.classList.contains('open')).toBe(false);
    expect(overlay.classList.contains('open')).toBe(false);

    toggleLibrary();

    expect(container.classList.contains('open')).toBe(true);
    expect(overlay.classList.contains('open')).toBe(true);

    toggleLibrary();

    expect(container.classList.contains('open')).toBe(false);
    expect(overlay.classList.contains('open')).toBe(false);
  });
});

describe('handleLibraryFiles', () => {
  test('renders items for provided files and toggles open', async () => {
    const { handleLibraryFiles } = LibraryModule;
    const content = document.getElementById('library-content');

    const f1 = makeFile('book1.epub');
    const f2 = makeFile('book2.epub');

    await handleLibraryFiles({ target: { files: [f1, f2] } });

    // two items created
    const items = content.querySelectorAll('.library-item');
    expect(items.length).toBe(2);

    // cover applied by epub mock
    const img0 = items[0].querySelector('img.library-cover');
    expect(img0).toBeTruthy();
    expect(img0.src).toBe('https://example.com/cover.jpg/'); // jsdom appends a trailing slash to absolute URLs without path
    const title0 = items[0].querySelector('.library-title');
    // Metadata title should overwrite file name
    await Promise.resolve(); // allow microtasks to flush 'await tempBook.loaded.metadata'
    expect(title0.textContent).toBe('Mock Title');

    // library opened
    const container = document.getElementById('library-container');
    const overlay = document.getElementById('overlay');
    expect(container.classList.contains('open')).toBe(true);
    expect(overlay.classList.contains('open')).toBe(true);
  });

  test('falls back to placeholder when no cover URL', async () => {
    // Arrange epub mock to return null cover for next invocation
    ePub.__makeNext(() => ({
      coverUrl: jest.fn().mockResolvedValue(null),
      loaded: { metadata: Promise.resolve({ title: 'No Cover Title' }) },
    }));

    const { handleLibraryFiles } = LibraryModule;
    const content = document.getElementById('library-content');
    const f = makeFile('no-cover.epub');

    await handleLibraryFiles({ target: { files: [f] } });

    const img = content.querySelector('img.library-cover');
    expect(img).toBeTruthy();
    expect(img.src.startsWith('data:image/png;base64,')).toBe(true);

    const title = content.querySelector('.library-title');
    await Promise.resolve();
    expect(title.textContent).toBe('No Cover Title');
  });

  test('gracefully logs and keeps default title on processing error', async () => {
    // Force ePub to throw for this call
    const thrown = new Error('epub parse failed');
    ePub.__makeNext(() => {
      throw thrown;
    });

    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { handleLibraryFiles } = LibraryModule;
    const content = document.getElementById('library-content');
    const f = makeFile('bad.epub');

    await handleLibraryFiles({ target: { files: [f] } });

    const item = content.querySelector('.library-item');
    const title = item.querySelector('.library-title');
    // Title should remain file name since metadata could not be read
    expect(title.textContent).toBe('bad.epub');
    expect(spy).toHaveBeenCalledWith(
      'Error loading cover for',
      'bad.epub',
      thrown
    );
    spy.mockRestore();
  });

  test('clicking an item invokes openBookFromEntry with original file', async () => {
    const { handleLibraryFiles } = LibraryModule;
    const content = document.getElementById('library-content');

    const fileObj = makeFile('clickable.epub');
    await handleLibraryFiles({ target: { files: [fileObj] } });

    const item = content.querySelector('.library-item');
    expect(item).toBeTruthy();

    item.click();
    expect(openBookFromEntry).toHaveBeenCalledTimes(1);
    expect(openBookFromEntry).toHaveBeenCalledWith(fileObj);
  });
});

describe('openLibrary', () => {
  test('uses stored directory handle when available, filters to .epub, displays items, toggles open', async () => {
    const { openLibrary } = LibraryModule;

    // prepare directory with mixed entries
    const epub1 = makeFSFileEntry('a.epub', makeFile('a.epub'));
    const txt = { kind: 'file', name: 'notes.txt' }; // should be ignored
    const epub2 = makeFSFileEntry('b.epub', makeFile('b.epub'));
    const dirHandle = makeDirHandle([epub1, txt, epub2]);

    getStoredLibraryHandle.mockResolvedValue(dirHandle);

    await openLibrary();

    // only 2 epub files should render
    const items = document.querySelectorAll('#library-content .library-item');
    expect(items.length).toBe(2);

    // toggled open
    expect(document.getElementById('library-container').classList.contains('open')).toBe(true);
    expect(document.getElementById('overlay').classList.contains('open')).toBe(true);

    // showDirectoryPicker should not be called when stored handle exists
    expect(global.window.showDirectoryPicker).toBeUndefined();
    expect(storeLibraryHandle).not.toHaveBeenCalled();
  });

  test('prompts for directory when no stored handle, stores it, displays empty state when no epubs', async () => {
    const { openLibrary } = LibraryModule;

    getStoredLibraryHandle.mockResolvedValue(null);

    // Mock showDirectoryPicker on window
    const emptyDir = makeDirHandle([]); // no entries
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      writable: true,
      value: jest.fn().mockResolvedValue(emptyDir),
    });

    await openLibrary();

    expect(window.showDirectoryPicker).toHaveBeenCalledTimes(1);
    expect(storeLibraryHandle).toHaveBeenCalledWith(emptyDir);

    const content = document.getElementById('library-content');
    expect(content.textContent).toContain('No EPUB files found.');

    expect(document.getElementById('library-container').classList.contains('open')).toBe(true);
    expect(document.getElementById('overlay').classList.contains('open')).toBe(true);
  });

  test('reports error via showError if opening library fails (e.g., permission denied)', async () => {
    const { openLibrary } = LibraryModule;

    const err = new Error('Permission denied');
    getStoredLibraryHandle.mockRejectedValue(err);

    await openLibrary();

    expect(showError).toHaveBeenCalledTimes(1);
    expect(showError).toHaveBeenCalledWith('Failed to open library: ' + err.message);

    // should not throw
    await expect(openLibrary()).resolves.toBeUndefined();
  });
});