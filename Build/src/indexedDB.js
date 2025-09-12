/**
 * IndexedDB module for HTMLReader
 * Handles storage of library handles, book metadata, reading progress, and settings
 */

const DB_NAME = "htmlreader-db";
const DB_VERSION = 2;

// Store names
const HANDLES_STORE = "handles";
const BOOKS_STORE = "books";
const SETTINGS_STORE = "settings";
const BOOKMARKS_STORE = "bookmarks";

/**
 * Open or create the IndexedDB database with all required stores
 * @returns {Promise<IDBDatabase>} Database instance
 */
function getDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      const oldVersion = e.oldVersion;
      
      console.log(`Upgrading database from version ${oldVersion} to ${DB_VERSION}`);
      
      // Create handles store if it doesn't exist
      if (!db.objectStoreNames.contains(HANDLES_STORE)) {
        db.createObjectStore(HANDLES_STORE, { keyPath: "name" });
      }
      
      // Create books store for metadata and reading progress
      if (!db.objectStoreNames.contains(BOOKS_STORE)) {
        const booksStore = db.createObjectStore(BOOKS_STORE, { keyPath: "path" });
        booksStore.createIndex("title", "title", { unique: false });
        booksStore.createIndex("author", "author", { unique: false });
        booksStore.createIndex("lastAccessed", "lastAccessed", { unique: false });
      }
      
      // Create settings store
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
      
      // Create bookmarks store
      if (!db.objectStoreNames.contains(BOOKMARKS_STORE)) {
        const bookmarksStore = db.createObjectStore(BOOKMARKS_STORE, { 
          keyPath: "id",
          autoIncrement: true 
        });
        bookmarksStore.createIndex("bookPath", "bookPath", { unique: false });
        bookmarksStore.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
    
    request.onsuccess = (e) => {
      resolve(e.target.result);
    };
    
    request.onerror = (e) => {
      console.error('Database error:', e.target.error);
      reject(e.target.error);
    };
    
    request.onblocked = () => {
      console.warn('Database upgrade blocked. Please close other tabs.');
    };
  });
}

/**
 * Execute a transaction with error handling and retry logic
 * @param {string} storeName - Object store name
 * @param {string} mode - Transaction mode ('readonly' or 'readwrite')
 * @param {Function} operation - Operation to perform on the store
 * @returns {Promise} Operation result
 */
async function executeTransaction(storeName, mode, operation) {
  const maxRetries = 3;
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const db = await getDB();
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], mode);
        const store = transaction.objectStore(storeName);
        
        transaction.oncomplete = () => {
          // Transaction completed successfully
        };
        
        transaction.onerror = (e) => {
          console.error(`Transaction error on attempt ${attempt}:`, e.target.error);
          reject(e.target.error);
        };
        
        transaction.onabort = (e) => {
          console.error(`Transaction aborted on attempt ${attempt}:`, e.target.error);
          reject(e.target.error || new Error('Transaction aborted'));
        };
        
        try {
          const result = operation(store);
          
          if (result && typeof result.onsuccess === 'function') {
            // IDB request object
            result.onsuccess = () => resolve(result.result);
            result.onerror = () => reject(result.error);
          } else {
            // Direct value
            resolve(result);
          }
        } catch (error) {
          reject(error);
        }
      });
      
    } catch (error) {
      lastError = error;
      console.warn(`Database operation attempt ${attempt} failed:`, error);
      
      if (attempt < maxRetries) {
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, attempt * 100));
      }
    }
  }
  
  throw lastError || new Error('Database operation failed after retries');
}

/***** Library Handle Management *****/

/**
 * Store a library directory handle
 * @param {FileSystemDirectoryHandle|null} handle - Directory handle or null to clear
 * @returns {Promise<void>}
 */
export async function storeLibraryHandle(handle) {
  return executeTransaction(HANDLES_STORE, 'readwrite', (store) => {
    if (handle === null) {
      return store.delete("library");
    } else {
      return store.put({ name: "library", handle, timestamp: Date.now() });
    }
  });
}

/**
 * Retrieve the stored library directory handle
 * @returns {Promise<FileSystemDirectoryHandle|null>} Stored handle or null
 */
