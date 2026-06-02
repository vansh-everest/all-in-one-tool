export const SCOPES = {
  sheets: "https://www.googleapis.com/auth/spreadsheets",
  driveReadonly: "https://www.googleapis.com/auth/drive.readonly",
  // gmail tools (later) add their scope here
} as const;

export const SCRAP_SCALE_SCOPES = [SCOPES.sheets, SCOPES.driveReadonly];

export function hasAllScopes(granted: string[], required: string[]): boolean {
  const set = new Set(granted);
  return required.every((s) => set.has(s));
}
