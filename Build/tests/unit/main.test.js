/**
 * Unit tests for main UI wiring and helpers.
 *
 * Framework: Jest (jsdom environment)
 * These tests seed a minimal DOM, mock external modules, and then dynamically import the module-under-test
 * so that event listeners attach to the seeded elements.
 */

const resetDom = () => {
  document.body.innerHTML = `
    <button id="open-button"></button>
    <input id="file-input" type="file" />
    <input id="library-input" type="file" multiple />
    <button id="library-button"></button>
    <button id="close-library"></button>
    <button id="toc-button"></button>
    <button id="close-toc"></button>
    <button id="prev-button"></button>
    <button id="next-button"></button>
    <input id="current-page" />
    <div id="overlay"></div>
    <div id="loading-message" class=""></div>
    <div id="error-message" class="">
      <span id="error-text"></span>
      <button id="close-error"></button>
    </div>
  `;
};

// Jest ESM-compatible manual mocks via jest.unstable_mockModule if ESM is enabled in the repo.
// We provide both paths: if unstable_mockModule exists, use it; otherwise fall back to jest.mock.
const hasUnstableMockModule = typeof jest.unstable_mockModule === 'function';

const bookMocks = {
  openBook: jest.fn(),
  prevPage: jest.fn(),
  nextPage: jest.fn(),
  goToPage: jest.fn(),
  toggleToc: jest.fn(),
  closeToc: jest.fn(),
};

const libraryMocks = {
  openLibrary: jest.fn(),
  handleLibraryFiles: jest.fn(),
  toggleLibrary: jest.fn(),
};

const mockBookModule = () => {
  if (hasUnstableMockModule) {
    jest.unstable_mockModule('./book', () => bookMocks);
  } else {
    jest.mock('./book', () => bookMocks);
  }
};

const mockLibraryModule = () => {
  if (hasUnstableMockModule) {
    jest.unstable_mockModule('./library', () => libraryMocks);
  } else {
    jest.mock('./library', () => libraryMocks);
  }
};

