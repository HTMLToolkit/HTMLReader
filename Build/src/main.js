import { openBook, prevPage, nextPage, goToPage, toggleToc, closeToc, toggleFullscreen } from "./book.js";
import { openLibrary, handleLibraryFiles, toggleLibrary } from "./library.js";

/***** DOM Elements *****/
const openButton = document.getElementById('open-button');
const fileInput = document.getElementById('file-input');
const libraryInput = document.getElementById('library-input');
const libraryButton = document.getElementById('library-button');
const closeLibraryButton = document.getElementById('close-library');
const tocButton = document.getElementById('toc-button');
const closeTocButton = document.getElementById('close-toc');
const prevButton = document.getElementById('prev-button');
const nextButton = document.getElementById('next-button');
const currentPageInput = document.getElementById('current-page');
const fullscreenButton = document.getElementById('fullscreen-button');
const overlay = document.getElementById('overlay');
const loadingMessage = document.getElementById('loading-message');
const errorMessage = document.getElementById('error-message');
const successMessage = document.getElementById('success-message');
const errorText = document.getElementById('error-text');
const successText = document.getElementById('success-text');
const closeErrorButton = document.getElementById('close-error');
const closeSuccessButton = document.getElementById('close-success');
const retryButton = document.getElementById('retry-action');
const installButton = document.getElementById('install-button');
const loadingProgress = document.getElementById('loading-progress');

/***** Global State *****/
let lastFailedAction = null;
let deferredPrompt = null;

/***** Event Listeners *****/
// File operations
openButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', openBook);
libraryInput.addEventListener('change', handleLibraryFiles);

// Navigation
prevButton.addEventListener('click', prevPage);
nextButton.addEventListener('click', nextPage);
currentPageInput.addEventListener('change', goToPage);

// UI controls
tocButton.addEventListener('click', toggleToc);
closeTocButton.addEventListener('click', toggleToc);
libraryButton.addEventListener('click', openLibrary);
closeLibraryButton.addEventListener('click', () => toggleLibrary(false));
fullscreenButton.addEventListener('click', toggleFullscreen);

// Overlay and messages
overlay.addEventListener('click', handleOverlayClick);
closeErrorButton.addEventListener('click', hideError);
closeSuccessButton.addEventListener('click', hideSuccess);
retryButton.addEventListener('click', handleRetry);
installButton.addEventListener('click', installApp);

// Keyboard shortcuts
document.addEventListener('keydown', handleGlobalKeyboard);

// PWA install prompt
window.addEventListener('beforeinstallprompt', handleInstallPrompt);
window.addEventListener('appinstalled', handleAppInstalled);

// Page visibility and focus
document.addEventListener('visibilitychange', handleVisibilityChange);
window.addEventListener('focus', handleWindowFocus);

/***** Utility Functions *****/

/**
 * Show the loading message with optional progress tracking
 * @param {string} [message] - Custom loading message
 * @param {boolean} [showProgress=false] - Whether to show progress bar
 */
export function showLoading(message = 'Loading EPUB...', showProgress = false) {
  const loadingH3 = loadingMessage.querySelector('h3');
  if (loadingH3) loadingH3.textContent = message;
  
  if (showProgress && loadingProgress) {
    loadingProgress.style.width = '0%';
    loadingMessage.querySelector('.progress-bar').style.display = 'block';
  }
  
  loadingMessage.classList.add('show');
  overlay.classList.add('open');
  
  // Prevent body scroll when loading
  document.body.style.overflow = 'hidden';
}

/**
 * Update loading progress
 * @param {number} percentage - Progress percentage (0-100)
 */
export function updateLoadingProgress(percentage) {
  if (loadingProgress) {
    loadingProgress.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
  }
}

/**
 * Hide the loading message
 */
export function hideLoading() {
  loadingMessage.classList.remove('show');
  
  // Only hide overlay if no other modals are open
  if (!document.querySelector('.library-container.open, .toc-container.open')) {
    overlay.classList.remove('open');
  }
  
  // Restore body scroll
  document.body.style.overflow = '';
}

