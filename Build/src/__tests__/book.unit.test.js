/* @jest-environment jsdom */
/*
  Test suite for Build/src/book.js
  Testing library/framework: Jest (jsdom environment)
  - Mocks external dependencies: 'epubjs', '../main', '../library' (virtual mocks to avoid requiring real files)
  - Covers: openBook, openBookFromEntry, prevPage, nextPage, goToPage, toggleToc, closeToc
  - Scenarios: happy paths, invalid inputs, FileReader failure, metadata fallbacks, TOC building, key handlers
*/

const mockShowLoading = jest.fn();
const mockHideLoading = jest.fn();
const mockShowError = jest.fn();
const mockToggleLibrary = jest.fn();

// Provide virtual mocks for companion modules that may not exist physically in the repo
jest.mock('../main', () => ({
  __esModule: true,
  showLoading: (...a) => mockShowLoading(...a),
  hideLoading: (...a) => mockHideLoading(...a),
  showError:   (...a) => mockShowError(...a),
}), { virtual: true });

jest.mock('../library', () => ({
  __esModule: true,
  toggleLibrary: (...a) => mockToggleLibrary(...a),
}), { virtual: true });

// Mock epubjs default export (virtual to avoid resolving real package)
let epubDefaultMock;
jest.mock('epubjs', () => {
  epubDefaultMock = jest.fn();
  return { __esModule: true, default: (...args) => epubDefaultMock(...args) };
}, { virtual: true });

const mockRenderOn = {};
const renditionMockFactory = () => {
  const calls = { relocatedCb: null };
  return {
    calls,
    instance: {
      display: jest.fn(() => Promise.resolve()),
      prev: jest.fn(),
      next: jest.fn(),
      on: jest.fn((event, cb) => {
        mockRenderOn[event] = cb;
        if (event === 'relocated') {
          calls.relocatedCb = cb;
        }
      }),
    },
  };
};

function setupDom() {
  document.body.innerHTML = `
    <button id="toc-button" disabled></button>
    <button id="prev-button" disabled></button>
    <button id="next-button" disabled></button>
    <input id="current-page" value="1" />
    <div id="overlay" class=""></div>
    <span id="total-pages"></span>
    <span id="book-title"></span>
    <div id="toc-container" class=""></div>
    <div id="toc-content"></div>
    <div id="viewer"></div>
  `;
}

function makeBookMock({
  withTitle = 'Test Title',
  metadataReject = false,
  tocItems = [{ label: 'Chapter 1', href: 'chap1.xhtml' }],
  totalPages = 123
} = {}) {
  const { instance: rendition, calls } = renditionMockFactory();

  const book = {
    ready: Promise.resolve(),
    renderTo: jest.fn(() => rendition),
    loaded: {
      metadata: metadataReject
        ? Promise.reject(new Error('meta-fail'))
        : Promise.resolve(withTitle === null ? {} : { title: withTitle }),
    },
    navigation: {
      toc: tocItems, // synchronous array access as used by the SUT
    },
    locations: {
      generate: jest.fn(() => Promise.resolve()),
      length: jest.fn(() => totalPages),
      cfiFromLocation: jest.fn((n) => `cfi-${n}`),
      locationFromCfi: jest.fn(() => 41), // page index 41 -> UI displays 42
    },
  };

  epubDefaultMock.mockReturnValue(book);
  return { book, rendition, calls };
}

// Minimal FileReader mock to orchestrate success/error flows.
// The SUT never inspects the file contents beyond passing it to FileReader.
class MockFileReader {
  constructor() {
    this.onload = null;
    this.onerror = null;
  }
  readAsArrayBuffer(_file) {
    setTimeout(() => {
      this.onload && this.onload({ target: { result: new ArrayBuffer(8) } });
    }, 0);
  }
}
function installFileReader() {
  global.FileReader = MockFileReader;
}

// Import SUT after DOM is ready since it queries elements at module scope
async function importSut() {
  const mod = await import('../book.js');
  return mod;
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  setupDom();
  installFileReader();
});

