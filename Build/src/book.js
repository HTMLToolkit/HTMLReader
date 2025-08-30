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

/***** Book Opening functions *****/
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
// (and the loading spinner) right away
export async function openBookFromEntry(entry) {
  // Close library right away
  toggleLibrary(false);
  showLoading();
  try {
    const file = await entry.getFile();
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

export function prevPage() {
  if (rendition) rendition.prev();
}

export function nextPage() {
  if (rendition) rendition.next();
}

export function goToPage() {
  if (!book || !locations) return;
  const pageNumber = parseInt(currentPageInput.value, 10) - 1;
  if (pageNumber >= 0 && pageNumber < book.locations.length()) {
    const cfi = book.locations.cfiFromLocation(pageNumber);
    rendition.display(cfi);
  }
}

function handleKeyEvents(e) {
  if (!book || !rendition) return;
  if (e.key === 'ArrowLeft') prevPage();
  if (e.key === 'ArrowRight') nextPage();
}

export function toggleToc() {
  tocContainer.classList.toggle('open');
  overlay.classList.toggle('open');
}

export function closeToc() {
  tocContainer.classList.remove('open');
  overlay.classList.remove('open');
}