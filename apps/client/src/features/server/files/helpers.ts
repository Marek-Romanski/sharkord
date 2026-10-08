import { type TFile, type TFileToken } from '@sharkord/shared';
import type { IServerState } from '../slice';

// the same file shows up in many places, so every copy in the store has to be visited
const forEachFileInState = (
  state: IServerState,
  callback: (file: TFile) => void
) => {
  state.users.forEach((user) => {
    if (user.avatar) callback(user.avatar);
    if (user.banner) callback(user.banner);
  });

  state.emojis.forEach((emoji) => callback(emoji.file));

  [
    ...Object.values(state.messagesMap),
    ...Object.values(state.threadMessagesMap)
  ].forEach((messages) => {
    messages.forEach((message) => {
      message.files.forEach(callback);

      message.reactions.forEach((reaction) => {
        if (reaction.file) callback(reaction.file);
      });
    });
  });
};

export type TFileToRefresh = { id: number; expiresAt: number };

export const getFilesToRefresh = (
  state: IServerState,
  expiringBefore: number
): TFileToRefresh[] => {
  const expiryById = new Map<number, number>();

  forEachFileInState(state, (file) => {
    // a file without a token was loaded while signed urls were off, it needs one now
    const expiresAt = file._accessTokenExpiresAt ?? 0;

    if (expiresAt >= expiringBefore) return;

    const known = expiryById.get(file.id);

    if (known === undefined || expiresAt < known) {
      expiryById.set(file.id, expiresAt);
    }
  });

  return Array.from(expiryById, ([id, expiresAt]) => ({ id, expiresAt }));
};

export const applyFileTokens = (state: IServerState, tokens: TFileToken[]) => {
  const tokensById = new Map(tokens.map((token) => [token.id, token]));

  forEachFileInState(state, (file) => {
    const token = tokensById.get(file.id);

    if (!token) return;

    file._accessToken = token._accessToken;
    file._accessTokenExpiresAt = token._accessTokenExpiresAt;
  });
};