describe('openBook()', () => {
  test('rejects invalid file type/extension and shows error', async () => {
    const { openBook } = await importSut();

    const badFile = { name: 'not-epub.pdf', type: 'application/pdf' };
    openBook({ target: { files: [badFile] } });

    expect(mockShowError).toHaveBeenCalledWith('The selected file is not a valid EPUB file.');
    expect(epubDefaultMock).not.toHaveBeenCalled();
    expect(mockShowLoading).not.toHaveBeenCalled();
  });

  test('accepts valid .epub extension even with non-standard MIME', async () => {
    makeBookMock({ withTitle: 'Ext OK' });
    const { openBook } = await importSut();

    const fileByExt = { name: 'book.epub', type: 'application/octet-stream' };
    openBook({ target: { files: [fileByExt] } });

    await new Promise(r => setTimeout(r, 10));
    expect(epubDefaultMock).toHaveBeenCalled();
    expect(mockShowError).not.toHaveBeenCalled();
    expect(document.getElementById('book-title').textContent).toBe('Ext OK');
  });

  test('returns early when no file selected', async () => {
    const { openBook } = await importSut();
    openBook({ target: { files: [] } });
    expect(mockShowLoading).not.toHaveBeenCalled();
    expect(mockShowError).not.toHaveBeenCalled();
  });

  test('handles FileReader error by hiding loader and showing error', async () => {
    class ErrorFileReader extends MockFileReader {
      readAsArrayBuffer() {
        setTimeout(() => {
          this.onerror && this.onerror({ target: { error: 'boom' } });
        }, 0);
      }
    }
    global.FileReader = ErrorFileReader;

    const { openBook } = await importSut();

    const okFile = { name: 'book.epub', type: 'application/epub+zip' };
    openBook({ target: { files: [okFile] } });

    await new Promise(r => setTimeout(r, 5));

    expect(mockHideLoading).toHaveBeenCalled();
    expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Error reading file:'));
  });

  test('successfully loads book: enables UI, builds TOC, sets title and total pages', async () => {
    const { rendition } = makeBookMock({
      withTitle: 'Great Book',
      tocItems: [{ label: 'Intro', href: 'intro.xhtml' }, { label: 'Ch 1', href: 'ch1.xhtml' }],
      totalPages: 50
    });

    const { openBook } = await importSut();
    const goodFile = { name: 'book.epub', type: 'application/epub+zip' };
    openBook({ target: { files: [goodFile] } });

    await new Promise(r => setTimeout(r, 10));

    expect(mockShowLoading).toHaveBeenCalled();
    expect(mockHideLoading).toHaveBeenCalled();
    expect(epubDefaultMock).toHaveBeenCalled();

    expect(document.getElementById('prev-button').disabled).toBe(false);
    expect(document.getElementById('next-button').disabled).toBe(false);
    expect(document.getElementById('toc-button').disabled).toBe(false);

    expect(document.getElementById('book-title').textContent).toBe('Great Book');

    const tocContent = document.getElementById('toc-content');
    expect(tocContent.children).toHaveLength(2);
    expect(tocContent.children[0].textContent).toBe('Intro');

    // Open classes present, clicking TOC item should close TOC and call display with href
    document.getElementById('toc-container').classList.add('open');
    document.getElementById('overlay').classList.add('open');
    tocContent.children[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rendition.display).toHaveBeenCalledWith('intro.xhtml');
    expect(document.getElementById('toc-container').classList.contains('open')).toBe(false);
    expect(document.getElementById('overlay').classList.contains('open')).toBe(false);

    expect(document.getElementById('total-pages').textContent).toBe('50');
  });

  test('falls back to "Untitled EPUB" when metadata.title missing', async () => {
    makeBookMock({ withTitle: null });

    const { openBook } = await importSut();
    const goodFile = { name: 'book.epub', type: 'application/epub+zip' };
    openBook({ target: { files: [goodFile] } });

    await new Promise(r => setTimeout(r, 10));
    expect(document.getElementById('book-title').textContent).toBe('Untitled EPUB');
  });

  test('falls back to "EPUB Book" when metadata load fails', async () => {
    makeBookMock({ metadataReject: true });

    const { openBook } = await importSut();
    const goodFile = { name: 'book.epub', type: 'application/epub+zip' };
    openBook({ target: { files: [goodFile] } });

    await new Promise(r => setTimeout(r, 10));
    expect(document.getElementById('book-title').textContent).toBe('EPUB Book');
  });
});

