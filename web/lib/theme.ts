export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'pennyahead-theme';
const CHANGE_EVENT = 'pennyahead-theme-change';
const SYSTEM_DARK = '(prefers-color-scheme: dark)';
let preference: ThemePreference = 'system';

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return preference;
  }
}

function applyTheme() {
  const dark =
    preference === 'dark' ||
    (preference === 'system' && matchMedia(SYSTEM_DARK).matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

export function setThemePreference(value: ThemePreference) {
  preference = value;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* Keep it for this page. */
  }
  applyTheme();
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export const getThemePreference = () => preference;
export const getServerThemePreference = (): ThemePreference => 'system';

export function subscribeToTheme(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

export function watchTheme() {
  const system = matchMedia(SYSTEM_DARK);
  const refresh = () => {
    preference = readPreference();
    applyTheme();
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };
  const storageChanged = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) refresh();
  };
  refresh();
  system.addEventListener('change', applyTheme);
  window.addEventListener('storage', storageChanged);
  return () => {
    system.removeEventListener('change', applyTheme);
    window.removeEventListener('storage', storageChanged);
  };
}

// Runs in the document head before content can paint. No user input is interpolated.
export const THEME_BOOTSTRAP = `(()=>{let p='system';try{p=localStorage.getItem('pennyahead-theme')||p}catch{}const d=p==='dark'||(p!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'})()`;
