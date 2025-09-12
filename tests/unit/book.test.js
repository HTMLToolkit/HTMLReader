/**
 * Testing library/framework: Jest (expect/describe/test) with jsdom environment.
 * These tests validate the public interfaces and DOM interactions for the book module.
 *
 * If your project uses Vitest, these tests are largely compatible (minor API tweaks may be needed).
 */

jest.mock('epubjs', () => {
  // Mock ePub constructor returning a predictable book object used by loadBook()
  const mockLocations = {
    generate: jest.fn(() => Promise.resolve()),
    length: jest.fn(() => 42),
    cfiFromLocation: jest.fn((loc) => `epubcfi(/6/${loc})`),
    locationFromCfi: jest.fn(() => 3),
  };

  const mockNavigation = {
    toc: Promise.resolve([{ label: 'Chapter 1', href: 'ch1.xhtml' }]),
  };

  const mockBook = {
    ready: Promise.resolve(),
    renderTo: jest.fn(() => ({
      display: jest.fn(() => Promise.resolve()),
      on: jest.fn(),
      prev: jest.fn(),
      next: jest.fn(),
    })),
    loaded: { metadata: Promise.resolve({ title: 'Test Title' }) },
    locations: mockLocations,
    navigation: mockNavigation,
  };

  const ePub = jest.fn(() => mockBook);
  ePub.__mock = { mockBook, mockLocations };
  return { __esModule: true, default: ePub };
});

jest.mock('../../src/main', () => ({
  showLoading: jest.fn(),
  hideLoading: jest.fn(),
  showError: jest.fn(),
}));
jest.mock('../../src/library', () => ({
  toggleLibrary: jest.fn(),
}));

/**
 * Helper to inject required DOM nodes before importing the module under test.
 */
function setupDomSkeleton() {
  document.body.innerHTML = `
    <button id="toc-button" disabled></button>
    <button id="prev-button" disabled></button>
    <button id="next-button" disabled></button>
    <input id="current-page" value="1" />
    <div id="overlay"></div>
    <span id="total-pages"></span>
    <span id="book-title"></span>
    <div id="toc-container"></div>
    <div id="toc-content"></div>
    <div id="viewer"></div>
  `;
}

// FileReader mock to control onload/onerror behavior in openBook()
class MockFileReader {
  constructor() {
    this.onload = null;
    this.onerror = null;
  }
  readAsArrayBuffer(file) {
    // If test toggled error path, trigger onerror; else trigger onload
    if (file && file.__causeReadError) {
      this.onerror && this.onerror({ target: { error: 'boom' } });
    } else {
      const buf = new ArrayBuffer(8);
      this.onload && this.onload({ target: { result: buf } });
    }
  }
}

