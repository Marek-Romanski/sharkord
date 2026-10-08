import type { WebSocket } from 'ws';

// the socket that joined voice for a user. voice state is per user but belongs to one
// connection, so a stale connection cannot be told apart from a live one without this
const voiceSessionOwners = new Map<number, WebSocket>();

const setVoiceSessionOwner = (userId: number, ws: WebSocket) => {
  voiceSessionOwners.set(userId, ws);
};

const getVoiceSessionOwner = (userId: number) => voiceSessionOwners.get(userId);

// a connection that was replaced by a newer one still believes it is in the call
const hasLostVoiceSession = (userId: number, ws: WebSocket | undefined) => {
  const owner = voiceSessionOwners.get(userId);

  return !!owner && !!ws && owner !== ws;
};

const clearVoiceSessionOwner = (userId: number) => {
  voiceSessionOwners.delete(userId);
};

const clearVoiceSessionOwnersForTests = () => {
  voiceSessionOwners.clear();
};

export {
  clearVoiceSessionOwner,
  clearVoiceSessionOwnersForTests,
  getVoiceSessionOwner,
  hasLostVoiceSession,
  setVoiceSessionOwner
};