export async function getStoredLibraryHandle() {
  try {
    const result = await executeTransaction(HANDLES_STORE, 'readonly', (store) => {
      return store.get("library");
    });
    return result ? result.handle : null;
  } catch (error) {
    console.warn('Error retrieving library handle:', error);
    return null;
  }
}

/***** Book Metadata Management *****/

/**
 * Store book metadata and reading progress
 * @param {Object} metadata - Book metadata object
 * @returns {Promise<void>}
 */
export async function storeBookMetadata(metadata) {
  const bookData = {
    path: metadata.path,
    name: metadata.name || '',
    title: metadata.title || '',
    author: metadata.author || '',
    coverUrl: metadata.coverUrl || null,
    lastModified: metadata.lastModified || 0,
    lastAccessed: metadata.lastAccessed || Date.now(),
    fileSize: metadata.fileSize || 0,
    progress: metadata.progress || 0,
    currentCfi: metadata.currentCfi || '',
    totalPages: metadata.totalPages || 0,
    bookmarks: metadata.bookmarks || [],
    notes: metadata.notes || [],
    settings: metadata.settings || {},
    timestamp: Date.now()
  };
  
  return executeTransaction(BOOKS_STORE, 'readwrite', (store) => {
    return store.put(bookData);
  });
}

/**
 * Retrieve book metadata by path
 * @param {string} path - Book file path
 * @returns {Promise<Object|null>} Book metadata or null
 */
export async function getBookMetadata(path) {
  try {
    return await executeTransaction(BOOKS_STORE, 'readonly', (store) => {
      return store.get(path);
    });
  } catch (error) {
    console.warn('Error retrieving book metadata:', error);
    return null;
  }
}

/**
 * Get all stored books with optional filtering and sorting
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Array of book metadata
 */
export async function getStoredBooks(options = {}) {
  try {
    const books = await executeTransaction(BOOKS_STORE, 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    });
    
    let filteredBooks = books;
    
    // Apply filters
    if (options.author) {
      filteredBooks = filteredBooks.filter(book => 
        book.author.toLowerCase().includes(options.author.toLowerCase())
      );
    }
    
    if (options.title) {
      filteredBooks = filteredBooks.filter(book => 
        book.title.toLowerCase().includes(options.title.toLowerCase())
      );
    }
    
    // Apply sorting
    if (options.sortBy) {
      filteredBooks.sort((a, b) => {
        const aVal = a[options.sortBy] || '';
        const bVal = b[options.sortBy] || '';
        
        if (options.sortOrder === 'desc') {
          return bVal.localeCompare ? bVal.localeCompare(aVal) : bVal - aVal;
        } else {
          return aVal.localeCompare ? aVal.localeCompare(bVal) : aVal - bVal;
        }
      });
    } else {
      // Default sort by last accessed
      filteredBooks.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    }
    
    return filteredBooks;
  } catch (error) {
    console.warn('Error retrieving stored books:', error);
    return [];
  }
}

/**
 * Update reading progress for a book
 * @param {string} path - Book path
 * @param {Object} progress - Progress data
 * @returns {Promise<void>}
 */
export async function updateReadingProgress(path, progress) {
  try {
    const existingBook = await getBookMetadata(path);
    if (!existingBook) {
      console.warn('Cannot update progress for unknown book:', path);
      return;
    }
    
    const updatedBook = {
      ...existingBook,
      progress: progress.percentage || existingBook.progress,
      currentCfi: progress.cfi || existingBook.currentCfi,
      lastAccessed: Date.now(),
      totalPages: progress.totalPages || existingBook.totalPages
    };
    
    await storeBookMetadata(updatedBook);
  } catch (error) {
    console.error('Error updating reading progress:', error);
  }
}

/**
 * Remove book metadata
 * @param {string} path - Book path
 * @returns {Promise<void>}
 */
export async function removeBookMetadata(path) {
  return executeTransaction(BOOKS_STORE, 'readwrite', (store) => {
    return store.delete(path);
  });
}

/**
 * Clear all book metadata
 * @returns {Promise<void>}
 */
export async function clearAllBookMetadata() {
  return executeTransaction(BOOKS_STORE, 'readwrite', (store) => {
    return store.clear();
  });
}

