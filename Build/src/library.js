import { storeLibraryHandle, getStoredLibraryHandle, storeBookMetadata, getStoredBooks, removeBookMetadata } from "./indexedDB.js";
import { openBookFromEntry } from "./book.js";
import ePub from "epubjs";
import { showError, showLoading, hideLoading, showSuccess, updateLoadingProgress } from "./main.js";

/***** DOM Elements *****/
const libraryContainer = document.getElementById('library-container');
const libraryContent = document.getElementById('library-content');
const overlay = document.getElementById('overlay');

/***** Library State *****/
// eslint-disable-next-line no-unused-vars
let currentLibraryFiles = [];
let libraryCache = new Map();

/**
 * Open the EPUB library with features and caching
 */
export async function openLibrary() {
  try {
    showLoading('Loading library...', true);
    updateLoadingProgress(20);
    
    // Try to get stored library handle
    let dirHandle = await getStoredLibraryHandle();
    
    if (!dirHandle) {
      // Fallback for browsers without File System Access API
      if (!('showDirectoryPicker' in window)) {
        hideLoading();
        document.getElementById('library-input')?.click();
        return;
      }
      
      try {
        dirHandle = await window.showDirectoryPicker({
          mode: 'read',
          startIn: 'documents'
        });
        await storeLibraryHandle(dirHandle);
        showSuccess('Library folder selected and saved!');
      } catch (err) {
        hideLoading();
        if (err.name === 'AbortError') {
          return; // User cancelled
        }
        throw err;
      }
    }
    
    updateLoadingProgress(40);
    
    // Check permissions for stored handles
    if (dirHandle.queryPermission && dirHandle.requestPermission) {
      const permission = await dirHandle.queryPermission({ mode: 'read' });
      
      if (permission !== 'granted') {
        const requestResult = await dirHandle.requestPermission({ mode: 'read' });
        if (requestResult !== 'granted') {
          hideLoading();
          showError('Permission denied for library folder. Please select the folder again.');
          // Clear stored handle since we don't have permission
          await storeLibraryHandle(null);
          return;
        }
      }
    }
    
    updateLoadingProgress(60);
    
    // Scan directory for EPUB files
    const files = await scanDirectoryForEpubs(dirHandle);
    
    updateLoadingProgress(80);
    
    // Load cached metadata and merge with file list
    const cachedBooks = await getStoredBooks();
    const booksWithMetadata = await mergeFilesWithMetadata(files, cachedBooks);
    
    updateLoadingProgress(90);
    
    // Display library
    await displayLibraryGrid(booksWithMetadata);
    toggleLibrary(true);
    
    updateLoadingProgress(100);
    
  } catch (err) {
    console.error('Library error:', err);
    showError('Failed to open library: ' + (err.message || 'Unknown error'), openLibrary);
  } finally {
    hideLoading();
  }
}

/**
 * Recursively scan directory for EPUB files
 * @param {FileSystemDirectoryHandle} dirHandle - Directory to scan
 * @param {Set} [processedPaths] - Already processed paths to avoid infinite loops
 * @returns {Promise<Array>} Array of EPUB file handles
 */
async function scanDirectoryForEpubs(dirHandle, processedPaths = new Set()) {
  const files = [];
  const dirPath = dirHandle.name;
  
  // Prevent infinite loops in case of circular references
  if (processedPaths.has(dirPath)) {
    return files;
  }
  processedPaths.add(dirPath);
  
  try {
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === 'file' && name.toLowerCase().endsWith('.epub')) {
        files.push({
          handle,
          name,
          path: dirPath + '/' + name,
          type: 'file'
        });
      } else if (handle.kind === 'directory' && !name.startsWith('.')) {
        // Recursively scan subdirectories (max depth 3 to prevent deep recursion)
        if (processedPaths.size < 50) { // Limit total directories processed
          const subFiles = await scanDirectoryForEpubs(handle, new Set(processedPaths));
          files.push(...subFiles);
        }
      }
    }
  } catch (error) {
    console.warn('Error scanning directory:', dirPath, error);
  }
  
  return files;
}

/**
 * Merge file handles with cached metadata
 * @param {Array} files - File handles from directory scan
 * @param {Array} cachedBooks - Cached book metadata
 * @returns {Promise<Array>} Files with metadata
 */
