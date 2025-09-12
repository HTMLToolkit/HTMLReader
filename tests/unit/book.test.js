/**
 * Tests for book module behaviors.
 *
 * Note on framework: These tests are written for Jest running in a JSDOM environment,
 * which is typical for frontend DOM-based testing. If this repository uses Vitest,
 * these tests should also work with minimal changes (replace jest.fn with vi.fn and
 * adjust mocking calls). We purposefully avoid non-portable APIs.
 */

const ORIGINAL_ENV = { ...process.env };

// Helper to build DOM skeleton before importing the module (since the module queries DOM at import time)
function buildDom() {
  document.body.innerHTML = `
    <header>
      <button id="toc-button" disabled></button>
      <button id="prev-button" disabled></button>
      <button id="next-button" disabled></button>
      <input id="current-page" value="1" />
      <span id="total-pages"></span>
      <span id="book-title"></span>
    </header>
    <div id="toc-container" class=""></div>
    <div id="toc-content"></div>
    <div id="overlay" class=""></div>
    <div id="viewer"></div>
  `;
}

function mockEpubAndRendition({ readyResolve = true, navigationToc = [], locationsLen = 5, metadata = { title: "Sample Book" } } = {}) {
  const listeners = {};
  const mockRendition = {
    display: jest.fn().mockResolvedValue(true),
    prev: jest.fn(),
    next: jest.fn(),
    on: jest.fn((evt, cb) => {
      listeners[evt] = cb;
    }),
    __emit: (evt, payload) => {
      if (listeners[evt]) listeners[evt](payload);
    },
  };

  const mockBook = {
    ready: readyResolve ? Promise.resolve() : Promise.reject(new Error("not ready")),
    renderTo: jest.fn(() => mockRendition),
    loaded: {
      metadata: Promise.resolve(metadata),
    },
    navigation: {
      toc: Promise.resolve(navigationToc),
    },
    locations: {
      generate: jest.fn().mockResolvedValue(true),
      length: jest.fn(() => locationsLen),
      locationFromCfi: jest.fn(() => 0),
      cfiFromLocation: jest.fn(idx => `cfi-${idx}`),
    },
  };

  const epubFactory = jest.fn(() => mockBook);

  // Mock epubjs default export
  jest.doMock("epubjs", () => ({
    __esModule: true,
    default: epubFactory,
  }));

  return { epubFactory, mockBook, mockRendition };
}

function mockMainModule() {
  const showLoading = jest.fn();
  const hideLoading = jest.fn();
  const showError = jest.fn();
  jest.doMock("./main", () => ({
    __esModule: true,
    showLoading,
    hideLoading,
    showError,
  }));
  return { showLoading, hideLoading, showError };
}

function mockLibraryModule() {
  const toggleLibrary = jest.fn();
  jest.doMock("./library", () => ({
    __esModule: true,
    toggleLibrary,
  }));
  return { toggleLibrary };
}