/**
 * Display an error message with optional retry action
 * @param {string} message - Error message to display
 * @param {Function} [retryAction] - Optional function to call on retry
 */
export function showError(message, retryAction = null) {
  errorText.textContent = message;
  errorMessage.classList.add('show');
  overlay.classList.add('open');
  
  // Store retry action and show/hide retry button
  lastFailedAction = retryAction;
  if (retryButton) {
    retryButton.style.display = retryAction ? 'inline-block' : 'none';
  }
  
  // Auto-hide after 10 seconds if no retry action
  if (!retryAction) {
    setTimeout(() => {
      if (errorMessage.classList.contains('show')) {
        hideError();
      }
    }, 10000);
  }
  
  document.body.style.overflow = 'hidden';
  console.error('Application Error:', message);
}

/**
 * Hide the error message
 */
export function hideError() {
  errorMessage.classList.remove('show');
  
  if (!document.querySelector('.library-container.open, .toc-container.open, .message.show')) {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }
  
  lastFailedAction = null;
}

/**
 * Show a success message
 * @param {string} message - Success message to display
 * @param {number} [autoHideDelay=3000] - Auto-hide delay in milliseconds
 */
export function showSuccess(message, autoHideDelay = 3000) {
  successText.textContent = message;
  successMessage.classList.add('show');
  
  if (autoHideDelay > 0) {
    setTimeout(() => {
      if (successMessage.classList.contains('show')) {
        hideSuccess();
      }
    }, autoHideDelay);
  }
}

/**
 * Hide the success message
 */
export function hideSuccess() {
  successMessage.classList.remove('show');
}

/**
 * Debounce function to limit rapid function calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function to limit function call frequency
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
export function throttle(func, limit) {
  let inThrottle;
  return function executedFunction(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/***** Event Handlers *****/

/**
 * Handle overlay clicks to close open panels
 */
function handleOverlayClick() {
  closeToc();
  toggleLibrary(false);
  hideError();
  hideSuccess();
}

/**
 * Handle retry button clicks
 */
function handleRetry() {
  hideError();
  if (lastFailedAction && typeof lastFailedAction === 'function') {
    lastFailedAction();
  }
}

/**
 * Handle global keyboard shortcuts
 * @param {KeyboardEvent} e - Keyboard event
 */
function handleGlobalKeyboard(e) {
  // Don't interfere with input fields
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    return;
  }

  switch (e.key) {
    case 'Escape':
      e.preventDefault();
      handleOverlayClick();
      break;
    case 'F11':
      e.preventDefault();
      toggleFullscreen();
      break;
    case 't':
    case 'T':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (!tocButton.disabled) toggleToc();
      }
      break;
    case 'l':
    case 'L':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        openLibrary();
      }
      break;
    case 'o':
    case 'O':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        fileInput.click();
      }
      break;
  }
}

/**
 * Handle PWA install prompt
 * @param {Event} e - beforeinstallprompt event
 */
function handleInstallPrompt(e) {
  e.preventDefault();
  deferredPrompt = e;
  installButton.hidden = false;
}

/**
 * Install the PWA
 */
async function installApp() {
  if (!deferredPrompt) return;

  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  
  if (outcome === 'accepted') {
    showSuccess('App installed successfully!');
  }
  
  deferredPrompt = null;
  installButton.hidden = true;
}

/**
 * Handle app installation completion
 */
function handleAppInstalled() {
  showSuccess('HTMLReader installed successfully!');
  installButton.hidden = true;
}

/**
 * Handle page visibility changes for performance optimization
 */
function handleVisibilityChange() {
  if (document.hidden) {
    // Pause any animations or timers when page is hidden
    document.body.classList.add('page-hidden');
  } else {
    document.body.classList.remove('page-hidden');
  }
}

/**
 * Handle window focus for better UX
 */
function handleWindowFocus() {
  // Refresh UI state when window regains focus
  updateUIState();
}

/**
 * Update UI state based on current application state
 */
