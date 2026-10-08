import { ServerEvents } from '@sharkord/shared';
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { createFakeSocket, initTest } from '../../__tests__/helpers';
import * as removeUserFromVoiceModule from '../../helpers/remove-user-from-voice';
import { setVoiceSessionOwner } from '../../helpers/voice-session-owners';
import { VoiceRuntime } from '../../runtimes/voice';
import { pubsub } from '../pubsub';
import { handleSocketClose } from '../wss';

const VOICE_CHANNEL_ID = 2;

const connectTab = async (userId: number) => {
  const socket = createFakeSocket();

  await initTest(userId, { socket });

  return socket;
};

const runtimes: VoiceRuntime[] = [];

const joinVoice = (userId: number) => {
  const runtime = new VoiceRuntime(VOICE_CHANNEL_ID);

  runtime.addUser(userId, { micMuted: false, soundMuted: false });
  runtimes.push(runtime);

  return runtime;
};

describe('voice session across socket closes', () => {
  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.destroy()));
  });

  test('should remove a stale voice session when its socket closes after a reconnect', async () => {
    const staleTab = await connectTab(2);
    const reconnectedTab = await connectTab(2);
    const runtime = joinVoice(2);

    setVoiceSessionOwner(2, staleTab);

    const leaves: { channelId: number; userId: number }[] = [];

    const subscription = pubsub
      .subscribe(ServerEvents.USER_LEAVE_VOICE)
      .subscribe({ next: (payload) => leaves.push(payload) });

    await handleSocketClose(staleTab);

    subscription.unsubscribe();

    expect(runtime.getUser(2)).toBeUndefined();
    expect(leaves).toEqual([{ channelId: VOICE_CHANNEL_ID, userId: 2 }]);

    await handleSocketClose(reconnectedTab);
  });

  test('should keep the voice session when another tab without voice closes', async () => {
    const voiceTab = await connectTab(2);
    const otherTab = await connectTab(2);
    const runtime = joinVoice(2);

    setVoiceSessionOwner(2, voiceTab);

    await handleSocketClose(otherTab);

    expect(runtime.getUser(2)).toBeDefined();

    await handleSocketClose(voiceTab);
  });

  test('should keep the voice session when the user already rejoined on another socket', async () => {
    const staleTab = await connectTab(2);
    const rejoinedTab = await connectTab(2);
    const runtime = joinVoice(2);

    setVoiceSessionOwner(2, rejoinedTab);

    await handleSocketClose(staleTab);

    expect(runtime.getUser(2)).toBeDefined();

    await handleSocketClose(rejoinedTab);

    expect(runtime.getUser(2)).toBeUndefined();
  });

  test('should still finish the presence cleanup when removing the voice session fails', async () => {
    const onlyTab = await connectTab(2);

    joinVoice(2);
    setVoiceSessionOwner(2, onlyTab);

    spyOn(removeUserFromVoiceModule, 'removeUserFromVoice').mockRejectedValue(
      new Error('database unavailable')
    );

    const departures: number[] = [];

    const subscription = pubsub
      .subscribe(ServerEvents.USER_LEAVE)
      .subscribe({ next: (userId) => departures.push(userId) });

    await handleSocketClose(onlyTab);

    subscription.unsubscribe();

    expect(departures).toEqual([2]);
  });
});
