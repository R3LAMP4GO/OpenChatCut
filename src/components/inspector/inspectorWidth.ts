export const DEFAULT_INSPECTOR_WIDTH = 320;
export const MIN_INSPECTOR_WIDTH = 240;
export const MIN_PREVIEW_WIDTH = 280;

export function clampInspectorWidth(width: number, workspaceWidth: number): number {
  const maximum = Math.max(MIN_INSPECTOR_WIDTH, workspaceWidth - MIN_PREVIEW_WIDTH);
  return Math.round(Math.min(maximum, Math.max(MIN_INSPECTOR_WIDTH, width)));
}
