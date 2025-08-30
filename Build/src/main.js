import { openBook, prevPage, nextPage, goToPage, toggleToc, closeToc } from "./book";
import { openLibrary, handleLibraryFiles, toggleLibrary } from "./library";

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
const overlay = document.getElementById('overlay');
const loadingMessage = document.getElementById('loading-message');
const errorMessage = document.getElementById('error-message');
const errorText = document.getElementById('error-text');
const closeErrorButton = document.getElementById('close-error');



/***** Event Listeners *****/
openButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', openBook);
prevButton.addEventListener('click', prevPage);
nextButton.addEventListener('click', nextPage);
currentPageInput.addEventListener('change', goToPage);
tocButton.addEventListener('click', toggleToc);
closeTocButton.addEventListener('click', toggleToc);
libraryButton.addEventListener('click', openLibrary);
closeLibraryButton.addEventListener('click', () => toggleLibrary(false));
overlay.addEventListener('click', () => {
  closeToc();
  toggleLibrary(false);
  hideError();
});
closeErrorButton.addEventListener('click', hideError);
// Fallback: multiple file input for library import
libraryInput.addEventListener('change', handleLibraryFiles);

/***** Message Functions *****/
export function showLoading() {
  loadingMessage.classList.add('show');
}
export function hideLoading() {
  loadingMessage.classList.remove('show');
}
export function showError(message) {
  errorText.textContent = message;
  errorMessage.classList.add('show');
}
export function hideError() {
  errorMessage.classList.remove('show');
}
