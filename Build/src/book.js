/* eslint-disable no-unused-vars */
import ePub from "epubjs";
import { showLoading, showError, hideLoading, showSuccess, updateLoadingProgress, debounce } from "./main.js";
import { toggleLibrary } from "./library.js";

/***** Book State *****/
let book = null;
let rendition = null;
let displayed = null;
let locations = null;
let currentLocation = 0;
let bookSettings = {
  fontSize: 16,
  fontFamily: 'serif',
  theme: 'default',
  lineHeight: 1.6,
  margin: 20
};

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
const fullscreenButton = document.getElementById('fullscreen-button');
const readingProgress = document.getElementById('reading-progress');
const readingProgressFill = document.getElementById('reading-progress-fill');

/**
 * Open an EPUB file from file input with validation and error handling
 * @param {Event} e - File input change event
 */
export function openBook(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  // file validation
  const validExtensions = ['.epub'];
  const validMimeTypes = ['application/epub+zip'];
  
  const isValidExtension = validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
  const isValidMimeType = validMimeTypes.includes(file.type);
  
  if (!isValidExtension && !isValidMimeType) {
    showError('Please select a valid EPUB file (.epub extension required).');
    return;
  }
  
  // Check file size (reasonable limit: 100MB)
  if (file.size > 100 * 1024 * 1024) {
    showError('File is too large. Please select an EPUB file smaller than 100MB.');
    return;
  }
  
  showLoading('Reading EPUB file...', true);
  
  const reader = new FileReader();
  
  reader.onloadstart = () => {
    updateLoadingProgress(10);
  };
  
  reader.onprogress = (e) => {
    if (e.lengthComputable) {
      const percentage = Math.round((e.loaded / e.total) * 50); // 50% for file reading
      updateLoadingProgress(percentage);
    }
  };
  
  reader.onload = async function(e) {
    try {
      updateLoadingProgress(60);
      const bookData = e.target.result;
      await loadBook(bookData);
      showSuccess(`"${file.name}" loaded successfully!`);
    } catch (err) {
      console.error('Error loading book:', err);
      showError('Error loading book: ' + (err.message || 'Unknown error'), () => openBook(e));
    } finally {
      hideLoading();
    }
  };
  
  reader.onerror = function(err) {
    hideLoading();
    console.error('File reading error:', err);
    showError('Error reading file. The file may be corrupted or inaccessible.', () => openBook(e));
  };
  
  reader.readAsArrayBuffer(file);
}

/**
 * Open and load an EPUB from a library entry with improved error handling
 * @param {Object} entry - Library entry with getFile() method
 */
export async function openBookFromEntry(entry) {
  toggleLibrary(false);
  showLoading('Opening book from library...', true);
  
  try {
    updateLoadingProgress(20);
    const file = (typeof entry?.getFile === 'function') ? await entry.getFile() : entry;
    
    updateLoadingProgress(40);
    const arrayBuffer = await file.arrayBuffer();
    
    updateLoadingProgress(60);
    await loadBook(arrayBuffer);
    
    showSuccess(`Book opened successfully!`);
  } catch (err) {
    console.error('Error opening book from library:', err);
    toggleLibrary(true);
    showError('Error opening book: ' + (err.message || 'Unknown error'), () => openBookFromEntry(entry));
  } finally {
    hideLoading();
  }
}

/**
 * Load and render an EPUB with comprehensive setup and error handling
 * @param {ArrayBuffer|Uint8Array|Blob|string} bookData - EPUB data
 * @param {string} [startLocation] - Optional initial location
 */
