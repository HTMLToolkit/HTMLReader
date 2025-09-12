import ePub from "epubjs";
import { showLoading, showError, hideLoading } from "./main";
import { toggleLibrary } from "./library";

/***** Book Variables *****/
let book = null;
let rendition = null;
let displayed = null;
let locations = null;
// eslint-disable-next-line no-unused-vars
let currentLocation = 0;


/***** DOM Elements *****/
const tocButton = document.getElementById('toc-button');
const prevButton = document.getElementById('prev-button');
const nextButton = document.getElementById('next-button');
const currentPageInput = document.getElementById('current-page');
const overlay = document.getElementById('overlay');
const totalPagesSpan = document.getElementById('total-pages');
const bookTitleSpan = document.getElementById('book-title');
const tocContainer = document.getElementById('toc-container');
const tocContent = document.getElementById('toc-content');
const viewer = document.getElementById('viewer');

/**
 * Open an EPUB file selected via a file input and load it into the viewer.
 *
 * Validates the selected file is an EPUB, shows a loading indicator, reads the file
 * as an ArrayBuffer, and calls loadBook with the file data. On read/load errors
 * it hides the loading indicator and displays an error message.
 *
 * @param {Event} e - Change event from a file input; the function reads e.target.files[0].
 */
export function openBook(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.type !== 'application/epub+zip' && !file.name.endsWith('.epub')) {
    showError('The selected file is not a valid EPUB file.');
    return;
  }
  showLoading();
  const reader = new FileReader();
  reader.onload = function(e) {
    const bookData = e.target.result;
    loadBook(bookData).then(() => {
      hideLoading();
    }).catch(err => {
      hideLoading();
      showError('Error loading book: ' + err.message);
    });
  };
  reader.onerror = function(e) {
    hideLoading();
    showError('Error reading file: ' + e.target.error);
  };
  reader.readAsArrayBuffer(file);
}

// Immediately close library on click so the user sees the main viewer
/**
 * Open and load an EPUB from a library entry, managing the library UI and loading spinner.
 *
 * Reads the file from the given library entry (object with an async `getFile()` method), converts it to an ArrayBuffer,
 * and delegates to `loadBook` to render the book. Closes the library and shows a loading indicator while loading.
 * If an error occurs, the library is reopened and an error message is shown; the function always hides the loading indicator before returning.
 *
 * @param {Object} entry - Library entry providing an async `getFile()` method that returns a `File`/Blob.
 * @return {Promise<void>} Resolves once loading has finished or an error has been handled.
 */
export async function openBookFromEntry(entry) {
  // Close library right away
  toggleLibrary(false);
  showLoading();
  try {
    const file = (entry && typeof entry.getFile === 'function') ? await entry.getFile() : entry;
    const arrayBuffer = await file.arrayBuffer();
    await loadBook(arrayBuffer);
  } catch (err) {
    // If error, reopen library so user can pick another book
    toggleLibrary(true);
    showError('Error opening book: ' + err.message);
  } finally {
    hideLoading();
  }
}

/**
 * Load and render an EPUB into the viewer, initialise navigation, and wire up UI and event handlers.
 *
 * This replaces any currently loaded book, creates a new ePub instance and rendition rendered into the
 * viewer element, generates the table of contents and location map, enables navigation controls,
 * and registers relocation and keyboard listeners. The relocation handler updates the global
 * `currentLocation` and the page input when location data exists. Also attempts to set the visible
 * book title from metadata (with fallbacks).
 *
 * @param {ArrayBuffer|Uint8Array|Blob|string} bookData - EPUB data or URL accepted by epubjs.
 * @param {string} [startLocation] - Optional initial location (CFI or href) to display.
 * @returns {Promise} A promise that resolves when the rendition's initial display operation completes.
 */
async function loadBook(bookData, startLocation) {
  if (book) {
    book = null;
    rendition = null;
    viewer.innerHTML = '';
  }
  book = ePub(bookData);
  await book.ready;
  rendition = book.renderTo('viewer', {
    width: '100%',
    height: '100%',
    spread: 'none'
  });
  displayed = rendition.display(startLocation);
  await generateToc();
  await generateLocations();
  prevButton.disabled = false;
  nextButton.disabled = false;
  tocButton.disabled = false;
  rendition.on('relocated', location => {
    currentLocation = location.start.cfi;
    if (locations) {
      const pageNumber = book.locations.locationFromCfi(location.start.cfi);
      currentPageInput.value = pageNumber + 1;
    }
  });
  window.addEventListener('keyup', handleKeyEvents);
  // Set the book title in header if available
  try {
    const metadata = await book.loaded.metadata;
    if (metadata.title) {
      bookTitleSpan.textContent = metadata.title;
    } else {
      bookTitleSpan.textContent = "Untitled EPUB";
    }
  } catch {
    bookTitleSpan.textContent = "EPUB Book";
  }
  return displayed;
}

