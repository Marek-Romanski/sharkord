import { store } from '@/features/store';
import { logDebug } from '@/helpers/browser-logger';
import { getTRPCClient } from '@/lib/trpc';
import { STORAGE_MAX_FILE_TOKENS_PER_REFRESH } from '@sharkord/shared';
import { signedUrlsEnabledSelector } from '../selectors';
import { serverSliceActions } from '../slice';
import { getFilesToRefresh, type TFileToRefresh } from './helpers';
import { FILE_TOKEN_REFRESH_MARGIN_MS } from './statics';

let isRefreshing = false;

// files the server would not hand a token for, keyed by the expiry they carried. without
// this a file whose channel the user lost would be asked for again on every tick
const refusedFiles = new Set<string>();

const getRefusedKey = (file: TFileToRefresh) => `${file.id}:${file.expiresAt}`;

// access can come back (a role restored, direct messages enabled again), so refused files get
// another chance now and then
export const resetRefusedFileTokens = () => {
  refusedFiles.clear();
};

export const refreshExpiringFileTokens = async () => {
  // the interval and the tab visibility handler can fire together
  if (isRefreshing) return;

  const rootState = store.getState();

  if (!signedUrlsEnabledSelector(rootState)) return;

  const filesToRefresh = getFilesToRefresh(
    rootState.server,
    Date.now() + FILE_TOKEN_REFRESH_MARGIN_MS
  ).filter((file) => !refusedFiles.has(getRefusedKey(file)));

  if (filesToRefresh.length === 0) return;

  isRefreshing = true;

  try {
    const trpc = getTRPCClient();

    for (
      let start = 0;
      start < filesToRefresh.length;
      start += STORAGE_MAX_FILE_TOKENS_PER_REFRESH
    ) {
      const batch = filesToRefresh.slice(
        start,
        start + STORAGE_MAX_FILE_TOKENS_PER_REFRESH
      );

      const tokens = await trpc.files.refreshTokens.query({
        fileIds: batch.map((file) => file.id)
      });

      const refreshedIds = new Set(tokens.map((token) => token.id));

      batch
        .filter((file) => !refreshedIds.has(file.id))
        .forEach((file) => refusedFiles.add(getRefusedKey(file)));

      store.dispatch(serverSliceActions.updateFileTokens(tokens));
    }
  } catch (error) {
    // background work, the next tick tries again and a toast would only be noise
    logDebug('Failed to refresh file tokens', error);
  } finally {
    isRefreshing = false;
  }
};
