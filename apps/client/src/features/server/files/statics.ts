// the lowest ttl the settings screen allows is 30 minutes, so with a margin of twice the
// interval a token is always replaced while it is still valid
export const FILE_TOKEN_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
export const FILE_TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;
