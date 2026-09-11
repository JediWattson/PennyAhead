'use client';

import { useEffect, type ReactNode } from 'react';
import { watchTheme } from '../lib/theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(watchTheme, []);
  return children;
}
