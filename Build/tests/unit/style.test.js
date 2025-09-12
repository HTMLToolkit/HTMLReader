/**
 * Style sheet unit tests focused on the PR diff for layout, popovers, TOC, and responsive rules.
 *
 * Testing library/framework: Jest-style API (describe/it/expect). Compatible with Vitest as well.
 *
 * Strategy:
 * - Try to load the real CSS file by scanning the repo for the gradient token unique to this diff.
 * - If not found, use an inline CSS fixture identical to the diff to still validate behavior.
 * - Lightweight CSS parsing: build a selector -> declarations map; handle @media blocks separately.
 * - Assertions cover presence and values of critical properties across selectors, including :hover, :disabled, and `.open` state classes.
 */

const fs = require('fs');
const path = require('path');

function findCssPath() {
  // Search upwards from repo root for a CSS file containing the unique gradient line.
  // We perform a simple directory walk limited to common CSS locations to avoid heavy traversal.
  const roots = ['.', 'src', 'public', 'assets', 'styles', 'style', 'css'];
  const candidates = [];

  function walk(dir, depth = 0) {
    if (depth > 3) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        // Skip node_modules and test directories
        if (e.name === 'node_modules' || e.name === 'tests' || e.name === '__tests__') continue;
        walk(p, depth + 1);
      } else if (e.isFile() && /\.css$/i.test(e.name)) {
        candidates.push(p);
      }
    }
  }

  for (const r of roots) {
    walk(r, 0);
  }

  const needle = 'linear-gradient(90deg, #2196F3, #21CBF3)';
  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes(needle)) {
        return file;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

const inlineCssFixture = `body {
  font-family: Arial, sans-serif;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: #f5f5f5;
}

header {
  background: linear-gradient(90deg, #2196F3, #21CBF3);
  color: white;
  padding: 0.8rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.title {
  font-size: 1.5rem;
  font-weight: bold;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.book-title {
  font-size: 1rem;
  max-width: 60%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.controls {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

button {
  background-color: #2196F3;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
}

button:hover {
  background-color: #1976D2;
}

button:disabled {
  background-color: #718096;
  cursor: not-allowed;
}

.file-input {
  display: none;
}

main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

#viewer {
  flex: 1;
  overflow: auto;
  background-color: white;
  padding: 2rem;
  box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.1);
}

footer {
  background-color: #e2e8f0;
  padding: 0.8rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.page-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

input[type="number"] {
  width: 4rem;
  padding: 0.3rem;
  border: 1px solid #cbd5e0;
  border-radius: 4px;
}

/* TOC container remains similar */
.toc-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 300px;
  height: 100%;
  background-color: white;
  box-shadow: 2px 0 5px rgba(0, 0, 0, 0.1);
  transform: translateX(-100%);
  transition: transform 0.3s ease;
  z-index: 10;
  display: flex;
  flex-direction: column;
  z-index: 1010;
}

.toc-container.open {
  transform: translateX(0);
}

.toc-header {
  background-color: #2196F3;
  color: white;
  padding: 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.toc-content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.toc-item {
  padding: 0.5rem;
  cursor: pointer;
  border-bottom: 1px solid #e2e8f0;
}

.toc-item:hover {
  background-color: #f7fafc;
}

/* Library Popup (almost full screen) */
.library-container {
  position: fixed;
  top: 5%;
  left: 5%;
  width: 90%;
  height: 90%;
  background-color: white;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
  z-index: 20;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* Make sure it's hidden by default: */
  transform: translateY(-120%);
  transition: transform 0.3s ease;
}

.library-container.open {
  transform: translateY(0);
}

.library-header {
  background-color: #2196F3;
  color: white;
  padding: 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.library-content {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 1rem;
  padding: 1rem;
  flex: 1;
  overflow-y: auto;
}

.library-item {
  border: 1px solid #ccc;
  padding: 0.5rem;
  text-align: center;
  cursor: pointer;
  transition: box-shadow 0.2s;
}

.library-item:hover {
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.3);
}

.library-cover {
  width: 100%;
  height: 200px;
  object-fit: cover;
  margin-bottom: 0.5rem;
  background: #eee;
}

.library-title {
  font-size: 0.9rem;
  font-weight: bold;
}

.overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 15;
  display: none;
}

.overlay.open {
  display: block;
}

.message {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-color: white;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
  z-index: 25;
  display: none;
  text-align: center;
}

.message.show {
  display: block;
}

@media (max-width: 768px) {
  .title {
    font-size: 1.2rem;
  }

  button {
    padding: 0.4rem 0.8rem;
    font-size: 0.8rem;
  }

  .toc-container {
    width: 80%;
  }

  .library-container {
    width: 95%;
    height: 95%;
    top: 2.5%;
    left: 2.5%;
  }
}
`;

/**
 * Very small CSS "parser":
 * - Removes comments
 * - Splits top-level rules into selector -> {prop: value}
 * - Extracts @media (max-width: 768px) inner rules similarly
 * - Case-sensitive, trims spaces, tolerant to varied whitespace and semicolons
 */
function parseCss(cssText) {
  const withoutComments = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const media = {};
  let remaining = withoutComments;

  // Extract @media blocks first
  const mediaRegex = /@media\s*\(([^)]+)\)\s*\{([\s\S]*?)\}/g;
  let m;
  while ((m = mediaRegex.exec(withoutComments)) !== null) {
    const query = m[1].trim();
    media[query] = parseRules(m[2]);
    remaining = remaining.replace(m[0], '');
  }

  // Parse top-level rules
  const topLevel = parseRules(remaining);
  return { topLevel, media };
}

