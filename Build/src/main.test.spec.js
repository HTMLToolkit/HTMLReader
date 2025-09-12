/**
 * NOTE: Test framework: We use the repository's existing test runner.
 * - If Jest: relies on testEnvironment: 'jsdom'. If not set globally, add `@jest-environment jsdom` per-file.
 * - If Vitest: ensure `environment: 'jsdom'` or run with `vitest --environment jsdom`.
 *
 * These tests validate the DOM wiring and exported message helpers in Build/src/main.test.js (per PR diff).
 */

/// <reference lib="dom" />
/* eslint-disable no-undef */

let mod;
const makeEl = (id) => {
  const el = document.createElement('div');
  el.id = id;
  // Basic classList polyfill not needed in jsdom; ensure exists for safety
  if (!el.classList) {
    el.classList = {
      _set: new Set(),
      add: function (c) { this._set.add(c); el.setAttribute('class', Array.from(this._set).join(' ')); },
      remove: function (c) { this._set.delete(c); el.setAttribute('class', Array.from(this._set).join(' ')); },
      contains: function (c) { return this._set.has(c); }
    };
  }
  return el;
};

function setupDOM() {
  document.body.innerHTML = "";
  const ids = [
    'open-button','file-input','library-input','library-button','close-library',
    'toc-button','close-toc','prev-button','next-button','current-page',
    'overlay','loading-message','error-message','error-text','close-error'
  ];

  const fragment = document.createDocumentFragment();
  ids.forEach((id) => {
    let el;
    switch (id) {
      case 'file-input':
      case 'library-input': {
        el = document.createElement('input');
        el.type = 'file';
        break;
      }
      case 'current-page': {
        el = document.createElement('input');
        el.type = 'number';
        break;
      }
      case 'open-button':
      case 'library-button':
      case 'close-library':
      case 'toc-button':
      case 'close-toc':
      case 'prev-button':
      case 'next-button':
      case 'overlay':
      case 'close-error': {
        el = document.createElement(id === 'overlay' ? 'div' : 'button');
        break;
      }
      case 'loading-message':
      case 'error-message':
      case 'error-text': {
        el = document.createElement('div');
        break;
      }
      default:
        el = document.createElement('div');
    }
    el.id = id;
    fragment.appendChild(el);
  });
  document.body.appendChild(fragment);
}

const mockFns = {
  openBook: jest.fn(),
  prevPage: jest.fn(),
  nextPage: jest.fn(),
  goToPage: jest.fn(),
  toggleToc: jest.fn(),
  closeToc: jest.fn(),
  openLibrary: jest.fn(),
  handleLibraryFiles: jest.fn(),
  toggleLibrary: jest.fn(),
};

jest.mock("./book", () => ({
  openBook: (...args) => mockFns.openBook(...args),
  prevPage: (...args) => mockFns.prevPage(...args),
  nextPage: (...args) => mockFns.nextPage(...args),
  goToPage: (...args) => mockFns.goToPage(...args),
  toggleToc: (...args) => mockFns.toggleToc(...args),
  closeToc: (...args) => mockFns.closeToc(...args),
}));

jest.mock("./library", () => ({
  openLibrary: (...args) => mockFns.openLibrary(...args),
  handleLibraryFiles: (...args) => mockFns.handleLibraryFiles(...args),
  toggleLibrary: (...args) => mockFns.toggleLibrary(...args),
}));

/**
 * Dynamic import after DOM is ready, since module queries elements on import.
 */
async function importModule() {
  // Support both relative from test location and repo tooling transpilation
  // The file under test is Build/src/main.test.js (per diff). Adjust if relocated.
  return await import("./main.test.js");
}

beforeEach(async () => {
  jest.resetModules();
  Object.values(mockFns).forEach(fn => fn.mockClear());
  setupDOM();
  mod = await importModule();
});

