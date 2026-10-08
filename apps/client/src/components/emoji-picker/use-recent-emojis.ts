import type { TEmojiItem } from '@/components/tiptap-input/helpers';
import { useCustomEmojis } from '@/features/server/emojis/hooks';
import {
  getLocalStorageItemAsJSON,
  LocalStorageKey,
  setLocalStorageItemAsJSON
} from '@/helpers/storage';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

const MAX_RECENT_EMOJIS = 32;

type StoredEmoji = {
  name: string;
  shortcodes: string[];
  fallbackImage?: string;
  emoji?: string;
};

let recentEmojisCache: TEmojiItem[] | null = null;

const subscribers = new Set<() => void>();

const notifySubscribers = () => {
  subscribers.forEach((callback) => callback());
};

const loadRecentEmojis = (): TEmojiItem[] => {
  if (recentEmojisCache !== null) {
    return recentEmojisCache;
  }

  const stored = getLocalStorageItemAsJSON<StoredEmoji[]>(
    LocalStorageKey.RECENT_EMOJIS,
    []
  );

  recentEmojisCache = stored ?? [];

  return recentEmojisCache;
};

const saveRecentEmojis = (emojis: TEmojiItem[]): void => {
  const toStore: StoredEmoji[] = emojis.map((e) => ({
    name: e.name,
    shortcodes: e.shortcodes,
    fallbackImage: e.fallbackImage,
    emoji: e.emoji
  }));

  setLocalStorageItemAsJSON(LocalStorageKey.RECENT_EMOJIS, toStore);

  recentEmojisCache = emojis;

  notifySubscribers();
};

const addRecentEmoji = (emoji: TEmojiItem): void => {
  const current = loadRecentEmojis();

  const filtered = current.filter((e) => e.name !== emoji.name);
  const updated = [emoji, ...filtered].slice(0, MAX_RECENT_EMOJIS);

  saveRecentEmojis(updated);
};

const subscribe = (callback: () => void): (() => void) => {
  subscribers.add(callback);

  return () => subscribers.delete(callback);
};

const getSnapshot = (): TEmojiItem[] => {
  return loadRecentEmojis();
};

// the list is kept in local storage together with the url the emoji had when it was picked,
// and for a signed url that token is long expired. custom emoji are looked up again by name
const withFreshCustomEmojis = (
  recentEmojis: TEmojiItem[],
  customEmojis: TEmojiItem[]
): TEmojiItem[] => {
  const customByName = new Map(
    customEmojis.map((emoji) => [emoji.name, emoji])
  );

  return recentEmojis.map((recent) => {
    const fresh = recent.emoji ? undefined : customByName.get(recent.name);

    return fresh ? { ...recent, fallbackImage: fresh.fallbackImage } : recent;
  });
};

const useRecentEmojis = () => {
  const storedRecentEmojis = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot
  );

  const customEmojis = useCustomEmojis();

  const recentEmojis = useMemo(
    () => withFreshCustomEmojis(storedRecentEmojis, customEmojis),
    [storedRecentEmojis, customEmojis]
  );

  const addRecent = useCallback((emoji: TEmojiItem) => {
    addRecentEmoji(emoji);
  }, []);

  return {
    recentEmojis,
    addRecent
  };
};

export { addRecentEmoji, useRecentEmojis, withFreshCustomEmojis };
