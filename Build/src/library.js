import { storeLibraryHandle, getStoredLibraryHandle } from "./indexedDB";
import { openBookFromEntry } from "./book"
import ePub from "epubjs";
import { showError } from "./main";

/***** DOM Elements *****/
const libraryContainer = document.getElementById('library-container');
const libraryContent = document.getElementById('library-content');
const overlay = document.getElementById('overlay');

export async function openLibrary() {
  try {
    // Try to retrieve stored library directory handle
    let dirHandle = await getStoredLibraryHandle();
    if (!dirHandle) {
      // If no stored handle, prompt user
      dirHandle = await window.showDirectoryPicker();
      await storeLibraryHandle(dirHandle);
    }
    const files = [];
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.epub')) {
        files.push(entry);
      }
    }
    displayLibraryGrid(files);
    toggleLibrary(true);
  } catch (err) {
    showError('Failed to open library: ' + err.message);
  }
}
// Fallback for multiple file selection if directory picker is not available
export function handleLibraryFiles(e) {
  const files = Array.from(e.target.files);
  displayLibraryGrid(files);
  toggleLibrary(true);
}

async function displayLibraryGrid(fileEntries) {
  libraryContent.innerHTML = '';
  if (fileEntries.length === 0) {
    const msg = document.createElement('div');
    msg.textContent = 'No EPUB files found.';
    libraryContent.appendChild(msg);
    return;
  }
  for (const entry of fileEntries) {
    const item = await createLibraryItem(entry);
    libraryContent.appendChild(item);
  }
}

async function createLibraryItem(fileEntry) {
  const item = document.createElement('div');
  item.className = 'library-item';
  const img = document.createElement('img');
  img.className = 'library-cover';
  img.src = '';
  const titleDiv = document.createElement('div');
  titleDiv.className = 'library-title';
  titleDiv.textContent = fileEntry.name;
  item.appendChild(img);
  item.appendChild(titleDiv);

  try {
    // If using the File System Access API:
    const file = (typeof fileEntry.getFile === 'function')
                  ? await fileEntry.getFile()
                  : fileEntry;
    const arrayBuffer = await file.arrayBuffer();
    const tempBook = ePub(arrayBuffer);
    // Attempt to retrieve cover image URL
    const coverUrl = await tempBook.coverUrl();
    if (coverUrl) {
      img.src = coverUrl;
    } else {
      // Use a generic placeholder if no cover
      img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAMAAACahl6sAAAAM1BMVEX///+hoaGcnJzPz8/Nzc3FxcXn5+fQ0NDy8vL29vbw8PDv7+/d3d2+vr6UlJSakGz1AAACNklEQVR4nO3d2ZKDIBAFUa8El//+uvLFT6qkSpknG/JpLve86o3QF8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD8S/w66a8vEcn8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ58n8eHS6HQ5+n/wP2S/3mmugUsAAAAASUVORK5CYII=';
    }
    const metadata = await tempBook.loaded.metadata;
    if (metadata.title) {
      titleDiv.textContent = metadata.title;
    }
  } catch (err) {
    console.error('Error loading cover for', fileEntry.name, err);
  }

  // No { once: true } so user can try again if there's an error
  item.addEventListener('click', () => {
    openBookFromEntry(fileEntry);
  });

  return item;
}

export function toggleLibrary(forceOpen) {
  if (forceOpen === true) {
    libraryContainer.classList.add('open');
    overlay.classList.add('open');
  } else if (forceOpen === false) {
    libraryContainer.classList.remove('open');
    overlay.classList.remove('open');
  } else {
    libraryContainer.classList.toggle('open');
    overlay.classList.toggle('open');
  }
}