describe('book module', () => {
  let bookModule;
  let ePub;
  let mainMocks;
  let libMocks;

  beforeEach(async () => {
    jest.resetModules();
    setupDomSkeleton();
    global.FileReader = MockFileReader;

    // Re-require mocks to access instances
    ePub = (await import('epubjs')).default;
    mainMocks = await import('../../src/main');
    libMocks = await import('../../src/library');

    // Import module under test after DOM/mocks are set
    bookModule = await import('../../src/book.js');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('openBook', () => {
    test('shows error for non-EPUB file and does not read', () => {
      const file = new Blob(['not-epub'], { type: 'text/plain' });
      Object.defineProperty(file, 'name', { value: 'notes.txt' });
      const evt = { target: { files: [file] } };

      bookModule.openBook(evt);

      expect(mainMocks.showError).toHaveBeenCalledWith('The selected file is not a valid EPUB file.');
      expect(mainMocks.showLoading).not.toHaveBeenCalled();
    });

    test('no-op when no file is selected', () => {
      const evt = { target: { files: [] } };
      bookModule.openBook(evt);
      expect(mainMocks.showLoading).not.toHaveBeenCalled();
      expect(mainMocks.showError).not.toHaveBeenCalled();
    });

    test('reads EPUB, calls load flow, and hides loading on success', async () => {
      const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'application/epub+zip' });
      Object.defineProperty(file, 'name', { value: 'book.epub' });
      const evt = { target: { files: [file] } };

      bookModule.openBook(evt);

      // showLoading called before reading
      expect(mainMocks.showLoading).toHaveBeenCalled();

      // Allow microtasks to flush
      await Promise.resolve();
      await new Promise(setImmediate);

      // hideLoading called after loadBook resolves
      expect(mainMocks.hideLoading).toHaveBeenCalled();
      expect(mainMocks.showError).not.toHaveBeenCalled();
    });

    test('handles FileReader error path', async () => {
      const file = new Blob([new Uint8Array([9])], { type: 'application/epub+zip' });
      Object.defineProperty(file, 'name', { value: 'bad.epub' });
      // Signal our MockFileReader to emit an error
      Object.defineProperty(file, '__causeReadError', { value: true });
      const evt = { target: { files: [file] } };

      bookModule.openBook(evt);

      await Promise.resolve();

      expect(mainMocks.hideLoading).toHaveBeenCalled();
      expect(mainMocks.showError).toHaveBeenCalledWith(expect.stringContaining('Error reading file:'));
    });
  });

  describe('openBookFromEntry', () => {
    test('closes library, shows loading, loads and hides loading on success', async () => {
      const fakeFile = new Blob([new Uint8Array([1, 2])], { type: 'application/epub+zip' });
      fakeFile.arrayBuffer = jest.fn(async () => new ArrayBuffer(4));
      const entry = { getFile: jest.fn(async () => fakeFile) };

      await bookModule.openBookFromEntry(entry);

      expect(libMocks.toggleLibrary).toHaveBeenCalledWith(false);
      expect(mainMocks.showLoading).toHaveBeenCalled();
      expect(entry.getFile).toHaveBeenCalled();
      expect(fakeFile.arrayBuffer).toHaveBeenCalled();
      expect(mainMocks.hideLoading).toHaveBeenCalled();
      expect(libMocks.toggleLibrary).not.toHaveBeenCalledWith(true);
      expect(mainMocks.showError).not.toHaveBeenCalled();
    });

    test('reopens library and shows error on failure', async () => {
      const entry = { getFile: jest.fn(async () => { throw new Error('nope'); }) };

      await bookModule.openBookFromEntry(entry);

      expect(libMocks.toggleLibrary).toHaveBeenCalledWith(false);
      expect(libMocks.toggleLibrary).toHaveBeenCalledWith(true);
      expect(mainMocks.showError).toHaveBeenCalledWith(expect.stringContaining('Error opening book:'));
      expect(mainMocks.hideLoading).toHaveBeenCalled();
    });
  });

  describe('navigation controls', () => {
    test('prevPage and nextPage invoke rendition methods when initialized', async () => {
      // Trigger a minimal load to set up rendition
      const file = new Blob([new Uint8Array([1])], { type: 'application/epub+zip' });
      Object.defineProperty(file, 'name', { value: 'ok.epub' });
      bookModule.openBook({ target: { files: [file] } });
      await Promise.resolve();
      await new Promise(setImmediate);

      const { mockBook } = (await import('epubjs')).default.__mock;
      const rendition = mockBook.renderTo.mock.results[0].value;

      bookModule.prevPage();
      bookModule.nextPage();

      expect(rendition.prev).toHaveBeenCalled();
      expect(rendition.next).toHaveBeenCalled();
    });

    test('prevPage and nextPage are no-ops without rendition', () => {
      expect(() => bookModule.prevPage()).not.toThrow();
      expect(() => bookModule.nextPage()).not.toThrow();
    });
  });

  describe('goToPage', () => {
    test('no-op if no book or no locations', () => {
      const viewer = document.getElementById('viewer');
      expect(viewer).toBeTruthy();
      // Without loading a book, should do nothing
      expect(() => bookModule.goToPage()).not.toThrow();
    });

    test('navigates to valid page index and ignores out-of-range/invalid inputs', async () => {
      // Load book to initialize locations and rendition
      const file = new Blob([new Uint8Array([1])], { type: 'application/epub+zip' });
      Object.defineProperty(file, 'name', { value: 'ok.epub' });
      bookModule.openBook({ target: { files: [file] } });
      await Promise.resolve();
      await new Promise(setImmediate);

      const { mockBook } = (await import('epubjs')).default.__mock;
      const rendition = mockBook.renderTo.mock.results[0].value;

      // Valid page (1-based in input)
      const input = document.getElementById('current-page');
      input.value = '4';
      bookModule.goToPage();
      expect(mockBook.locations.cfiFromLocation).toHaveBeenCalledWith(3);
      expect(rendition.display).toHaveBeenCalledWith(expect.stringContaining('epubcfi('));

      // Invalid: non-numeric
      input.value = 'abc';
      rendition.display.mockClear();
      bookModule.goToPage();
      expect(rendition.display).not.toHaveBeenCalled();

      // Out of range: 0
      input.value = '0';
      rendition.display.mockClear();
      bookModule.goToPage();
      expect(rendition.display).not.toHaveBeenCalled();

      // Out of range: > length
      input.value = '999';
      rendition.display.mockClear();
      bookModule.goToPage();
      expect(rendition.display).not.toHaveBeenCalled();
    });
  });

  describe('TOC toggles', () => {
    test('toggleToc toggles open class on container and overlay', () => {
      const toc = document.getElementById('toc-container');
      const overlay = document.getElementById('overlay');
      expect(toc.classList.contains('open')).toBe(false);
      expect(overlay.classList.contains('open')).toBe(false);

      bookModule.toggleToc();

      expect(toc.classList.contains('open')).toBe(true);
      expect(overlay.classList.contains('open')).toBe(true);

      bookModule.toggleToc();

      expect(toc.classList.contains('open')).toBe(false);
      expect(overlay.classList.contains('open')).toBe(false);
    });

    test('closeToc removes open class', () => {
      const toc = document.getElementById('toc-container');
      const overlay = document.getElementById('overlay');
      toc.classList.add('open');
      overlay.classList.add('open');

      bookModule.closeToc();

      expect(toc.classList.contains('open')).toBe(false);
      expect(overlay.classList.contains('open')).toBe(false);
    });
  });

  describe('load side-effects', () => {
    test('enables navigation buttons and sets book title', async () => {
      const file = new Blob([new Uint8Array([1])], { type: 'application/epub+zip' });
      Object.defineProperty(file, 'name', { value: 'ok.epub' });
      bookModule.openBook({ target: { files: [file] } });
      await Promise.resolve();
      await new Promise(setImmediate);

      const prev = document.getElementById('prev-button');
      const next = document.getElementById('next-button');
      const tocBtn = document.getElementById('toc-button');
      const title = document.getElementById('book-title');
      const totalPages = document.getElementById('total-pages');

      expect(prev.disabled).toBe(false);
      expect(next.disabled).toBe(false);
      expect(tocBtn.disabled).toBe(false);
      expect(title.textContent).toBe('Test Title');
      expect(totalPages.textContent).toBe('42');
    });

    test('falls back to default titles on metadata errors', async () => {
      // Reconfigure epubjs mock to reject metadata
      jest.resetModules();
      setupDomSkeleton();
      global.FileReader = MockFileReader;

      jest.doMock('epubjs', () => {
        const mockLocations = {
          generate: jest.fn(() => Promise.resolve()),
          length: jest.fn(() => 1),
          cfiFromLocation: jest.fn((loc) => `epubcfi(/6/${loc})`),
          locationFromCfi: jest.fn(() => 0),
        };
        const mockBook = {
          ready: Promise.resolve(),
          renderTo: jest.fn(() => ({
            display: jest.fn(() => Promise.resolve()),
            on: jest.fn(),
            prev: jest.fn(),
            next: jest.fn(),
          })),
          loaded: { metadata: Promise.reject(new Error('meta fail')) },
          locations: mockLocations,
          navigation: { toc: Promise.resolve([]) },
        };
        const ePub = jest.fn(() => mockBook);
        ePub.__mock = { mockBook, mockLocations };
        return { __esModule: true, default: ePub };
      });

      const mainMocks2 = await import('../../src/main');
      await import('../../src/library');
      const mod = await import('../../src/book.js');

      const file = new Blob([new Uint8Array([1])], { type: 'application/epub+zip' });
      Object.defineProperty(file, 'name', { value: 'ok.epub' });

      mod.openBook({ target: { files: [file] } });
      await Promise.resolve();
      await new Promise(setImmediate);

      const title = document.getElementById('book-title');
      expect(title.textContent).toBe('EPUB Book');
      expect(mainMocks2.showLoading).toHaveBeenCalled();
      expect(mainMocks2.hideLoading).toHaveBeenCalled();
    });
  });

  describe('TOC generation click behavior', () => {
    test('clicking a TOC item displays the href and closes overlay', async () => {
      // Load to trigger generateToc
      const file = new Blob([new Uint8Array([1])], { type: 'application/epub+zip' });
      Object.defineProperty(file, 'name', { value: 'ok.epub' });
      bookModule.openBook({ target: { files: [file] } });
      await Promise.resolve();
      await new Promise(setImmediate);

      const { mockBook } = (await import('epubjs')).default.__mock;
      const rendition = mockBook.renderTo.mock.results[0].value;

      const tocContent = document.getElementById('toc-content');
      expect(tocContent.children.length).toBeGreaterThanOrEqual(1);

      // Open overlay then click item to ensure closeToc is called
      const tocContainer = document.getElementById('toc-container');
      const overlay = document.getElementById('overlay');
      tocContainer.classList.add('open');
      overlay.classList.add('open');

      const first = tocContent.children[0];
      first.dispatchEvent(new Event('click', { bubbles: true }));

      expect(rendition.display).toHaveBeenCalledWith('ch1.xhtml');
      expect(tocContainer.classList.contains('open')).toBe(false);
      expect(overlay.classList.contains('open')).toBe(false);
    });
  });
});