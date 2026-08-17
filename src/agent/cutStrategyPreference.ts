const STORAGE_KEY = 'openchatcut.cut-strategy.enabled.v1';
export const CUT_STRATEGY_PREFERENCE_EVENT = 'openchatcut:cut-strategy-preference';
let memoryEnabled = false;

function browserStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

export function cutStrategyEnabled(): boolean {
  const stored = browserStorage()?.getItem(STORAGE_KEY);
  return stored === null || stored === undefined ? memoryEnabled : stored === '1';
}

export function setCutStrategyEnabled(enabled: boolean): void {
  memoryEnabled = enabled;
  try {
    browserStorage()?.setItem(STORAGE_KEY, enabled ? '1' : '0');
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CUT_STRATEGY_PREFERENCE_EVENT, { detail: enabled }));
  } catch { /* in-memory fallback remains effective */ }
}
