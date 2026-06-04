export const SCOPES = {
  sheets: "https://www.googleapis.com/auth/spreadsheets",
  driveReadonly: "https://www.googleapis.com/auth/drive.readonly",
  gmailReadonly: "https://www.googleapis.com/auth/gmail.readonly",
} as const;

export const SCRAP_SCALE_SCOPES = [SCOPES.sheets, SCOPES.driveReadonly];
export const LENDER_FOLLOWUP_SCOPES = [SCOPES.gmailReadonly];

export function hasAllScopes(granted: string[], required: string[]): boolean {
  const set = new Set(granted);
  return required.every((s) => set.has(s));
}