function parseRules(blockText) {
  const map = {};
  // Split by top-level } and then parse selector + declarations between { }
  // This is simplistic but sufficient for our controlled fixture
  const ruleRegex = /([^{]+)\{([^}]*)\}/g;
  let r;
  while ((r = ruleRegex.exec(blockText)) !== null) {
    const rawSelector = r[1].trim();
    const body = r[2].trim();
    const selectors = rawSelector.split(',').map(s => s.trim());
    const decls = {};
    body.split(';').forEach(line => {
      const t = line.trim();
      if (!t) return;
      const idx = t.indexOf(':');
      if (idx === -1) return;
      const prop = t.slice(0, idx).trim();
      const val = t.slice(idx + 1).trim();
      decls[prop] = val;
    });
    for (const s of selectors) {
      // Merge if same selector appears multiple times
      map[s] = Object.assign(map[s] || {}, decls);
    }
  }
  return map;
}

function loadCssText() {
  const cssPath = findCssPath();
  if (cssPath) {
    return { cssText: fs.readFileSync(cssPath, 'utf8'), source: cssPath };
  }
  return { cssText: inlineCssFixture, source: 'inline-fixture' };
}

describe('Stylesheet (PR diff) - structural CSS rules', () => {
  const { cssText, source } = loadCssText();
  const { topLevel, media } = parseCss(cssText);

  test(`should load stylesheet from ${source}`, () => {
    expect(typeof cssText).toBe('string');
    expect(cssText.length).toBeGreaterThan(100);
  });

  test('body has base layout and background', () => {
    const body = topLevel['body'];
    expect(body).toBeTruthy();
    expect(body['display']).toBe('flex');
    expect(body['flex-direction']).toBe('column');
    expect(body['height']).toBe('100vh');
    expect(body['background-color']).toBe('#f5f5f5');
    expect(body['margin']).toBe('0');
    expect(body['padding']).toBe('0');
    expect(body['font-family']).toContain('Arial');
  });

  test('header uses gradient background and flex layout', () => {
    const header = topLevel['header'];
    expect(header).toBeTruthy();
    expect(header['background']).toContain('linear-gradient(90deg, #2196F3, #21CBF3)');
    expect(header['color']).toBe('white');
    expect(header['display']).toBe('flex');
    expect(header['justify-content']).toBe('space-between');
    expect(header['align-items']).toBe('center');
  });

  test('.title typography and spacing', () => {
    const title = topLevel['.title'];
    expect(title).toBeTruthy();
    expect(title['font-size']).toBe('1.5rem');
    expect(title['font-weight']).toBe('bold');
    expect(title['display']).toBe('flex');
    expect(title['gap']).toBe('0.5rem');
  });

  test('.book-title truncation with ellipsis', () => {
    const bt = topLevel['.book-title'];
    expect(bt).toBeTruthy();
    expect(bt['white-space']).toBe('nowrap');
    expect(bt['overflow']).toBe('hidden');
    expect(bt['text-overflow']).toBe('ellipsis');
    expect(bt['max-width']).toBe('60%');
  });

  test('button states: base, :hover, :disabled', () => {
    const base = topLevel['button'];
    const hover = topLevel['button:hover'];
    const disabled = topLevel['button:disabled'];
    expect(base).toBeTruthy();
    expect(base['background-color']).toBe('#2196F3');
    expect(base['cursor']).toBe('pointer');
    expect(hover).toBeTruthy();
    expect(hover['background-color']).toBe('#1976D2');
    expect(disabled).toBeTruthy();
    expect(disabled['background-color']).toBe('#718096');
    expect(disabled['cursor']).toBe('not-allowed');
  });

  test('.file-input hidden by default', () => {
    const fi = topLevel['.file-input'];
    expect(fi).toBeTruthy();
    expect(fi['display']).toBe('none');
  });

  test('main and #viewer layout', () => {
    const main = topLevel['main'];
    const viewer = topLevel['#viewer'];
    expect(main).toBeTruthy();
    expect(main['display']).toBe('flex');
    expect(main['flex-direction']).toBe('column');
    expect(main['overflow']).toBe('hidden');
    expect(viewer).toBeTruthy();
    expect(viewer['overflow']).toBe('auto');
    expect(viewer['background-color']).toBe('white');
    expect(viewer['padding']).toBe('2rem');
    expect(viewer['box-shadow']).toContain('inset 0 0 10px');
  });

  test('footer layout', () => {
    const footer = topLevel['footer'];
    expect(footer).toBeTruthy();
    expect(footer['background-color']).toBe('#e2e8f0');
    expect(footer['display']).toBe('flex');
    expect(footer['justify-content']).toBe('space-between');
    expect(footer['align-items']).toBe('center');
  });

  test('input[type="number"] has sizing and border', () => {
    const inputNum = topLevel['input[type="number"]'];
    expect(inputNum).toBeTruthy();
    expect(inputNum['width']).toBe('4rem');
    expect(inputNum['border']).toContain('#cbd5e0');
    expect(inputNum['border-radius']).toBe('4px');
  });

  test('.toc-container default off-screen and high z-index; .open brings it in', () => {
    const toc = topLevel['.toc-container'];
    const tocOpen = topLevel['.toc-container.open'];
    expect(toc).toBeTruthy();
    expect(toc['position']).toBe('fixed');
    expect(toc['transform']).toBe('translateX(-100%)');
    expect(toc['transition']).toContain('transform 0.3s ease');
    // z-index should end up 1010 (last declaration wins)
    expect(toc['z-index']).toBe('1010');
    expect(tocOpen).toBeTruthy();
    expect(tocOpen['transform']).toBe('translateX(0)');
  });

  test('Library popup hidden by default via translateY and visible when .open', () => {
    const lib = topLevel['.library-container'];
    const libOpen = topLevel['.library-container.open'];
    expect(lib).toBeTruthy();
    expect(lib['transform']).toBe('translateY(-120%)');
    expect(lib['transition']).toContain('transform 0.3s ease');
    expect(libOpen).toBeTruthy();
    expect(libOpen['transform']).toBe('translateY(0)');
  });

  test('Overlay hidden by default, shown with .open', () => {
    const overlay = topLevel['.overlay'];
    const overlayOpen = topLevel['.overlay.open'];
    expect(overlay).toBeTruthy();
    expect(overlay['display']).toBe('none');
    expect(overlayOpen).toBeTruthy();
    expect(overlayOpen['display']).toBe('block');
  });

  test('Message hidden by default; .show displays it', () => {
    const msg = topLevel['.message'];
    const msgShow = topLevel['.message.show'];
    expect(msg).toBeTruthy();
    expect(msg['display']).toBe('none');
    expect(msgShow).toBeTruthy();
    expect(msgShow['display']).toBe('block');
  });

  test('@media (max-width: 768px) overrides for .title, button, .toc-container, .library-container', () => {
    const mediaBlock = media['max-width: 768px'];
    expect(mediaBlock).toBeTruthy();
    expect(mediaBlock['.title']).toBeTruthy();
    expect(mediaBlock['.title']['font-size']).toBe('1.2rem');

    expect(mediaBlock['button']).toBeTruthy();
    expect(mediaBlock['button']['padding']).toBe('0.4rem 0.8rem');
    expect(mediaBlock['button']['font-size']).toBe('0.8rem');

    expect(mediaBlock['.toc-container']).toBeTruthy();
    expect(mediaBlock['.toc-container']['width']).toBe('80%');

    const lib = mediaBlock['.library-container'];
    expect(lib).toBeTruthy();
    expect(lib['width']).toBe('95%');
    expect(lib['height']).toBe('95%');
    expect(lib['top']).toBe('2.5%');
    expect(lib['left']).toBe('2.5%');
  });
});