async function loadBook(bookData, startLocation) {
  try {
    // Clean up previous book
    if (book && rendition) {
      await cleanupPreviousBook();
    }
    
    updateLoadingProgress(70);
    
    // Create new book instance
    book = ePub(bookData);
    await book.ready;
    
    updateLoadingProgress(80);
    
    // Create rendition with settings
    rendition = book.renderTo('viewer', {
      width: '100%',
      height: '100%',
      spread: 'none',
      allowScriptedContent: false,
      allowPopups: false,
      flow: 'paginated'
    });
    
    // Apply stored settings
    await applyBookSettings();
    
    updateLoadingProgress(90);
    
    // Display initial location
    displayed = rendition.display(startLocation);
    
    // Setup all book features
    await Promise.all([
      generateToc(),
      generateLocations(),
      setupBookMetadata(),
      setupEventHandlers()
    ]);
    
    // Enable UI controls
    enableBookControls();
    
    updateLoadingProgress(100);
    
    // Clear the file input for re-selection
    const fileInput = document.getElementById('file-input');
    if (fileInput) fileInput.value = '';
    
  } catch (error) {
    console.error('Error in loadBook:', error);
    throw new Error(`Failed to load EPUB: ${error.message}`);
  }
}

/**
 * Clean up resources from previously loaded book
 */
async function cleanupPreviousBook() {
  try {
    if (rendition) {
      rendition.destroy();
    }
    if (book) {
      book = null;
    }
    
    // Clear viewer
    viewer.innerHTML = '';
    
    // Reset UI state
    bookTitleSpan.textContent = '';
    currentPageInput.value = 1;
    totalPagesSpan.textContent = '1';
    tocContent.innerHTML = '';
    
    // Hide reading progress
    if (readingProgress) {
      readingProgress.style.display = 'none';
    }
    
  } catch (error) {
    console.warn('Error during cleanup:', error);
  }
}

/**
 * Apply book display settings
 */
async function applyBookSettings() {
  if (!rendition) return;
  
  try {
    // Apply font settings
    await rendition.themes.fontSize(`${bookSettings.fontSize}px`);
    await rendition.themes.font(bookSettings.fontFamily);
    
    // Apply theme
    if (bookSettings.theme === 'dark') {
      await rendition.themes.override('color', '#e2e8f0');
      await rendition.themes.override('background-color', '#1a202c');
    } else if (bookSettings.theme === 'sepia') {
      await rendition.themes.override('color', '#5c4317');
      await rendition.themes.override('background-color', '#f7f3e9');
    }
    
    // Apply spacing
    await rendition.themes.override('line-height', bookSettings.lineHeight.toString());
    await rendition.themes.override('margin', `${bookSettings.margin}px`);
    
  } catch (error) {
    console.warn('Error applying book settings:', error);
  }
}

/**
 * Setup book metadata display
 */
async function setupBookMetadata() {
  try {
    const metadata = await book.loaded.metadata;
    
    if (metadata.title) {
      bookTitleSpan.textContent = metadata.title;
      document.title = `${metadata.title} - HTMLReader`;
    } else {
      bookTitleSpan.textContent = "Untitled EPUB";
      document.title = "HTMLReader";
    }
    
    // Store metadata for later use
    book.metadata = metadata;
    
  } catch (error) {
    console.warn('Error setting up metadata:', error);
    bookTitleSpan.textContent = "EPUB Book";
    document.title = "HTMLReader";
  }
}

/**
 * Setup event handlers for the rendition
 */
function setupEventHandlers() {
  if (!rendition) return;
  
  // Location change handler with throttling
  const debouncedLocationHandler = debounce((location) => {
    currentLocation = location.start.cfi;
    updatePageDisplay(location);
    updateReadingProgress(location);
  }, 150);
  
  rendition.on('relocated', debouncedLocationHandler);
  
  // Layout change handler
  rendition.on('layout', (layout) => {
    console.log('Layout updated:', layout);
  });
  
  // Selection handler for potential future features
  rendition.on('selected', (cfiRange, contents) => {
    console.log('Text selected:', cfiRange);
  });
  
  // Error handler
  rendition.on('renderFailed', (error) => {
    console.error('Render failed:', error);
    showError('Error rendering book content. Some pages may not display correctly.');
  });
  
  // Remove old keyboard listeners
  document.removeEventListener('keydown', handleBookKeyboard);
  document.addEventListener('keydown', handleBookKeyboard);
}

/**
 * Update page display information
 * @param {Object} location - Current location object
 */
function updatePageDisplay(location) {
  if (locations && book.locations) {
    try {
      const pageNumber = book.locations.locationFromCfi(location.start.cfi);
      currentPageInput.value = pageNumber + 1;
    } catch (error) {
      console.warn('Error updating page display:', error);
    }
  }
}