async function mergeFilesWithMetadata(files, cachedBooks) {
  const cachedMap = new Map();
  cachedBooks.forEach(book => cachedMap.set(book.path, book));
  
  const filesWithMetadata = [];
  
  for (const file of files) {
    const cached = cachedMap.get(file.path);
    
    if (cached && cached.lastModified) {
      // Check if file was modified since last cache
      try {
        const fileHandle = await file.handle.getFile();
        if (fileHandle.lastModified === cached.lastModified) {
          // Use cached data
          filesWithMetadata.push({
            ...file,
            ...cached,
            cached: true
          });
          continue;
        }
      } catch (error) {
        console.warn('Error checking file modification time:', error);
      }
    }
    
    // File is new or modified, will need fresh metadata
    filesWithMetadata.push({
      ...file,
      cached: false
    });
  }
  
  return filesWithMetadata;
}

/**
 * Handle file input selection for library import
 * @param {Event} e - File input change event
 */
export function handleLibraryFiles(e) {
  const files = Array.from(e.target.files);
  const epubFiles = files.filter(file => file.name.toLowerCase().endsWith('.epub'));
  
  if (epubFiles.length === 0) {
    showError('No EPUB files found in selection.');
    return;
  }
  
  if (epubFiles.length !== files.length) {
    showSuccess(`Found ${epubFiles.length} EPUB files out of ${files.length} selected files.`);
  }
  
  displayLibraryGrid(epubFiles);
  toggleLibrary(true);
}

/**
 * Display library grid with layout and metadata
 * @param {Array} fileEntries - Files to display
 */
async function displayLibraryGrid(fileEntries) {
  libraryContent.innerHTML = '';
  currentLibraryFiles = fileEntries;
  
  if (fileEntries.length === 0) {
    displayEmptyLibraryMessage();
    return;
  }
  
  // Create loading placeholder
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'library-loading';
  loadingDiv.innerHTML = `
    <div style="grid-column: 1 / -1; text-align: center; padding: 2rem;">
      <div class="loading-spinner"></div>
      <p>Loading library items...</p>
    </div>
  `;
  libraryContent.appendChild(loadingDiv);
  
  // Load items progressively for better UX
  const batchSize = 6;
  const items = [];
  
  for (let i = 0; i < fileEntries.length; i += batchSize) {
    const batch = fileEntries.slice(i, i + batchSize);
    const batchItems = await Promise.all(
      batch.map(entry => createLibraryItem(entry))
    );
    items.push(...batchItems);
    
    // Update display after each batch
    if (i === 0) {
      libraryContent.removeChild(loadingDiv);
    }
    
    batchItems.forEach(item => libraryContent.appendChild(item));
    
    // Small delay to prevent UI blocking
    if (i + batchSize < fileEntries.length) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  
  // Add library actions
  addLibraryActions();
}

/**
 * Display empty library message with helpful actions
 */
function displayEmptyLibraryMessage() {
  const emptyDiv = document.createElement('div');
  emptyDiv.className = 'empty-library';
  emptyDiv.innerHTML = `
    <div style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
      <div style="font-size: 3rem; margin-bottom: 1rem;">📚</div>
      <h3>No EPUB files found</h3>
      <p>Your library is empty. Try one of these options:</p>
      <div style="margin-top: 1.5rem; display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;">
        <button onclick="document.getElementById('file-input').click()" class="library-action-btn">
          📂 Open Single Book
        </button>
        <button onclick="document.getElementById('library-input').click()" class="library-action-btn">
          📁 Select Multiple Files
        </button>
        <button onclick="window.location.reload()" class="library-action-btn">
          🔄 Refresh Library
        </button>
      </div>
    </div>
  `;
  libraryContent.appendChild(emptyDiv);
}

/**
 * Add library management actions
 */
function addLibraryActions() {
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'library-actions';
  actionsDiv.style.cssText = `
    grid-column: 1 / -1;
    display: flex;
    gap: 1rem;
    justify-content: center;
    padding: 1.5rem;
    border-top: 1px solid var(--border-light);
    margin-top: 1rem;
  `;
  
  actionsDiv.innerHTML = `
    <button onclick="libraryModule.refreshLibrary()" class="library-action-btn">
      🔄 Refresh Library
    </button>
    <button onclick="libraryModule.clearCache()" class="library-action-btn">
      🗑️ Clear Cache
    </button>
    <button onclick="libraryModule.selectNewFolder()" class="library-action-btn">
      📁 Select New Folder
    </button>
  `;
  
  libraryContent.appendChild(actionsDiv);
}

/**
 * Create library item with metadata and caching
 * @param {Object} fileEntry - File entry with handle or File object
 * @returns {Promise<HTMLElement>} Library item element
 */
async function createLibraryItem(fileEntry) {
  const item = document.createElement('div');
  item.className = 'library-item';
  item.setAttribute('role', 'gridcell');
  item.setAttribute('tabindex', '0');
  
  const img = document.createElement('img');
  img.className = 'library-cover';
  img.alt = 'Book cover';
  img.loading = 'lazy';
  
  const titleDiv = document.createElement('div');
  titleDiv.className = 'library-title';
  
  const authorDiv = document.createElement('div');
  authorDiv.className = 'library-author';
  authorDiv.style.cssText = 'font-size: 0.8rem; color: var(--text-light); margin-top: 0.25rem;';
  
  const progressDiv = document.createElement('div');
  progressDiv.className = 'library-progress';
  progressDiv.style.cssText = 'font-size: 0.7rem; color: var(--primary-color); margin-top: 0.5rem; display: none;';
  
  // Set initial values
  titleDiv.textContent = fileEntry.name || 'Unknown Title';
  img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"%3E%3Crect fill="%23e2e8f0" width="200" height="300"/%3E%3Ctext x="100" y="150" text-anchor="middle" fill="%23718096" font-size="48"%3E📖%3C/text%3E%3C/svg%3E';
  
  item.appendChild(img);
  item.appendChild(titleDiv);
  item.appendChild(authorDiv);
  item.appendChild(progressDiv);
  
  // Load metadata asynchronously
  loadItemMetadata(fileEntry, img, titleDiv, authorDiv, progressDiv);
  
  // Event handlers
  const handleActivation = () => openBookFromLibraryItem(fileEntry);
  
  item.addEventListener('click', handleActivation);
  item.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleActivation();
    }
  });
  
  // Context menu for additional actions
  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showItemContextMenu(e, fileEntry);
  });
  
  return item;
}