/***** Settings Management *****/

/**
 * Store application settings
 * @param {string} key - Setting key
 * @param {*} value - Setting value
 * @returns {Promise<void>}
 */
export async function storeSetting(key, value) {
  return executeTransaction(SETTINGS_STORE, 'readwrite', (store) => {
    return store.put({ 
      key, 
      value, 
      timestamp: Date.now() 
    });
  });
}

/**
 * Retrieve application setting
 * @param {string} key - Setting key
 * @param {*} defaultValue - Default value if not found
 * @returns {Promise<*>} Setting value or default
 */
export async function getSetting(key, defaultValue = null) {
  try {
    const result = await executeTransaction(SETTINGS_STORE, 'readonly', (store) => {
      return store.get(key);
    });
    return result ? result.value : defaultValue;
  } catch (error) {
    console.warn('Error retrieving setting:', error);
    return defaultValue;
  }
}

/**
 * Get all application settings
 * @returns {Promise<Object>} Settings object
 */
export async function getAllSettings() {
  try {
    const settings = await executeTransaction(SETTINGS_STORE, 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    });
    
    // Convert array to object
    const settingsObj = {};
    settings.forEach(setting => {
      settingsObj[setting.key] = setting.value;
    });
    
    return settingsObj;
  } catch (error) {
    console.warn('Error retrieving all settings:', error);
    return {};
  }
}

/**
 * Remove a setting
 * @param {string} key - Setting key to remove
 * @returns {Promise<void>}
 */
export async function removeSetting(key) {
  return executeTransaction(SETTINGS_STORE, 'readwrite', (store) => {
    return store.delete(key);
  });
}

/***** Bookmarks Management *****/

/**
 * Add a bookmark
 * @param {Object} bookmark - Bookmark data
 * @returns {Promise<number>} Bookmark ID
 */
export async function addBookmark(bookmark) {
  const bookmarkData = {
    bookPath: bookmark.bookPath,
    bookTitle: bookmark.bookTitle || '',
    cfi: bookmark.cfi,
    title: bookmark.title || 'Untitled Bookmark',
    note: bookmark.note || '',
    chapter: bookmark.chapter || '',
    preview: bookmark.preview || '',
    timestamp: Date.now()
  };
  
  const result = await executeTransaction(BOOKMARKS_STORE, 'readwrite', (store) => {
    return store.add(bookmarkData);
  });
  
  return result;
}

/**
 * Get bookmarks for a specific book
 * @param {string} bookPath - Book path
 * @returns {Promise<Array>} Array of bookmarks
 */
export async function getBookBookmarks(bookPath) {
  try {
    return await executeTransaction(BOOKMARKS_STORE, 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const index = store.index('bookPath');
        const request = index.getAll(bookPath);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    });
  } catch (error) {
    console.warn('Error retrieving bookmarks:', error);
    return [];
  }
}

/**
 * Get all bookmarks across all books
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Array of bookmarks
 */
export async function getAllBookmarks(options = {}) {
  try {
    const bookmarks = await executeTransaction(BOOKMARKS_STORE, 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    });
    
    // Sort by timestamp (newest first) unless specified otherwise
    bookmarks.sort((a, b) => {
      if (options.sortBy === 'title') {
        return a.title.localeCompare(b.title);
      } else if (options.sortBy === 'bookTitle') {
        return a.bookTitle.localeCompare(b.bookTitle);
      } else {
        return b.timestamp - a.timestamp;
      }
    });
    
    return bookmarks;
  } catch (error) {
    console.warn('Error retrieving all bookmarks:', error);
    return [];
  }
}

/**
 * Update a bookmark
 * @param {number} id - Bookmark ID
 * @param {Object} updates - Updates to apply
 * @returns {Promise<void>}
 */
export async function updateBookmark(id, updates) {
  const existingBookmark = await executeTransaction(BOOKMARKS_STORE, 'readonly', (store) => {
    return store.get(id);
  });
  
  if (!existingBookmark) {
    throw new Error('Bookmark not found');
  }
  
  const updatedBookmark = {
    ...existingBookmark,
    ...updates,
    timestamp: existingBookmark.timestamp, // Keep original timestamp
    updatedAt: Date.now()
  };
  
  return executeTransaction(BOOKMARKS_STORE, 'readwrite', (store) => {
    return store.put(updatedBookmark);
  });
}

