import { beforeEach, describe, expect, it } from 'vitest';
import type { TrackPrimitive } from '@/types/api';
import {
  PLAYER_STORAGE_KEY,
  createPlayerStore,
  usePlayerStore,
} from './player.store';

/**
 * FE-PR3-05 — playerStore (REQ-FE-006, REQ-FE-011, DESIGN §4.4).
 *
 * The store owns the implicit-queue contract + transport state, NOT the
 * <audio> element (that's PlayerBar in PR-4). `playFromList` REPLACES the
 * queue + resets duration to 0 so <SeekBar max> doesn't linger on the
 * previous track. queue+currentIndex+volume PERSIST; currentTime/duration/
 * isPlaying are EPHEMERAL.
 *
 * `createPlayerStore` is exported as a factory so the reload/rehydrate scenario
 * can instantiate a SECOND store against the same localStorage — simulating a
 * fresh page load without resetting the module singleton.
 */
const t1: TrackPrimitive = {
  id: 't1',
  title: 'Track 1',
  durationSeconds: 100,
  trackNumber: 1,
  albumId: 'a1',
};
const t2: TrackPrimitive = {
  id: 't2',
  title: 'Track 2',
  durationSeconds: 200,
  trackNumber: 2,
  albumId: 'a1',
};
const t3: TrackPrimitive = {
  id: 't3',
  title: 'Track 3',
  durationSeconds: 300,
  trackNumber: 3,
  albumId: 'a1',
};
const three = [t1, t2, t3];

beforeEach(() => {
  // Reset the singleton to defaults between tests; clear persisted storage.
  usePlayerStore.setState({
    queue: [],
    currentIndex: -1,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
  });
  localStorage.clear();
});

describe('playerStore — playFromList (implicit queue + duration reset)', () => {
  it('replaces the queue, sets currentIndex, and starts playing', () => {
    usePlayerStore.getState().playFromList(three, 1);
    const s = usePlayerStore.getState();
    expect(s.queue).toEqual(three);
    expect(s.currentIndex).toBe(1);
    expect(s.isPlaying).toBe(true);
  });

  it('resets currentTime AND duration to 0 so <SeekBar max> does not linger', () => {
    // Pretend the previous track was mid-playback with a known duration.
    usePlayerStore.setState({ currentTime: 42, duration: 200, isPlaying: true });
    usePlayerStore.getState().playFromList(three, 0);
    const s = usePlayerStore.getState();
    expect(s.currentTime).toBe(0);
    expect(s.duration).toBe(0);
  });

  it('clamps startIndex into the queue range', () => {
    usePlayerStore.getState().playFromList(three, 99);
    expect(usePlayerStore.getState().currentIndex).toBe(2);
    usePlayerStore.getState().playFromList(three, -3);
    expect(usePlayerStore.getState().currentIndex).toBe(0);
  });
});

describe('playerStore — transport walks the implicit queue (REQ-FE-011)', () => {
  it('next advances +1 and prev walks back', () => {
    usePlayerStore.getState().playFromList(three, 0);
    const { next, prev } = usePlayerStore.getState();
    next();
    expect(usePlayerStore.getState().currentIndex).toBe(1);
    next();
    expect(usePlayerStore.getState().currentIndex).toBe(2);
    prev();
    expect(usePlayerStore.getState().currentIndex).toBe(1);
  });

  it('next STOPS at end of queue with isPlaying=false (NO wrap)', () => {
    usePlayerStore.getState().playFromList(three, 2); // last track
    usePlayerStore.getState().next();
    const s = usePlayerStore.getState();
    expect(s.currentIndex).toBe(2); // did not wrap to 0
    expect(s.isPlaying).toBe(false);
  });

  it('prev clamps at 0 (no negative index)', () => {
    usePlayerStore.getState().playFromList(three, 0);
    usePlayerStore.getState().prev();
    expect(usePlayerStore.getState().currentIndex).toBe(0);
  });

  it('next/prev reset currentTime to 0 on advance', () => {
    usePlayerStore.getState().playFromList(three, 0);
    usePlayerStore.setState({ currentTime: 50 });
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().currentTime).toBe(0);
  });

  it('next is a no-op on an empty queue', () => {
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().currentIndex).toBe(-1);
  });
});

describe('playerStore — play / pause / togglePlay', () => {
  it('togglePlay flips isPlaying', () => {
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    usePlayerStore.getState().togglePlay();
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    usePlayerStore.getState().togglePlay();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it('play / pause set isPlaying absolutely', () => {
    usePlayerStore.getState().pause();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    usePlayerStore.getState().play();
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });
});

describe('playerStore — volume clamp', () => {
  it('clamps volume to [0, 1]', () => {
    usePlayerStore.getState().setVolume(1.5);
    expect(usePlayerStore.getState().volume).toBe(1);
    usePlayerStore.getState().setVolume(-0.5);
    expect(usePlayerStore.getState().volume).toBe(0);
    usePlayerStore.getState().setVolume(0.3);
    expect(usePlayerStore.getState().volume).toBe(0.3);
  });
});

describe('playerStore — setCurrentTime / setDuration', () => {
  it('set the ephemeral playback fields', () => {
    usePlayerStore.getState().setCurrentTime(12.5);
    usePlayerStore.getState().setDuration(180);
    const s = usePlayerStore.getState();
    expect(s.currentTime).toBe(12.5);
    expect(s.duration).toBe(180);
  });
});

describe('playerStore — persistence (REQ-FE-006 queue survives reload)', () => {
  it('partialize persists ONLY queue + currentIndex + volume', () => {
    usePlayerStore.getState().playFromList(three, 1);
    usePlayerStore.getState().setVolume(0.25);
    // Set the ephemeral fields to non-defaults to prove they are NOT persisted.
    usePlayerStore.setState({ currentTime: 77, duration: 999, isPlaying: true });

    const raw = localStorage.getItem(PLAYER_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw!);
    expect(persisted.state).toHaveProperty('queue');
    expect(persisted.state).toHaveProperty('currentIndex');
    expect(persisted.state).toHaveProperty('volume');
    // Ephemeral fields MUST be absent from the persisted blob.
    expect(persisted.state).not.toHaveProperty('currentTime');
    expect(persisted.state).not.toHaveProperty('duration');
    expect(persisted.state).not.toHaveProperty('isPlaying');
  });

  it('rehydrates queue + currentIndex + volume on a fresh store; ephemeral fields reset', () => {
    usePlayerStore.getState().playFromList(three, 2);
    usePlayerStore.getState().setVolume(0.6);
    usePlayerStore.setState({ currentTime: 42, duration: 200, isPlaying: true });

    // Simulate a fresh page load: a brand-new store reading the same localStorage.
    const reloaded = createPlayerStore();
    const s = reloaded.getState();
    expect(s.queue).toEqual(three);
    expect(s.currentIndex).toBe(2);
    expect(s.volume).toBe(0.6);
    // Ephemeral fields reset to defaults on reload.
    expect(s.currentTime).toBe(0);
    expect(s.duration).toBe(0);
    expect(s.isPlaying).toBe(false);
  });

  it('a fresh store with empty storage starts at defaults', () => {
    localStorage.clear();
    const fresh = createPlayerStore();
    const s = fresh.getState();
    expect(s.queue).toEqual([]);
    expect(s.currentIndex).toBe(-1);
    expect(s.volume).toBe(0.8);
    expect(s.isPlaying).toBe(false);
  });
});