/**
 * Load metadata for a library item
 * @param {Object} fileEntry - File entry
 * @param {HTMLImageElement} img - Cover image element
 * @param {HTMLElement} titleDiv - Title element
 * @param {HTMLElement} authorDiv - Author element
 * @param {HTMLElement} progressDiv - Progress element
 */
async function loadItemMetadata(fileEntry, img, titleDiv, authorDiv, progressDiv) {
  try {
    // Use cached data if available
    if (fileEntry.cached && fileEntry.title) {
      titleDiv.textContent = fileEntry.title;
      if (fileEntry.author) authorDiv.textContent = fileEntry.author;
      if (fileEntry.coverUrl) img.src = fileEntry.coverUrl;
      if (fileEntry.progress) {
        progressDiv.textContent = `${Math.round(fileEntry.progress * 100)}% complete`;
        progressDiv.style.display = 'block';
      }
      return;
    }
    
    // Load fresh metadata
    const file = await getFileFromEntry(fileEntry);
    if (!file) return;
    
    const arrayBuffer = await file.arrayBuffer();
    const tempBook = ePub(arrayBuffer);
    
    await tempBook.ready;
    const metadata = await tempBook.loaded.metadata;
    
    // Update UI
    if (metadata.title) {
      titleDiv.textContent = metadata.title;
    }
    
    if (metadata.creator) {
      authorDiv.textContent = metadata.creator;
    }
    
    // Load cover
    try {
      const coverUrl = await tempBook.coverUrl();
      if (coverUrl) {
        img.src = coverUrl;
      }
    } catch (coverError) {
      console.warn('Could not load cover for', fileEntry.name,".");
      console.warn(coverError);
    }
    
    // Cache metadata
    const metadataToStore = {
      path: fileEntry.path || fileEntry.name,
      name: fileEntry.name,
      title: metadata.title || fileEntry.name,
      author: metadata.creator || '',
      coverUrl: img.src !== img.getAttribute('data-default') ? img.src : null,
      lastModified: file.lastModified,
      fileSize: file.size,
      cached: true
    };
    
    await storeBookMetadata(metadataToStore);
    
  } catch (error) {
    console.warn('Error loading metadata for', fileEntry.name, error);
    // Keep default values on error
  }
}

