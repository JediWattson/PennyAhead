'use client';

import { useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  getThemePreference,
  getServerThemePreference,
  setThemePreference,
  subscribeToTheme,
  type ThemePreference,
} from '../lib/theme';

export function ThemeSelector() {
  const preference = useSyncExternalStore(
    subscribeToTheme,
    getThemePreference,
    getServerThemePreference,
  );
  const Icon =
    preference === 'dark' ? Moon : preference === 'light' ? Sun : Monitor;
  return (
    <label className="theme-selector">
      <Icon size={16} aria-hidden="true" />
      <span className="sr-only">Color theme</span>
      <select
        value={preference}
        onChange={(event) =>
          setThemePreference(event.target.value as ThemePreference)
        }
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