/**
 * Update reading progress indicator
 * @param {Object} location - Current location object
 */
function updateReadingProgress(location) {
  if (!readingProgress || !readingProgressFill || !locations) return;
  
  try {
    const progress = book.locations.percentageFromCfi(location.start.cfi);
    const percentage = Math.round(progress * 100);
    
    readingProgressFill.style.width = `${percentage}%`;
    readingProgress.style.display = 'block';
    
    // Update title with progress
    const baseTitle = document.title.replace(/ \(\d+%\)$/, '');
    document.title = `${baseTitle} (${percentage}%)`;
    
  } catch (error) {
    console.warn('Error updating reading progress:', error);
  }
}

/**
 * Generate book locations for pagination with progress tracking
 */
async function generateLocations() {
  if (!book) return;
  
  try {
    console.log('Generating locations...');
    
    // Generate locations with progress callback
    const locationsPromise = book.locations.generate(1600);
    
    // Wait for locations to be generated
    await locationsPromise;
    
    locations = book.locations;
    const totalPages = book.locations.length();
    totalPagesSpan.textContent = totalPages.toString();
    
    console.log(`Generated ${totalPages} locations`);
    
  } catch (error) {
    console.error('Error generating locations:', error);
    totalPagesSpan.textContent = '?';
  }
}

/**
 * Generate table of contents with structure
 */
async function generateToc() {
  if (!book) return;
  
  try {
    console.log('Generating table of contents...');
    
    const toc = await book.navigation.toc;
    tocContent.innerHTML = '';
    
    if (toc.length === 0) {
      const noTocMessage = document.createElement('div');
      noTocMessage.className = 'toc-item';
      noTocMessage.textContent = 'No table of contents available';
      noTocMessage.style.fontStyle = 'italic';
      noTocMessage.style.color = 'var(--text-light)';
      tocContent.appendChild(noTocMessage);
      return;
    }
    
    toc.forEach((item, index) => {
      const tocItem = createTocItem(item, 0);
      tocContent.appendChild(tocItem);
    });
    
    console.log(`Generated TOC with ${toc.length} items`);
    
  } catch (error) {
    console.error('Error generating TOC:', error);
    tocContent.innerHTML = '<div class="toc-item" style="color: var(--text-light);">Error loading table of contents</div>';
  }
}

/**
 * Create a table of contents item with proper nesting
 * @param {Object} item - TOC item
 * @param {number} level - Nesting level
 * @returns {HTMLElement} TOC item element
 */
function createTocItem(item, level) {
  const tocItem = document.createElement('div');
  tocItem.className = 'toc-item';
  tocItem.style.paddingLeft = `${1.5 + level * 1}rem`;
  tocItem.textContent = item.label || 'Untitled';
  tocItem.setAttribute('role', 'listitem');
  tocItem.setAttribute('tabindex', '0');
  
  // Click handler
  const handleClick = async () => {
    try {
      await rendition.display(item.href);
      closeToc();
      showSuccess(`Navigated to: ${item.label}`);
    } catch (error) {
      console.error('Error navigating to TOC item:', error);
      showError('Error navigating to selected chapter');
    }
  };
  
  tocItem.addEventListener('click', handleClick);
  tocItem.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  });
  
  // Add nested items if they exist
  if (item.subitems && item.subitems.length > 0) {
    item.subitems.forEach(subitem => {
      const subTocItem = createTocItem(subitem, level + 1);
      tocContent.appendChild(subTocItem);
    });
  }
  
  return tocItem;
}

/**
 * Enable book-related UI controls
 */
function enableBookControls() {
  prevButton.disabled = false;
  nextButton.disabled = false;
  tocButton.disabled = false;
  currentPageInput.disabled = false;
}

/**
 * Handle keyboard navigation for the book
 * @param {KeyboardEvent} e - Keyboard event
 */
