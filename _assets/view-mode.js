const MODE_KEY = 'ati:viewMode';
const MODES = ['modern', 'classic'];

export function normalizeViewMode(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized) return null;
  return MODES.includes(normalized) ? normalized : null;
}

export function resolveViewMode({ searchParams, storedMode }) {
  const urlMode = normalizeViewMode(searchParams?.get('mode'));
  const cachedMode = normalizeViewMode(storedMode);
  return urlMode || cachedMode || 'modern';
}

function readStoredMode() {
  try {
    return window.localStorage.getItem(MODE_KEY);
  } catch {
    return null;
  }
}

function writeStoredMode(mode) {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Ignore write failures in private browsing.
  }
}

function applyMode(mode) {
  const root = document.documentElement;
  root.classList.remove('mode-modern', 'mode-classic');
  root.classList.add(`mode-${mode}`);

  const modernStyles = document.getElementById('ati-modern-css');
  if (modernStyles) {
    modernStyles.disabled = mode === 'classic';
  }

  const button = document.querySelector('button[data-view-mode-toggle]');
  if (button) {
    const nextMode = mode === 'modern' ? 'Classic' : 'Modern';
    button.textContent = `Switch to ${nextMode} mode`;
    button.setAttribute('aria-pressed', mode === 'classic' ? 'true' : 'false');
  }
}

function updateUrl(mode) {
  const url = new URL(window.location.href);
  url.searchParams.set('mode', mode);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function initViewMode() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const currentMode = resolveViewMode({
    searchParams: new URLSearchParams(window.location.search),
    storedMode: readStoredMode()
  });

  applyMode(currentMode);
  writeStoredMode(currentMode);
  updateUrl(currentMode);

  const button = document.querySelector('button[data-view-mode-toggle]');
  if (!button) return;

  button.addEventListener('click', () => {
    const activeMode = document.documentElement.classList.contains('mode-classic') ? 'classic' : 'modern';
    const nextMode = activeMode === 'modern' ? 'classic' : 'modern';
    applyMode(nextMode);
    writeStoredMode(nextMode);
    updateUrl(nextMode);
  });
}

initViewMode();
