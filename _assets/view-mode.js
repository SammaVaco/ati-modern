const STYLE_VALUES = ['modern', 'classic'];
const NAV_VALUES = ['modern', 'legacy'];
const STYLE_KEY = 'ati:viewStyle';
const NAV_KEY = 'ati:navMode';

export function normalizeModeValue(value, allowedValues) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized) return null;
  return allowedValues.includes(normalized) ? normalized : null;
}

export function resolveViewModes({ searchParams, storedStyle, storedNav }) {
  const urlStyle = normalizeModeValue(searchParams?.get('style'), STYLE_VALUES);
  const urlNav = normalizeModeValue(searchParams?.get('nav'), NAV_VALUES);
  const safeStoredStyle = normalizeModeValue(storedStyle, STYLE_VALUES);
  const safeStoredNav = normalizeModeValue(storedNav, NAV_VALUES);

  const style = urlStyle || safeStoredStyle || 'modern';
  let nav = urlNav || safeStoredNav;
  if (!nav) {
    nav = style === 'classic' ? 'legacy' : 'modern';
  }

  return { style, nav };
}

function readStorageValue(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures in private/locked-down contexts.
  }
}

function hasLegacyNavTargets(documentRef) {
  return Boolean(
    documentRef.querySelector('[data-nav-replaced="true"], #H_crumbtrail, #H_tipitakaLinks, ul#toolMenu, ul.crumblist')
  );
}

function formatModeLabel(prefix, mode, legacyAvailable = true) {
  const capitalized = mode.charAt(0).toUpperCase() + mode.slice(1);
  if (prefix === 'Nav' && mode === 'legacy' && !legacyAvailable) {
    return `${prefix}: ${capitalized} (n/a)`;
  }
  return `${prefix}: ${capitalized}`;
}

function updateControlButton(button, { prefix, mode, active, legacyAvailable }) {
  if (!button) return;
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
  button.textContent = formatModeLabel(prefix, mode, legacyAvailable);
}

function applyModes(documentRef, modes) {
  const root = documentRef.documentElement;
  if (!root) return;

  root.classList.remove('mode-style-modern', 'mode-style-classic');
  root.classList.add(`mode-style-${modes.style}`);
  root.classList.remove('mode-nav-modern', 'mode-nav-legacy');
  root.classList.add(`mode-nav-${modes.nav}`);

  const modernSheet = documentRef.getElementById('ati-modern-css');
  if (modernSheet) {
    modernSheet.disabled = modes.style === 'classic';
    modernSheet.setAttribute('data-view-mode-enabled', modes.style === 'modern' ? 'true' : 'false');
  }

  const legacyAvailable = hasLegacyNavTargets(documentRef);
  const styleButton = documentRef.querySelector('.view-mode-button[data-view-mode-action="style"]');
  const navButton = documentRef.querySelector('.view-mode-button[data-view-mode-action="nav"]');
  updateControlButton(styleButton, {
    prefix: 'Style',
    mode: modes.style,
    active: modes.style === 'classic',
    legacyAvailable
  });
  updateControlButton(navButton, {
    prefix: 'Nav',
    mode: modes.nav,
    active: modes.nav === 'legacy',
    legacyAvailable
  });
}

function updateUrl(modes) {
  const url = new URL(window.location.href);
  url.searchParams.set('style', modes.style);
  url.searchParams.set('nav', modes.nav);
  const localPath = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(null, '', localPath);
}

function initViewModeControls() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const storedStyle = readStorageValue(STYLE_KEY);
  const storedNav = readStorageValue(NAV_KEY);
  const params = new URLSearchParams(window.location.search);
  const modes = resolveViewModes({
    searchParams: params,
    storedStyle,
    storedNav
  });

  const explicitUrlNav = normalizeModeValue(params.get('nav'), NAV_VALUES);
  const explicitStoredNav = normalizeModeValue(storedNav, NAV_VALUES);
  let navIsExplicit = Boolean(explicitUrlNav || explicitStoredNav);

  applyModes(document, modes);

  const styleButton = document.querySelector('.view-mode-button[data-view-mode-action="style"]');
  if (styleButton) {
    styleButton.addEventListener('click', () => {
      modes.style = modes.style === 'modern' ? 'classic' : 'modern';
      if (!navIsExplicit) {
        modes.nav = modes.style === 'classic' ? 'legacy' : 'modern';
      }
      writeStorageValue(STYLE_KEY, modes.style);
      if (!navIsExplicit) {
        writeStorageValue(NAV_KEY, modes.nav);
      }
      applyModes(document, modes);
      updateUrl(modes);
    });
  }

  const navButton = document.querySelector('.view-mode-button[data-view-mode-action="nav"]');
  if (navButton) {
    navButton.addEventListener('click', () => {
      modes.nav = modes.nav === 'modern' ? 'legacy' : 'modern';
      navIsExplicit = true;
      writeStorageValue(NAV_KEY, modes.nav);
      applyModes(document, modes);
      updateUrl(modes);
    });
  }
}

initViewModeControls();
