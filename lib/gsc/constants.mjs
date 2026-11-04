// Read-only scope only. Nothing in this module can write to Search Console.
export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

// Search Console data is not final for the most recent days. The end date is kept
// this many days behind today, and the response reports the server's own
// first_incomplete_date when it provides one. The lag is a conservative
// assumption, not a verified figure.
export const ASSUMED_FINAL_LAG_DAYS = 3;

export const ALLOWED_PERIODS = Object.freeze([7, 28, 90]);