function updateUIState() {
  // This can be extended based on book loading state
  const hasBook = document.getElementById('viewer').innerHTML.trim() !== '';
  
  prevButton.disabled = !hasBook;
  nextButton.disabled = !hasBook;
  tocButton.disabled = !hasBook;
}

/***** Initialization *****/

/**
 * Initialize the application
 */
function initializeApp() {
  console.log('HTMLReader initialized');
  
  // Check for service worker support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('Service Worker registration failed:', err);
    });
  }
  
  // Initialize UI state
  updateUIState();
  
  // Add loading states to buttons
  addButtonLoadingStates();
  
  // Set up drag and drop for EPUB files
  setupDragAndDrop();
  
  // Check for URL parameters (deep linking)
  handleUrlParameters();
}

/**
 * Add loading states to buttons for better UX
 */
function addButtonLoadingStates() {
  const buttons = document.querySelectorAll('button:not([id$="-close"], [id$="-error"], [id$="-success"])');
  
  buttons.forEach(button => {
    // eslint-disable-next-line no-unused-vars
    const originalHandler = button.onclick;
    // eslint-disable-next-line no-unused-vars
    button.addEventListener('click', function(e) {
      if (button.disabled) return;
      
      button.classList.add('loading');
      const originalText = button.textContent;
      
      // Reset after 3 seconds if still loading
      setTimeout(() => {
        button.classList.remove('loading');
        if (button.textContent === 'Loading...') {
          button.textContent = originalText;
        }
      }, 3000);
    });
  });
}

/**
 * Set up drag and drop functionality for EPUB files
 */
function setupDragAndDrop() {
  const viewer = document.getElementById('viewer');
  let dragCounter = 0;
  
  const handleDragEnter = (e) => {
    e.preventDefault();
    dragCounter++;
    viewer.classList.add('drag-over');
  };
  
  const handleDragLeave = (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
      viewer.classList.remove('drag-over');
    }
  };
  
  const handleDragOver = (e) => {
    e.preventDefault();
  };
  
  const handleDrop = (e) => {
    e.preventDefault();
    dragCounter = 0;
    viewer.classList.remove('drag-over');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.name.endsWith('.epub')) {
        // Simulate file input change
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        
        const event = new Event('change', { bubbles: true });
        fileInput.dispatchEvent(event);
      } else {
        showError('Please drop a valid EPUB file.');
      }
    }
  };
  
  viewer.addEventListener('dragenter', handleDragEnter);
  viewer.addEventListener('dragleave', handleDragLeave);
  viewer.addEventListener('dragover', handleDragOver);
  viewer.addEventListener('drop', handleDrop);
}

/**
 * Handle URL parameters for deep linking
 */
function handleUrlParameters() {
  const urlParams = new URLSearchParams(window.location.search);
  const action = urlParams.get('action');
  
  switch (action) {
    case 'library':
      setTimeout(() => openLibrary(), 100);
      break;
    case 'open':
      setTimeout(() => fileInput.click(), 100);
      break;
  }
}

/***** Error Handling *****/

/**
 * Global error handler
 * @param {ErrorEvent} e - Error event
 */
window.addEventListener('error', (e) => {
  console.error('Global error:', e.error);
  showError(`An unexpected error occurred: ${e.error?.message || 'Unknown error'}`);
});

/**
 * Global unhandled promise rejection handler
 * @param {PromiseRejectionEvent} e - Promise rejection event
 */
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
  showError(`An unexpected error occurred: ${e.reason?.message || 'Promise rejection'}`);
  e.preventDefault();
});

/***** Performance Monitoring *****/

/**
 * Simple performance monitoring
 */
function initializePerformanceMonitoring() {
  if ('performance' in window) {
    window.addEventListener('load', () => {
      setTimeout(() => {
        const perfData = performance.getEntriesByType('navigation')[0];
        if (perfData) {
          console.log('Page load time:', perfData.loadEventEnd - perfData.loadEventStart, 'ms');
        }
      }, 0);
    });
  }
}

/***** Initialize on DOM Content Loaded *****/
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}

// Initialize performance monitoring
initializePerformanceMonitoring();