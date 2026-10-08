import { setSelectedChannelId } from '@/features/server/channels/actions';
import {
  currentVoiceChannelIdSelector,
  isCurrentVoiceChannelSelectedSelector
} from '@/features/server/channels/selectors';
import { useIsConnected } from '@/features/server/hooks';
import {
  clearLocalVoiceSession,
  joinVoice,
  leaveVoice
} from '@/features/server/voice/actions';
import { store } from '@/features/store';
import type { RtpCapabilities } from 'mediasoup-client/types';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

type TVoiceSessionRecovery = {
  init: (
    routerRtpCapabilities: RtpCapabilities,
    channelId: number
  ) => Promise<void>;
  cleanup: () => void;
};

// a reconnect gives the user a new connection while the call still looks alive: the server
// session belongs to the old socket and the media transports are gone, so join again
const useVoiceSessionRecovery = ({ init, cleanup }: TVoiceSessionRecovery) => {
  const { t } = useTranslation('common');
  const connected = useIsConnected();
  const wasConnectedRef = useRef(connected);

  useEffect(() => {
    const wasConnected = wasConnectedRef.current;

    wasConnectedRef.current = connected;

    if (wasConnected || !connected) return;

    const state = store.getState();
    const channelId = currentVoiceChannelIdSelector(state);

    if (!channelId) return;

    const wasSelected = isCurrentVoiceChannelSelectedSelector(state);

    const rejoin = async () => {
      clearLocalVoiceSession();

      // the voice status has to drop to disconnected while the join is in flight. the event
      // subscriptions listen for the status coming back up, which is after the server has put
      // this connection in the channel, a subscription made earlier would never hear anything
      cleanup();

      if (wasSelected) setSelectedChannelId(channelId);

      const response = await joinVoice(channelId);

      if (!response) return;

      try {
        await init(response, channelId);
      } catch {
        await leaveVoice({ reason: 'init_failed' });

        toast.error(t('common:failedInitVoiceConnection'));
      }
    };

    rejoin();
  }, [connected, init, cleanup, t]);
};

export { useVoiceSessionRecovery };