describe('openBookFromEntry()', () => {
  test('closes library, shows loader, loads book, wires key handlers (happy path)', async () => {
    const { rendition } = makeBookMock();

    const { openBookFromEntry } = await importSut();

    const entry = {
      getFile: jest.fn(async () => ({
        arrayBuffer: async () => new ArrayBuffer(4),
      })),
    };

    await openBookFromEntry(entry);

    expect(mockToggleLibrary).toHaveBeenCalledWith(false);
    expect(mockShowLoading).toHaveBeenCalled();
    expect(mockHideLoading).toHaveBeenCalled();

    // Simulate relocated -> should update current-page field to 42 (41 + 1)
    if (mockRenderOn['relocated']) {
      mockRenderOn['relocated']({ start: { cfi: 'cfi-41' } });
    }
    expect(document.getElementById('current-page').value).toBe('42');

    // Key handlers trigger pagination
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }));
    expect(rendition.prev).toHaveBeenCalled();
    expect(rendition.next).toHaveBeenCalled();
  });

  test('on failure, reopens library and shows error', async () => {
    makeBookMock();

    const { openBookFromEntry } = await importSut();

    const entry = {
      getFile: jest.fn(async () => { throw new Error('nope'); }),
    };

    await openBookFromEntry(entry);

    expect(mockToggleLibrary).toHaveBeenCalledWith(false);
    expect(mockToggleLibrary).toHaveBeenCalledWith(true);
    expect(mockShowLoading).toHaveBeenCalled();
    expect(mockHideLoading).toHaveBeenCalled();
    expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Error opening book:'));
  });
});

describe('pagination helpers', () => {
  test('prevPage/nextPage are no-ops when rendition is not initialized', async () => {
    const { prevPage, nextPage } = await importSut();
    expect(() => prevPage()).not.toThrow();
    expect(() => nextPage()).not.toThrow();
  });

  test('goToPage displays correct CFI within bounds; ignores out-of-bounds and NaN', async () => {
    const { book, rendition } = makeBookMock({ totalPages: 10 });
    const { openBookFromEntry, goToPage } = await importSut();

    const entry = {
      getFile: jest.fn(async () => ({
        arrayBuffer: async () => new ArrayBuffer(4),
      })),
    };
    await openBookFromEntry(entry);

    const currentPageInput = document.getElementById('current-page');

    // Valid page (3 -> index 2)
    currentPageInput.value = '3';
    goToPage();
    expect(book.locations.cfiFromLocation).toHaveBeenCalledWith(2);
    expect(rendition.display).toHaveBeenCalledWith('cfi-2');

    // Out of range (0)
    currentPageInput.value = '0';
    rendition.display.mockClear();
    goToPage();
    expect(rendition.display).not.toHaveBeenCalled();

    // Out of range (too big)
    currentPageInput.value = '999';
    goToPage();
    expect(rendition.display).not.toHaveBeenCalled();

    // NaN input
    currentPageInput.value = 'abc';
    goToPage();
    expect(rendition.display).not.toHaveBeenCalled();
  });
});

describe('TOC toggling', () => {
  test('toggleToc toggles classes on container and overlay', async () => {
    const { toggleToc } = await importSut();
    const toc = document.getElementById('toc-container');
    const overlay = document.getElementById('overlay');
    expect(toc.classList.contains('open')).toBe(false);
    expect(overlay.classList.contains('open')).toBe(false);

    toggleToc();
    expect(toc.classList.contains('open')).toBe(true);
    expect(overlay.classList.contains('open')).toBe(true);

    toggleToc();
    expect(toc.classList.contains('open')).toBe(false);
    expect(overlay.classList.contains('open')).toBe(false);
  });

  test('closeToc removes open classes', async () => {
    const { closeToc } = await importSut();
    const toc = document.getElementById('toc-container');
    const overlay = document.getElementById('overlay');

    toc.classList.add('open');
    overlay.classList.add('open');

    closeToc();
    expect(toc.classList.contains('open')).toBe(false);
    expect(overlay.classList.contains('open')).toBe(false);
  });
});