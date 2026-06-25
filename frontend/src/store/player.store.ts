import { create, type StateCreator } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { TrackPrimitive } from '@/types/api';

/**
 * playerStore (REQ-FE-006, REQ-FE-011, DESIGN §4.4).
 *
 * Owns the implicit-queue contract + transport state. Does NOT own the
 * `<audio>` element ref — that lives in PlayerBar (PR-4); the store is the
 * source-of-truth the element mirrors via effects. Two persistence classes:
 *  - PERSISTED (survive reload): queue + currentIndex + volume.
 *  - EPHEMERAL (reset every boot): currentTime + duration + isPlaying.
 *
 * `playFromList` REPLACES the queue (the "play album" / "play track" semantic)
 * AND resets `duration` to 0 so `<SeekBar max>` doesn't linger on the previous
 * track's value until the new `<audio>` metadata settles (DESIGN §4.4).
 *
 * `createPlayerStore` is exported as a FACTORY so the reload/rehydrate scenario
 * in the spec can instantiate a second store against the same localStorage —
 * simulating a fresh page load without resetting the module singleton.
 */
export const PLAYER_STORAGE_KEY = 'spotify-clon.player';

export interface PlayerState {
  queue: TrackPrimitive[];
  /** -1 when the queue is empty. */
  currentIndex: number;
  isPlaying: boolean; // ephemeral
  currentTime: number; // ephemeral
  duration: number; // ephemeral
  /** Persisted, clamped to [0, 1]. */
  volume: number;

  playFromList: (tracks: TrackPrimitive[], startIndex: number) => void;
  togglePlay: () => void;
  play: () => void;
  pause: () => void;
  /** Walks +1; STOPS at end with isPlaying:false (NO wrap — REQ-FE-011). */
  next: () => void;
  /** Walks -1; clamps at 0. */
  prev: () => void;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  setVolume: (v: number) => void;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

const defaultState = {
  queue: [] as TrackPrimitive[],
  currentIndex: -1,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
};

const playerStateCreator: StateCreator<PlayerState, [], [], PlayerState> = (
  set,
  get,
) => ({
  ...defaultState,

  playFromList(tracks, startIndex) {
    // Implicit queue: the picked list becomes the queue, the picked track is
    // the entry point. Reset currentTime AND duration so the <SeekBar> does
    // not briefly show the previous track's max (DESIGN §4.4 comment).
    set({
      queue: tracks,
      currentIndex: clamp(startIndex, 0, tracks.length - 1),
      currentTime: 0,
      duration: 0,
      isPlaying: true,
    });
  },

  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),

  next() {
    const { queue, currentIndex } = get();
    if (queue.length === 0) return;
    if (currentIndex >= queue.length - 1) {
      // End-of-queue: STOP (no wrap — matches album-end semantics; REQ-FE-011
      // scenario "End-of-queue stops playback").
      set({ isPlaying: false, currentIndex: queue.length - 1 });
      return;
    }
    set({ currentIndex: currentIndex + 1, currentTime: 0, isPlaying: true });
  },

  prev() {
    const { currentIndex } = get();
    if (currentIndex <= 0) {
      set({ currentTime: 0 });
      return;
    }
    set({ currentIndex: currentIndex - 1, currentTime: 0, isPlaying: true });
  },

  setCurrentTime: (t) => set({ currentTime: t }),
  setDuration: (d) => set({ duration: d }),
  setVolume: (v) => set({ volume: clamp(v, 0, 1) }),
});

export const createPlayerStore = () =>
  create<PlayerState>()(
    persist(playerStateCreator, {
      name: PLAYER_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // ONLY queue + currentIndex + volume survive reload (REQ-FE-006).
      // currentTime/duration/isPlaying reset on every boot.
      partialize: (s) => ({
        queue: s.queue,
        currentIndex: s.currentIndex,
        volume: s.volume,
      }),
    }),
  );

/** Module singleton — the single mutation point (http-client / pages call here). */
export const usePlayerStore = createPlayerStore();