describe("DOM event wiring for main UI", () => {
  test("clicking 'open-button' triggers file input click (no openBook yet)", () => {
    const fileInput = document.getElementById('file-input');
    const spyClick = jest.spyOn(fileInput, 'click');
    document.getElementById('open-button').click();
    expect(spyClick).toHaveBeenCalledTimes(1);
    expect(mockFns.openBook).not.toHaveBeenCalled(); // not until change event
  });

  test("changing file-input calls openBook", () => {
    const fileInput = document.getElementById('file-input');
    const event = new Event('change');
    fileInput.dispatchEvent(event);
    expect(mockFns.openBook).toHaveBeenCalledTimes(1);
  });

  test("prev/next buttons call navigation handlers", () => {
    document.getElementById('prev-button').click();
    document.getElementById('next-button').click();
    expect(mockFns.prevPage).toHaveBeenCalledTimes(1);
    expect(mockFns.nextPage).toHaveBeenCalledTimes(1);
  });

  test("changing current-page input calls goToPage", () => {
    const input = document.getElementById('current-page');
    input.value = "12";
    const event = new Event('change');
    input.dispatchEvent(event);
    expect(mockFns.goToPage).toHaveBeenCalledTimes(1);
  });

  test("toc open/close buttons both call toggleToc", () => {
    document.getElementById('toc-button').click();
    document.getElementById('close-toc').click();
    expect(mockFns.toggleToc).toHaveBeenCalledTimes(2);
  });

  test("library button opens library; close button toggles library off", () => {
    document.getElementById('library-button').click();
    expect(mockFns.openLibrary).toHaveBeenCalledTimes(1);

    document.getElementById('close-library').click();
    expect(mockFns.toggleLibrary).toHaveBeenCalledWith(false);
  });

  test("overlay click closes toc, library, and hides error", () => {
    const hideSpy = jest.spyOn(mod, 'hideError');
    document.getElementById('overlay').click();
    expect(mockFns.closeToc).toHaveBeenCalledTimes(1);
    expect(mockFns.toggleLibrary).toHaveBeenCalledWith(false);
    expect(hideSpy).toHaveBeenCalledTimes(1);
  });

  test("close error button hides error", () => {
    const hideSpy = jest.spyOn(mod, 'hideError');
    document.getElementById('close-error').click();
    expect(hideSpy).toHaveBeenCalledTimes(1);
  });

  test("library input change delegates to handleLibraryFiles (fallback multi-file import)", () => {
    const libInput = document.getElementById('library-input');
    libInput.dispatchEvent(new Event('change'));
    expect(mockFns.handleLibraryFiles).toHaveBeenCalledTimes(1);
  });
});

describe("Message helpers", () => {
  test("showLoading adds 'show' class; hideLoading removes it", () => {
    const el = document.getElementById('loading-message');
    expect(el.classList.contains('show')).toBe(false);
    mod.showLoading();
    expect(el.classList.contains('show')).toBe(true);
    mod.hideLoading();
    expect(el.classList.contains('show')).toBe(false);
  });

  test("showError sets message text and adds 'show' class", () => {
    const msg = "Something went wrong!";
    const errorMsg = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');
    expect(errorMsg.classList.contains('show')).toBe(false);
    expect(errorText.textContent).toBe("");
    mod.showError(msg);
    expect(errorText.textContent).toBe(msg);
    expect(errorMsg.classList.contains('show')).toBe(true);
  });

  test("hideError removes 'show' class from error message container", () => {
    const errorMsg = document.getElementById('error-message');
    errorMsg.classList.add('show');
    mod.hideError();
    expect(errorMsg.classList.contains('show')).toBe(false);
  });

  test("showError handles non-string inputs gracefully by coercion", () => {
    const errorText = document.getElementById('error-text');
    mod.showError(404);
    expect(errorText.textContent).toBe("404");
    mod.showError({ a: 1 });
    // Default coercion to string: [object Object]
    expect(errorText.textContent).toBe("[object Object]");
    mod.showError(null);
    expect(errorText.textContent).toBe("null");
  });
});

describe("Resilience to missing DOM elements", () => {
  test("if elements are absent, importing should not throw when functions are called", async () => {
    // Recreate environment with missing nodes for message helpers
    document.body.innerHTML = "";
    const ids = ['loading-message','error-message','error-text'];
    ids.forEach(id => {
      // Intentionally omit to simulate missing elements
      // No append
    });
    jest.resetModules();
    const localMod = await import("./main.test.js");

    // Calls should not throw even if classList/textContent are missing
    expect(() => localMod.showLoading()).not.toThrow();
    expect(() => localMod.hideLoading()).not.toThrow();
    expect(() => localMod.showError("x")).not.toThrow();
    expect(() => localMod.hideError()).not.toThrow();
  });
});