/**
 * Generate the book's virtual pagination (locations) and update the UI with the total page count.
 *
 * This async function returns early if no book is loaded. It calls the EPUB book's
 * locations.generate(1000) to build location data, stores the resulting locations in the
 * module-level `locations` variable, and updates `totalPagesSpan.textContent` with the
 * computed number of locations. Errors are caught and logged; the function does not throw.
 */
async function generateLocations() {
  if (!book) return;
  try {
    await book.locations.generate(1000);
    locations = book.locations;
    totalPagesSpan.textContent = book.locations.length();
  } catch (err) {
    console.error('Error generating locations:', err);
  }
}

/**
 * Build and render the book's table of contents (TOC) into the UI.
 *
 * If a book is loaded, asynchronously reads the book's navigation TOC, clears the
 * existing TOC container, and creates a clickable entry for each TOC item.
 * Clicking an entry displays that location in the rendition and closes the TOC overlay.
 *
 * Does nothing if no book is loaded. Errors encountered while retrieving or
 * rendering the TOC are caught and logged to the console.
 *
 * @returns {Promise<void>} Resolves when the TOC has been generated and appended to the DOM.
 */
async function generateToc() {
  if (!book) return;
  try {
    const toc = await book.navigation.toc;
    tocContent.innerHTML = '';
    toc.forEach(item => {
      const tocItem = document.createElement('div');
      tocItem.className = 'toc-item';
      tocItem.textContent = item.label;
      tocItem.addEventListener('click', () => {
        rendition.display(item.href);
        closeToc();
      });
      tocContent.appendChild(tocItem);
    });
  } catch (err) {
    console.error('Error generating TOC:', err);
  }
}

/**
 * Navigate the viewer to the previous page.
 *
 * If a rendition is active, calls its `prev()` method; otherwise does nothing.
 */
export function prevPage() {
  if (rendition) rendition.prev();
}

/**
 * Advance the current rendition to the next page/location.
 *
 * This is a no-op if no rendition is initialized.
 */
export function nextPage() {
  if (rendition) rendition.next();
}

/**
 * Navigate the viewer to the page number entered in the page input field.
 *
 * Reads a 1-based page number from `currentPageInput.value`, converts it to a
 * 0-based location index, validates it against the book's generated locations,
 * converts that location index to a CFI using `book.locations.cfiFromLocation`,
 * and displays it in the rendition.
 *
 * No action is taken if there is no loaded book or location data, or if the
 * entered page number is out of range or not a valid integer.
 */
export function goToPage() {
  if (!book || !locations) return;
  const pageNumber = parseInt(currentPageInput.value, 10) - 1;
  if (pageNumber >= 0 && pageNumber < book.locations.length()) {
    const cfi = book.locations.cfiFromLocation(pageNumber);
    rendition.display(cfi);
  }
}

/**
 * Handle keyboard navigation: left/right arrow keys move to the previous/next page.
 * @param {KeyboardEvent} e - Keyboard event; listens for 'ArrowLeft' to go to the previous page and 'ArrowRight' to go to the next page.
 */
function handleKeyEvents(e) {
  if (!book || !rendition) return;
  if (e.key === 'ArrowLeft') prevPage();
  if (e.key === 'ArrowRight') nextPage();
}

/**
 * Toggle the visibility of the table of contents overlay.
 *
 * Adds or removes the 'open' class on the TOC container and the overlay element to show or hide the table of contents.
 */
export function toggleToc() {
  tocContainer.classList.toggle('open');
  overlay.classList.toggle('open');
}

/**
 * Close the table of contents overlay.
 *
 * Removes the 'open' class from the TOC container and the page overlay, hiding the table of contents.
 */
export function closeToc() {
  tocContainer.classList.remove('open');
  overlay.classList.remove('open');
}