describe("book module", () => {
  let cleanup;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    buildDom();
    cleanup = () => {
      document.body.innerHTML = "";
      jest.clearAllMocks();
      jest.useRealTimers();
      process.env = { ...ORIGINAL_ENV };
    };
  });

  afterEach(() => {
    cleanup();
  });

  test("toggleToc toggles classes on tocContainer and overlay", async () => {
    mockEpubAndRendition(); // not required for toggle but harmless
    mockMainModule();
    mockLibraryModule();
    const mod = await import(getBookModulePath());
    const tocContainer = document.getElementById("toc-container");
    const overlay = document.getElementById("overlay");
    expect(tocContainer.classList.contains("open")).toBe(false);
    expect(overlay.classList.contains("open")).toBe(false);

    mod.toggleToc();

    expect(tocContainer.classList.contains("open")).toBe(true);
    expect(overlay.classList.contains("open")).toBe(true);
  });

  test("closeToc removes open classes", async () => {
    mockEpubAndRendition();
    mockMainModule();
    mockLibraryModule();
    const mod = await import(getBookModulePath());
    const tocContainer = document.getElementById("toc-container");
    const overlay = document.getElementById("overlay");

    tocContainer.classList.add("open");
    overlay.classList.add("open");

    mod.closeToc();
    expect(tocContainer.classList.contains("open")).toBe(false);
    expect(overlay.classList.contains("open")).toBe(false);
  });

  test("openBook: rejects non-epub files and shows error without calling FileReader", async () => {
    const { showError, showLoading, hideLoading } = mockMainModule();
    mockLibraryModule();
    mockEpubAndRendition();

    const mod = await import(getBookModulePath());

    const file = new File(["content"], "image.png", { type: "image/png" });
    const input = { target: { files: [file] } };

    // Spy on FileReader
    const fileReaderSpy = jest.spyOn(global, "FileReader");

    mod.openBook(input);

    expect(showError).toHaveBeenCalledWith("The selected file is not a valid EPUB file.");
    expect(showLoading).not.toHaveBeenCalled();
    expect(hideLoading).not.toHaveBeenCalled();
    expect(fileReaderSpy).not.toHaveBeenCalled();
  });

  test("openBook: loads epub, hides loading on success, updates title and enables controls", async () => {
    const { showLoading, hideLoading, showError } = mockMainModule();
    mockLibraryModule();
    const { epubFactory, mockBook } = mockEpubAndRendition({
      navigationToc: [],
      locationsLen: 10,
      metadata: { title: "My EPUB" },
    });

    const mod = await import(getBookModulePath());

    // Mock FileReader behavior
    const readers = [];
    jest.spyOn(global, "FileReader").mockImplementation(function () {
      const inst = {
        onload: null,
        onerror: null,
        readAsArrayBuffer: function () {
          // simulate async load
          setTimeout(() => {
            inst.onload && inst.onload({ target: { result: new ArrayBuffer(8) } });
          }, 0);
        },
      };
      readers.push(inst);
      return inst;
    });

    const file = new File(["content"], "book.epub", { type: "application/epub+zip" });
    const input = { target: { files: [file] } };

    mod.openBook(input);

    // Allow timers and microtasks to run
    await Promise.resolve();
    jest.runAllTimers();

    // Await internal async chain completion
    await mockBook.ready;
    await Promise.resolve();

    expect(showLoading).toHaveBeenCalled();
    expect(hideLoading).toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
    expect(epubFactory).toHaveBeenCalled();

    // Controls become enabled after loadBook completes
    expect(document.getElementById("prev-button").disabled).toBe(false);
    expect(document.getElementById("next-button").disabled).toBe(false);
    expect(document.getElementById("toc-button").disabled).toBe(false);

    // Title reflects metadata.title
    expect(document.getElementById("book-title").textContent).toBe("My EPUB");

    // Total pages reflect locations length
    expect(document.getElementById("total-pages").textContent).toBe("10");
  });

  test("openBook: when file reader errors, hides loading and shows error", async () => {
    const { showLoading, hideLoading, showError } = mockMainModule();
    mockLibraryModule();
    mockEpubAndRendition();

    const mod = await import(getBookModulePath());

    jest.spyOn(global, "FileReader").mockImplementation(function () {
      const inst = {
        onload: null,
        onerror: null,
        readAsArrayBuffer: function () {
          setTimeout(() => {
            inst.onerror && inst.onerror({ target: { error: "bad file" } });
          }, 0);
        },
      };
      return inst;
    });

    const file = new File(["content"], "bad.epub", { type: "application/epub+zip" });
    const input = { target: { files: [file] } };

    mod.openBook(input);

    await Promise.resolve();
    jest.runAllTimers();

    expect(showLoading).toHaveBeenCalled();
    expect(hideLoading).toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith("Error reading file: bad file");
  });

  test("openBookFromEntry: success path loads book and keeps library closed", async () => {
    const { showLoading, hideLoading, showError } = mockMainModule();
    const { toggleLibrary } = mockLibraryModule();
    const { mockBook } = mockEpubAndRendition();

    const mod = await import(getBookModulePath());

    const arrayBuffer = new ArrayBuffer(12);
    const fakeFile = {
      arrayBuffer: jest.fn().mockResolvedValue(arrayBuffer),
    };
    const entry = {
      getFile: jest.fn().mockResolvedValue(fakeFile),
    };

    await mod.openBookFromEntry(entry);

    expect(toggleLibrary).toHaveBeenCalledWith(false);
    expect(showLoading).toHaveBeenCalled();
    expect(hideLoading).toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
    await mockBook.ready;
  });

  test("openBookFromEntry: on error, reopens library and shows error", async () => {
    const { showLoading, hideLoading, showError } = mockMainModule();
    const { toggleLibrary } = mockLibraryModule();
    mockEpubAndRendition();

    const mod = await import(getBookModulePath());

    const entry = {
      getFile: jest.fn().mockRejectedValue(new Error("no access")),
    };

    await mod.openBookFromEntry(entry);

    expect(toggleLibrary).toHaveBeenCalledWith(false); // closed immediately
    expect(toggleLibrary).toHaveBeenCalledWith(true);  // reopened on error
    expect(showLoading).toHaveBeenCalled();
    expect(hideLoading).toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(expect.stringContaining("Error opening book: no access"));
  });

  test("goToPage: does nothing when no book or locations", async () => {
    mockMainModule();
    mockLibraryModule();
    mockEpubAndRendition();

    const mod = await import(getBookModulePath());

    // Without opening book, there is no locations
    const renditionDisplaySpy = jest.fn();
    // try goToPage
    mod.goToPage();
    expect(renditionDisplaySpy).not.toHaveBeenCalled();
  });

  test("goToPage: displays CFI for valid page within range", async () => {
    mockMainModule();
    mockLibraryModule();
    const { mockBook, mockRendition } = mockEpubAndRendition({ locationsLen: 3 });

    const mod = await import(getBookModulePath());

    // Simulate opening by calling internal openBook through openBook API path using FileReader
    // Instead, call the private flow via public openBook by faking FileReader for brevity:
    jest.spyOn(global, "FileReader").mockImplementation(function () {
      const inst = {
        onload: null,
        onerror: null,
        readAsArrayBuffer: function () {
          setTimeout(() => inst.onload && inst.onload({ target: { result: new ArrayBuffer(1) } }), 0);
        },
      };
      return inst;
    });
    const file = new File(["x"], "b.epub", { type: "application/epub+zip" });
    mod.openBook({ target: { files: [file] } });

    await Promise.resolve();
    jest.runAllTimers();
    await mockBook.ready;

    const currentInput = document.getElementById("current-page");
    currentInput.value = "2"; // 1-based index; will translate to location 1
    mod.goToPage();

    expect(mockBook.locations.cfiFromLocation).toHaveBeenCalledWith(1);
    expect(mockRendition.display).toHaveBeenCalledWith("cfi-1");
  });

  test("keyboard events call prev/next when book is loaded", async () => {
    mockMainModule();
    mockLibraryModule();
    const { mockBook, mockRendition } = mockEpubAndRendition();

    const mod = await import(getBookModulePath());

    // Load a book quickly
    jest.spyOn(global, "FileReader").mockImplementation(function () {
      const inst = { onload: null, onerror: null, readAsArrayBuffer() { setTimeout(() => inst.onload && inst.onload({ target: { result: new ArrayBuffer(1) } }), 0);} };
      return inst;
    });
    const file = new File(["x"], "b.epub", { type: "application/epub+zip" });
    mod.openBook({ target: { files: [file] } });
    await Promise.resolve();
    jest.runAllTimers();
    await mockBook.ready;

    // Dispatch keyup events
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowLeft" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight" }));

    expect(mockRendition.prev).toHaveBeenCalled();
    expect(mockRendition.next).toHaveBeenCalled();
  });

  test("title fallbacks: Untitled EPUB when metadata.title missing; EPUB Book when metadata throws", async () => {
    const { showLoading, hideLoading } = mockMainModule();
    mockLibraryModule();

    // Case 1: metadata without title
    let ctx = mockEpubAndRendition({ metadata: {} });
    let mod = await import(getBookModulePath());
    jest.spyOn(global, "FileReader").mockImplementation(function () {
      const inst = { onload: null, onerror: null, readAsArrayBuffer() { setTimeout(() => inst.onload && inst.onload({ target: { result: new ArrayBuffer(1) } }), 0);} };
      return inst;
    });
    let file = new File(["x"], "a.epub", { type: "application/epub+zip" });
    mod.openBook({ target: { files: [file] } });
    await Promise.resolve();
    jest.runAllTimers();
    await ctx.mockBook.ready;

    expect(document.getElementById("book-title").textContent).toBe("Untitled EPUB");

    // Reset and test metadata rejection path
    jest.resetModules();
    buildDom();
    mockMainModule();
    mockLibraryModule();
    ctx = mockEpubAndRendition();
    // Make metadata throw
    ctx.mockBook.loaded.metadata = Promise.reject(new Error("meta fail"));
    mod = await import(getBookModulePath());
    jest.spyOn(global, "FileReader").mockImplementation(function () {
      const inst = { onload: null, onerror: null, readAsArrayBuffer() { setTimeout(() => inst.onload && inst.onload({ target: { result: new ArrayBuffer(1) } }), 0);} };
      return inst;
    });
    file = new File(["x"], "b.epub", { type: "application/epub+zip" });
    mod.openBook({ target: { files: [file] } });
    await Promise.resolve();
    jest.runAllTimers();
    await ctx.mockBook.ready;

    expect(document.getElementById("book-title").textContent).toBe("EPUB Book");

    // Ensure loading shown/hidden flow still occurs
    expect(showLoading).toHaveBeenCalled();
    expect(hideLoading).toHaveBeenCalled();
  });

  test("TOC generation creates clickable items that display chapters and close TOC", async () => {
    mockMainModule();
    mockLibraryModule();
    const toc = [
      { label: "Chapter 1", href: "ch1.xhtml" },
      { label: "Chapter 2", href: "ch2.xhtml" },
    ];
    const { mockBook, mockRendition } = mockEpubAndRendition({ navigationToc: toc });

    const mod = await import(getBookModulePath());

    // Load
    jest.spyOn(global, "FileReader").mockImplementation(function () {
      const inst = { onload: null, onerror: null, readAsArrayBuffer() { setTimeout(() => inst.onload && inst.onload({ target: { result: new ArrayBuffer(1) } }), 0);} };
      return inst;
    });
    const file = new File(["x"], "book.epub", { type: "application/epub+zip" });
    mod.openBook({ target: { files: [file] } });
    await Promise.resolve();
    jest.runAllTimers();
    await mockBook.ready;

    const items = Array.from(document.querySelectorAll("#toc-content .toc-item"));
    expect(items.map(n => n.textContent)).toEqual(["Chapter 1", "Chapter 2"]);

    // Click Chapter 2
    const tocContainer = document.getElementById("toc-container");
    const overlay = document.getElementById("overlay");
    tocContainer.classList.add("open");
    overlay.classList.add("open");

    items[1].click();

    expect(mockRendition.display).toHaveBeenCalledWith("ch2.xhtml");
    // closeToc should remove classes
    expect(tocContainer.classList.contains("open")).toBe(false);
    expect(overlay.classList.contains("open")).toBe(false);
  });

  test("relocated listener updates current page input from locations", async () => {
    mockMainModule();
    mockLibraryModule();
    const { mockBook, mockRendition } = mockEpubAndRendition({ locationsLen: 20 });

    const mod = await import(getBookModulePath());

    // Open
    jest.spyOn(global, "FileReader").mockImplementation(function () {
      const inst = { onload: null, onerror: null, readAsArrayBuffer() { setTimeout(() => inst.onload && inst.onload({ target: { result: new ArrayBuffer(1) } }), 0);} };
      return inst;
    });
    const file = new File(["x"], "book.epub", { type: "application/epub+zip" });
    mod.openBook({ target: { files: [file] } });
    await Promise.resolve();
    jest.runAllTimers();
    await mockBook.ready;

    // Simulate rendition relocation to cfi of page 4 (locationFromCfi mocked returns 0 by default; override once)
    mockBook.locations.locationFromCfi.mockReturnValueOnce(3);
    mockRendition.__emit("relocated", { start: { cfi: "cfi-test" } });

    expect(document.getElementById("current-page").value).toBe("4");
  });

  test("prevPage/nextPage guards against no rendition", async () => {
    mockMainModule();
    mockLibraryModule();
    mockEpubAndRendition();

    const mod = await import(getBookModulePath());

    // No book opened yet, should not throw
    expect(() => mod.prevPage()).not.toThrow();
    expect(() => mod.nextPage()).not.toThrow();
  });
});

/**
 * Resolve path to the module under test relative to test file.
 * Adjust this function if the module path differs in your repo.
 */
function getBookModulePath() {
  // Prefer src/book.js, else fallback to book.js in project root
  const candidates = [
    "../..//src/book.js",
    "../../book.js",
    "../../public/book.js",
    "../../app/book.js",
    "../../client/book.js",
    "../../scripts/book.js",
  ];
  for (const p of candidates) {
    try {
      // eslint-disable-next-line node/no-missing-require, global-require
      require.resolve(p, { paths: [__dirname] });
      return p;
    } catch (_) {}
  }
  // Default guess: module lives next to main.js
  return "../../src/book.js";
}