import { useCallback, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useIsConnected } from '../hooks';
import { signedUrlsEnabledSelector } from '../selectors';
import { refreshExpiringFileTokens, resetRefusedFileTokens } from './actions';
import { FILE_TOKEN_REFRESH_INTERVAL_MS } from './statics';

// signed urls expire, and nothing else replaces the tokens already in the store
export const useFileTokenRefresh = () => {
  const signedUrlsEnabled = useSelector(signedUrlsEnabledSelector);
  const connected = useIsConnected();

  const refreshNow = useCallback(() => {
    resetRefusedFileTokens();
    refreshExpiringFileTokens();
  }, []);

  const handleVisibilityChange = useCallback(() => {
    // timers are throttled in background tabs, so catch up when the tab is back
    if (document.visibilityState === 'visible') refreshNow();
  }, [refreshNow]);

  useEffect(() => {
    if (!signedUrlsEnabled || !connected) return;

    // runs when signed urls get turned on and after every reconnect: the tokens in the store
    // are missing or may have expired while the connection was down
    refreshNow();

    const interval = setInterval(
      refreshExpiringFileTokens,
      FILE_TOKEN_REFRESH_INTERVAL_MS
    );

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', refreshNow);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', refreshNow);
    };
  }, [signedUrlsEnabled, connected, refreshNow, handleVisibilityChange]);
};