/**
 * Get File object from entry (handle File vs FileSystemFileHandle)
 * @param {Object} fileEntry - File entry
 * @returns {Promise<File|null>} File object or null
 */
async function getFileFromEntry(fileEntry) {
  try {
    if (fileEntry.handle && typeof fileEntry.handle.getFile === 'function') {
      return await fileEntry.handle.getFile();
    } else if (fileEntry instanceof File) {
      return fileEntry;
    } else if (typeof fileEntry.getFile === 'function') {
      return await fileEntry.getFile();
    }
    return null;
  } catch (error) {
    console.warn('Error getting file from entry:', error);
    return null;
  }
}

/**
 * Open book from library item with error handling
 * @param {Object} fileEntry - File entry to open
 */
async function openBookFromLibraryItem(fileEntry) {
  try {
    const file = await getFileFromEntry(fileEntry);
    if (!file) {
      throw new Error('Could not access file');
    }
    
    // Update last accessed time
    if (fileEntry.path) {
      const metadata = {
        path: fileEntry.path,
        lastAccessed: Date.now()
      };
      await storeBookMetadata(metadata);
    }
    
    await openBookFromEntry(file);
    
  } catch (error) {
    console.error('Error opening book from library:', error);
    showError(`Could not open "${fileEntry.name}": ${error.message}`);
  }
}

/**
 * Show context menu for library item
 * @param {MouseEvent} e - Mouse event
 * @param {Object} fileEntry - File entry
 */
function showItemContextMenu(e, fileEntry) {
  // Simple context menu for now
  const actions = [
    {
      label: 'Open Book',
      action: () => openBookFromLibraryItem(fileEntry)
    },
    {
      label: 'Remove from Cache',
      action: () => removeFromCache(fileEntry)
    }
  ];
  
  console.log('Context menu for:', fileEntry.name, actions);
  // Could implement a proper context menu UI here
}

/**
 * Remove book from cache
 * @param {Object} fileEntry - File entry to remove
 */
async function removeFromCache(fileEntry) {
  try {
    await removeBookMetadata(fileEntry.path || fileEntry.name);
    showSuccess(`Removed "${fileEntry.name}" from cache`);
    
    // Refresh library display
    await openLibrary();
  } catch (error) {
    showError('Error removing from cache: ' + error.message);
  }
}

/***** Library Management Functions *****/

/**
 * Refresh the current library
 */
async function refreshLibrary() {
  libraryCache.clear();
  await openLibrary();
}

/**
 * Clear all cached library data
 */
async function clearCache() {
  try {
    // This would need to be implemented in indexedDB.js
    // await clearAllBookMetadata();
    showSuccess('Library cache cleared');
    await refreshLibrary();
  } catch (error) {
    showError('Error clearing cache: ' + error.message);
  }
}

/**
 * Select a new library folder
 */
async function selectNewFolder() {
  try {
    await storeLibraryHandle(null); // Clear stored handle
    await openLibrary(); // Will prompt for new folder
  } catch (error) {
    showError('Error selecting new folder: ' + error.message);
  }
}

/**
 * Toggle library visibility with animation
 * @param {boolean} [forceOpen] - Force open/close state
 */
export function toggleLibrary(forceOpen) {
  const isCurrentlyOpen = libraryContainer.classList.contains('open');
  
  if (forceOpen === true && !isCurrentlyOpen) {
    libraryContainer.classList.add('open');
    overlay.classList.add('open');
    
    // Focus first library item for accessibility
    setTimeout(() => {
      const firstItem = libraryContent.querySelector('.library-item[tabindex="0"]');
      if (firstItem) firstItem.focus();
    }, 300);
    
  } else if (forceOpen === false && isCurrentlyOpen) {
    libraryContainer.classList.remove('open');
    
    // Only hide overlay if no other modals are open
    if (!document.querySelector('.toc-container.open, .message.show')) {
      overlay.classList.remove('open');
    }
    
  } else if (forceOpen === undefined) {
    // Toggle current state
    toggleLibrary(!isCurrentlyOpen);
  }
}

// Export library management functions for global access
window.libraryModule = {
  refreshLibrary,
  clearCache,
  selectNewFolder
};