function handleBookKeyboard(e) {
  if (!book || !rendition) return;
  
  // Don't interfere with input fields or when modals are open
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (document.querySelector('.toc-container.open, .library-container.open, .message.show')) return;
  
  switch (e.key) {
    case 'ArrowLeft':
    case 'PageUp':
      e.preventDefault();
      prevPage();
      break;
    case 'ArrowRight':
    case 'PageDown':
    case ' ':
      e.preventDefault();
      nextPage();
      break;
    case 'Home':
      e.preventDefault();
      goToPage(1);
      break;
    case 'End':
      e.preventDefault();
      if (locations) {
        goToPage(book.locations.length());
      }
      break;
  }
}

/***** Navigation Functions *****/

/**
 * Navigate to previous page with error handling
 */
export async function prevPage() {
  if (!rendition) return;
  
  try {
    await rendition.prev();
  } catch (error) {
    console.error('Error navigating to previous page:', error);
    showError('Error navigating to previous page');
  }
}

/**
 * Navigate to next page with error handling
 */
export async function nextPage() {
  if (!rendition) return;
  
  try {
    await rendition.next();
  } catch (error) {
    console.error('Error navigating to next page:', error);
    showError('Error navigating to next page');
  }
}

/**
 * Navigate to specific page with validation
 */
export async function goToPage(pageNumber = null) {
  if (!book || !locations) {
    showError('Book locations not ready. Please wait for the book to fully load.');
    return;
  }
  
  try {
    const targetPage = pageNumber || parseInt(currentPageInput.value, 10);
    const pageIndex = targetPage - 1; // Convert to 0-based index
    
    if (pageIndex < 0 || pageIndex >= book.locations.length()) {
      showError(`Page ${targetPage} is out of range. Please enter a page between 1 and ${book.locations.length()}.`);
      return;
    }
    
    const cfi = book.locations.cfiFromLocation(pageIndex);
    await rendition.display(cfi);
    
  } catch (error) {
    console.error('Error navigating to page:', error);
    showError('Error navigating to specified page');
  }
}

/***** UI Control Functions *****/

/**
 * Toggle table of contents with animation
 */
export function toggleToc() {
  const isOpen = tocContainer.classList.contains('open');
  
  if (isOpen) {
    closeToc();
  } else {
    // Close library if open
    toggleLibrary(false);
    
    tocContainer.classList.add('open');
    overlay.classList.add('open');
    
    // Focus first TOC item for accessibility
    setTimeout(() => {
      const firstTocItem = tocContent.querySelector('.toc-item[tabindex="0"]');
      if (firstTocItem) firstTocItem.focus();
    }, 300);
  }
}

/**
 * Close table of contents
 */
export function closeToc() {
  tocContainer.classList.remove('open');
  
  // Only hide overlay if no other modals are open
  if (!document.querySelector('.library-container.open, .message.show')) {
    overlay.classList.remove('open');
  }
}

/**
 * Toggle fullscreen reading mode
 */
export function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      console.error('Error entering fullscreen:', err);
      showError('Unable to enter fullscreen mode');
    });
  } else {
    document.exitFullscreen().catch(err => {
      console.error('Error exiting fullscreen:', err);
      showError('Unable to exit fullscreen mode');
    });
  }
}

/***** Utility Functions *****/

/**
 * Get current book information
 * @returns {Object|null} Book information or null if no book loaded
 */
export function getCurrentBookInfo() {
  if (!book) return null;
  
  return {
    title: book.metadata?.title || 'Unknown',
    author: book.metadata?.creator || 'Unknown',
    currentLocation: currentLocation,
    totalPages: locations ? book.locations.length() : 0,
    progress: locations ? book.locations.percentageFromCfi(currentLocation) : 0
  };
}

/**
 * Export current reading position for bookmarking
 * @returns {Object|null} Reading position data
 */
export function exportReadingPosition() {
  const bookInfo = getCurrentBookInfo();
  if (!bookInfo) return null;
  
  return {
    ...bookInfo,
    timestamp: Date.now(),
    cfi: currentLocation
  };
}

// Initialize fullscreen change listener
document.addEventListener('fullscreenchange', () => {
  const isFullscreen = !!document.fullscreenElement;
  fullscreenButton.textContent = isFullscreen ? 'Exit Fullscreen' : 'Fullscreen';
});