/**
 * Remove a bookmark
 * @param {number} id - Bookmark ID
 * @returns {Promise<void>}
 */
export async function removeBookmark(id) {
  return executeTransaction(BOOKMARKS_STORE, 'readwrite', (store) => {
    return store.delete(id);
  });
}

/**
 * Remove all bookmarks for a book
 * @param {string} bookPath - Book path
 * @returns {Promise<void>}
 */
export async function removeBookBookmarks(bookPath) {
  const bookmarks = await getBookBookmarks(bookPath);
  
  return executeTransaction(BOOKMARKS_STORE, 'readwrite', (store) => {
    const promises = bookmarks.map(bookmark => {
      return new Promise((resolve, reject) => {
        const request = store.delete(bookmark.id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });
    
    return Promise.all(promises);
  });
}

/***** Database Maintenance *****/

/**
 * Get database storage usage information
 * @returns {Promise<Object>} Storage usage info
 */
export async function getStorageInfo() {
  try {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      return {
        quota: estimate.quota,
        usage: estimate.usage,
        available: estimate.quota - estimate.usage,
        usageDetails: estimate.usageDetails || {}
      };
    }
    return { quota: 0, usage: 0, available: 0 };
  } catch (error) {
    console.warn('Error getting storage info:', error);
    return { quota: 0, usage: 0, available: 0 };
  }
}

/**
 * Clean up old or orphaned data
 * @param {Object} options - Cleanup options
 * @returns {Promise<Object>} Cleanup results
 */
export async function cleanupDatabase(options = {}) {
  const maxAge = options.maxAge || (30 * 24 * 60 * 60 * 1000); // 30 days
  const cutoffTime = Date.now() - maxAge;
  
  let cleanupResults = {
    booksRemoved: 0,
    bookmarksRemoved: 0,
    settingsRemoved: 0
  };
  
  try {
    // Clean up old books that haven't been accessed
    if (options.cleanBooks !== false) {
      const books = await getStoredBooks();
      const oldBooks = books.filter(book => 
        (book.lastAccessed || 0) < cutoffTime
      );
      
      for (const book of oldBooks) {
        await removeBookMetadata(book.path);
        await removeBookBookmarks(book.path);
        cleanupResults.booksRemoved++;
      }
    }
    
    // Clean up orphaned bookmarks (books no longer in library)
    if (options.cleanBookmarks !== false) {
      const allBookmarks = await getAllBookmarks();
      const allBooks = await getStoredBooks();
      const bookPaths = new Set(allBooks.map(book => book.path));
      
      const orphanedBookmarks = allBookmarks.filter(bookmark => 
        !bookPaths.has(bookmark.bookPath)
      );
      
      for (const bookmark of orphanedBookmarks) {
        await removeBookmark(bookmark.id);
        cleanupResults.bookmarksRemoved++;
      }
    }
    
    console.log('Database cleanup completed:', cleanupResults);
    return cleanupResults;
    
  } catch (error) {
    console.error('Error during database cleanup:', error);
    throw error;
  }
}

/**
 * Export all data for backup
 * @returns {Promise<Object>} Exported data
 */
export async function exportData() {
  try {
    const [books, bookmarks, settings] = await Promise.all([
      getStoredBooks(),
      getAllBookmarks(),
      getAllSettings()
    ]);
    
    return {
      version: DB_VERSION,
      exportDate: new Date().toISOString(),
      books,
      bookmarks,
      settings
    };
  } catch (error) {
    console.error('Error exporting data:', error);
    throw error;
  }
}

/**
 * Import data from backup
 * @param {Object} data - Data to import
 * @param {Object} options - Import options
 * @returns {Promise<Object>} Import results
 */
export async function importData(data, options = {}) {
  const results = {
    booksImported: 0,
    bookmarksImported: 0,
    settingsImported: 0,
    errors: []
  };
  
  try {
    // Import books
    if (data.books && Array.isArray(data.books)) {
      for (const book of data.books) {
        try {
          if (options.overwrite || !(await getBookMetadata(book.path))) {
            await storeBookMetadata(book);
            results.booksImported++;
          }
        } catch (error) {
          results.errors.push(`Error importing book ${book.path}: ${error.message}`);
        }
      }
    }
    
    // Import bookmarks
    if (data.bookmarks && Array.isArray(data.bookmarks)) {
      for (const bookmark of data.bookmarks) {
        try {
          // Remove ID to let it auto-increment
          // eslint-disable-next-line no-unused-vars
          const { id, ...bookmarkData } = bookmark;
          await addBookmark(bookmarkData);
          results.bookmarksImported++;
        } catch (error) {
          results.errors.push(`Error importing bookmark: ${error.message}`);
        }
      }
    }
    
    // Import settings
    if (data.settings && typeof data.settings === 'object') {
      for (const [key, value] of Object.entries(data.settings)) {
        try {
          if (options.overwrite || !(await getSetting(key))) {
            await storeSetting(key, value);
            results.settingsImported++;
          }
        } catch (error) {
          results.errors.push(`Error importing setting ${key}: ${error.message}`);
        }
      }
    }
    
    console.log('Data import completed:', results);
    return results;
    
  } catch (error) {
    console.error('Error importing data:', error);
    throw error;
  }
}

/**
 * Check database health and integrity
 * @returns {Promise<Object>} Health check results
 */
export async function checkDatabaseHealth() {
  const health = {
    status: 'healthy',
    issues: [],
    stats: {
      totalBooks: 0,
      totalBookmarks: 0,
      totalSettings: 0,
      storageUsed: 0
    }
  };
  
  try {
    // Get basic stats
    const [books, bookmarks, settings, storageInfo] = await Promise.all([
      getStoredBooks(),
      getAllBookmarks(),
      getAllSettings(),
      getStorageInfo()
    ]);
    
    health.stats.totalBooks = books.length;
    health.stats.totalBookmarks = bookmarks.length;
    health.stats.totalSettings = Object.keys(settings).length;
    health.stats.storageUsed = storageInfo.usage;
    
    // Check for orphaned bookmarks
    const bookPaths = new Set(books.map(book => book.path));
    const orphanedBookmarks = bookmarks.filter(bookmark => 
      !bookPaths.has(bookmark.bookPath)
    );
    
    if (orphanedBookmarks.length > 0) {
      health.issues.push({
        type: 'orphaned_bookmarks',
        count: orphanedBookmarks.length,
        message: `Found ${orphanedBookmarks.length} orphaned bookmarks`
      });
    }
    
    // Check for books with invalid data
    const invalidBooks = books.filter(book => 
      !book.path || !book.name
    );
    
    if (invalidBooks.length > 0) {
      health.issues.push({
        type: 'invalid_books',
        count: invalidBooks.length,
        message: `Found ${invalidBooks.length} books with invalid data`
      });
    }
    
    // Check storage usage
    if (storageInfo.quota > 0) {
      const usagePercentage = (storageInfo.usage / storageInfo.quota) * 100;
      if (usagePercentage > 80) {
        health.issues.push({
          type: 'high_storage_usage',
          percentage: usagePercentage,
          message: `Storage usage is at ${usagePercentage.toFixed(1)}%`
        });
      }
    }
    
    if (health.issues.length > 0) {
      health.status = 'issues_found';
    }
    
    return health;
    
  } catch (error) {
    health.status = 'error';
    health.error = error.message;
    return health;
  }
}

/***** Initialization *****/

/**
 * Initialize the database and perform any necessary migrations
 * @returns {Promise<void>}
 */
export async function initializeDatabase() {
  try {
    console.log('Initializing HTMLReader database...');
    
    // Just opening the database will trigger upgrades if needed
    const db = await getDB();
    db.close();
    
    // Perform health check
    const health = await checkDatabaseHealth();
    console.log('Database health check:', health);
    
    // Auto-cleanup if there are issues (but not on first run)
    if (health.issues.length > 0 && health.stats.totalBooks > 0) {
      console.log('Performing automatic cleanup...');
      await cleanupDatabase({ maxAge: 60 * 24 * 60 * 60 * 1000 }); // 60 days
    }
    
    console.log('Database initialization completed');
    
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

// Auto-initialize on import
initializeDatabase().catch(console.error);