describe('main UI event wiring and helpers', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    resetDom();
  });

  test('showLoading adds "show" class to #loading-message', async () => {
    mockBookModule();
    mockLibraryModule();
    const mod = hasUnstableMockModule
      ? await import('../../src/main.js').catch(async () => await import('../..//main.js')).catch(async () => await import('../../main.js'))
      : require('../../src/main.js');

    // Some repositories may place the file at different relative paths; try fallbacks
    const { showLoading } = mod || (await import('../../main.js'));

    const loading = document.getElementById('loading-message');
    expect(loading.classList.contains('show')).toBe(false);

    showLoading();
    expect(loading.classList.contains('show')).toBe(true);
  });

  test('hideLoading removes "show" class from #loading-message', async () => {
    mockBookModule();
    mockLibraryModule();
    const mod = hasUnstableMockModule
      ? await import('../../src/main.js').catch(async () => await import('../../main.js'))
      : require('../../src/main.js');

    const { showLoading, hideLoading } = mod || (await import('../../main.js'));

    const loading = document.getElementById('loading-message');
    showLoading();
    expect(loading.classList.contains('show')).toBe(true);

    hideLoading();
    expect(loading.classList.contains('show')).toBe(false);
  });

  test('showError sets text and shows the error panel; hideError hides it', async () => {
    mockBookModule();
    mockLibraryModule();
    const mod = hasUnstableMockModule
      ? await import('../../src/main.js').catch(async () => await import('../../main.js'))
      : require('../../src/main.js');

    const { showError, hideError } = mod || (await import('../../main.js'));

    const panel = document.getElementById('error-message');
    const text = document.getElementById('error-text');

    showError('Boom\!');
    expect(text.textContent).toBe('Boom\!');
    expect(panel.classList.contains('show')).toBe(true);

    hideError();
    expect(panel.classList.contains('show')).toBe(false);
  });

  test('showError handles empty/undefined message gracefully', async () => {
    mockBookModule();
    mockLibraryModule();
    const mod = hasUnstableMockModule
      ? await import('../../src/main.js').catch(async () => await import('../../main.js'))
      : require('../../src/main.js');

    const { showError } = mod || (await import('../../main.js'));
    const text = document.getElementById('error-text');

    expect(() => showError(undefined)).not.toThrow();
    expect(text.textContent).toBe(''); // undefined coerces to '' when set on textContent
  });

  test('overlay click closes toc, closes library, and hides error', async () => {
    mockBookModule();
    mockLibraryModule();
    const mod = hasUnstableMockModule
      ? await import('../../src/main.js').catch(async () => await import('../../main.js'))
      : require('../../src/main.js');

    const { showError } = mod || (await import('../../main.js'));

    // Pre-show error so we can observe hideError effect
    showError('Temporary');
    expect(document.getElementById('error-message').classList.contains('show')).toBe(true);

    document.getElementById('overlay').click();

    expect(bookMocks.closeToc).toHaveBeenCalledTimes(1);
    expect(libraryMocks.toggleLibrary).toHaveBeenCalledWith(false);
    expect(document.getElementById('error-message').classList.contains('show')).toBe(false);
  });

  test('open button triggers file input click', async () => {
    mockBookModule();
    mockLibraryModule();
    // Spy on click of file input
    const fileInput = document.getElementById('file-input');
    const clickSpy = jest.spyOn(fileInput, 'click');

    if (hasUnstableMockModule) {
      await import('../../src/main.js').catch(async () => await import('../../main.js'));
    } else {
      require('../../src/main.js');
    }

    document.getElementById('open-button').click();
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  test('file input change calls openBook', async () => {
    mockBookModule();
    mockLibraryModule();
    if (hasUnstableMockModule) {
      await import('../../src/main.js').catch(async () => await import('../../main.js'));
    } else {
      require('../../src/main.js');
    }
    const input = document.getElementById('file-input');
    input.dispatchEvent(new Event('change'));
    expect(bookMocks.openBook).toHaveBeenCalledTimes(1);
  });

  test('prev/next buttons call prevPage/nextPage', async () => {
    mockBookModule();
    mockLibraryModule();
    if (hasUnstableMockModule) {
      await import('../../src/main.js').catch(async () => await import('../../main.js'));
    } else {
      require('../../src/main.js');
    }
    document.getElementById('prev-button').click();
    document.getElementById('next-button').click();
    expect(bookMocks.prevPage).toHaveBeenCalledTimes(1);
    expect(bookMocks.nextPage).toHaveBeenCalledTimes(1);
  });

  test('current-page change calls goToPage', async () => {
    mockBookModule();
    mockLibraryModule();
    if (hasUnstableMockModule) {
      await import('../../src/main.js').catch(async () => await import('../../main.js'));
    } else {
      require('../../src/main.js');
    }
    const cp = document.getElementById('current-page');
    cp.value = '12';
    cp.dispatchEvent(new Event('change'));
    expect(bookMocks.goToPage).toHaveBeenCalledTimes(1);
  });

  test('toc open/close buttons call toggleToc', async () => {
    mockBookModule();
    mockLibraryModule();
    if (hasUnstableMockModule) {
      await import('../../src/main.js').catch(async () => await import('../../main.js'));
    } else {
      require('../../src/main.js');
    }
    document.getElementById('toc-button').click();
    document.getElementById('close-toc').click();
    expect(bookMocks.toggleToc).toHaveBeenCalledTimes(2);
  });

  test('library button opens library and close-library passes false to toggleLibrary', async () => {
    mockBookModule();
    mockLibraryModule();
    if (hasUnstableMockModule) {
      await import('../../src/main.js').catch(async () => await import('../../main.js'));
    } else {
      require('../../src/main.js');
    }
    document.getElementById('library-button').click();
    document.getElementById('close-library').click();

    expect(libraryMocks.openLibrary).toHaveBeenCalledTimes(1);
    expect(libraryMocks.toggleLibrary).toHaveBeenCalledWith(false);
  });

  test('fallback libraryInput change calls handleLibraryFiles', async () => {
    mockBookModule();
    mockLibraryModule();
    if (hasUnstableMockModule) {
      await import('../../src/main.js').catch(async () => await import('../../main.js'));
    } else {
      require('../../src/main.js');
    }
    const li = document.getElementById('library-input');
    li.dispatchEvent(new Event('change'));
    expect(libraryMocks.handleLibraryFiles).toHaveBeenCalledTimes(1);
  });

  test('close-error button hides error', async () => {
    mockBookModule();
    mockLibraryModule();
    const mod = hasUnstableMockModule
      ? await import('../../src/main.js').catch(async () => await import('../../main.js'))
      : require('../../src/main.js');

    const { showError } = mod || (await import('../../main.js'));
    showError('Close me');
    expect(document.getElementById('error-message').classList.contains('show')).toBe(true);

    document.getElementById('close-error').click();
    expect(document.getElementById('error-message').classList.contains('show')).toBe(false);
  });
});