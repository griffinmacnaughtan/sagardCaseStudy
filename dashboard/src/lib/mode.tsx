import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * DataMode controls whether the dashboard reads from the baked demo snapshot
 * (public/data/*.json + public/pdfs/) or from the live FastAPI backend
 * (/api/metrics, /api/log, /api/pdf/*).
 *
 * Default is 'demo' - the dashboard works standalone with zero backend
 * dependency, which is what the deployed GitHub Pages build ships. Live mode
 * is opt-in and only useful when api.py is running locally.
 */
export type DataMode = 'demo' | 'live';

const STORAGE_KEY = 'sagard_data_mode';

interface DataModeContextValue {
  mode: DataMode;
  setMode: (m: DataMode) => void;
}

const DataModeContext = createContext<DataModeContextValue | null>(null);

export function DataModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<DataMode>(() => {
    if (typeof window === 'undefined') return 'demo';
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'live' ? 'live' : 'demo';
  });

  const setMode = useCallback((m: DataMode) => {
    setModeState(m);
    try {
      window.localStorage.setItem(STORAGE_KEY, m);
    } catch {
      // Ignore storage errors (private mode, quota, etc.) - in-memory state
      // still updates so the app works for the current session.
    }
  }, []);

  // Sync across tabs so a mode switch in one tab doesn't leave another stale
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === 'demo' || e.newValue === 'live')) {
        setModeState(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <DataModeContext.Provider value={{ mode, setMode }}>{children}</DataModeContext.Provider>
  );
}

export function useDataMode(): DataModeContextValue {
  const ctx = useContext(DataModeContext);
  if (!ctx) throw new Error('useDataMode must be used within <DataModeProvider>');
  return ctx;
}
