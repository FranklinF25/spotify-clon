import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '@/store/player.store';
import { useAudioSource } from './use-audio-source';
import { PrevButton } from './PrevButton';
import { PlayPauseButton } from './PlayPauseButton';
import { NextButton } from './NextButton';
import { SeekBar } from './SeekBar';
import { VolumeControl } from './VolumeControl';
import { TapToPlayOverlay } from './TapToPlayOverlay';
import styles from './PlayerBar.module.css';

/**
 * PlayerBar organism (REQ-FE-011, REQ-FE-012, DESIGN §6.2) — the portfolio
 * payload. Mounted EXACTLY ONCE per authenticated session (AppLayout hosts
 * it; FE-PR4-04's runtime test enforces the single-mount invariant).
 *
 * Owns the `<audio>` element ref (NOT any store — DESIGN §4.4 invariant)
 * + runs two unidirectional syncs:
 *  - store → element via effects: src (blob URL), isPlaying, volume,
 *    currentTime seek.
 *  - element → store via events: onTimeUpdate, onDurationChange, onEnded,
 *    onPlay, onPause.
 *
 * The two feedback-loop guards (the 0.5s seek delta + the isPlaying check
 * in onPlay/onPause) prevent a store↔element ping-pong at 4–60Hz. The
 * `isUserSeeking` flag is a SEPARATE concern: it marks a user COMMIT so a
 * small seek (<0.5s) ALWAYS writes through instead of being silently
 * swallowed by the loop-prevention delta (JD fix adjacent to R2-10).
 *
 * JD fixes encoded:
 *  - #5  duration subscribed (SeekBar max no longer dead).
 *  - #13 scrubbing flag skips onTimeUpdate during a seek-bar drag.
 *  - #14 el.play() rejection surfaces TapToPlayOverlay (NOT swallowed).
 *  - #15 onDurationChange Number.isFinite guard rejects NaN/Infinity.
 *  - R2-11 unmount guard on the async play() rejection handler.
 *  - R2-10 isUserSeeking ensures small user commits write through.
 */
export function PlayerBar() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const src = useAudioSource();

  // Scrubbing flag — set on SeekBar pointer-down, cleared on commit. While
  // scrubbing, onTimeUpdate skips its write so the element's playhead does
  // not fight the user's drag handle.
  const [scrubbing, setScrubbing] = useState(false);
  // Hoisted ABOVE the effects that use it (regression: used to be declared
  // AFTER the src/isPlaying effects → TDZ caught only at runtime).
  const [playBlocked, setPlayBlocked] = useState(false);
  // SEPARATE from `scrubbing`: `scrubbing` suppresses element→store
  // timeupdate during a drag; `isUserSeeking` marks a user COMMIT so the
  // seek effect writes through UNCONDITIONALLY even when the commit delta
  // is < 0.5s (the loop-prevention threshold). Without this branch, a small
  // user commit (<0.5s) would be silently dropped.
  const [isUserSeeking, setIsUserSeeking] = useState(false);

  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const volume = usePlayerStore((s) => s.volume);
  const currentTime = usePlayerStore((s) => s.currentTime);
  // JD fix #5: duration MUST be subscribed so <SeekBar max> tracks.
  const duration = usePlayerStore((s) => s.duration);

  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const setDuration = usePlayerStore((s) => s.setDuration);
  const setVolume = usePlayerStore((s) => s.setVolume);

  // store → element: src swaps when the blob URL changes (track change).
  // Surface el.play() rejection: when play() rejects (autoplay policy /
  // not-allowed), do NOT swallow with `.catch(()=>{})` — flip isPlaying
  // back to false + surface TapToPlayOverlay. The `unmounted` flag guards
  // the async setPlayBlocked call so a rejection that fires after unmount
  // does not setState on an unmounted component (R2-11).
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    let unmounted = false;
    el.src = src ?? '';
    if (src && isPlaying) {
      // `Promise.resolve(el.play())` defensive shape: some environments
      // (jsdom) return undefined from play(); wrapping normalises it so the
      // rejection surface is always wired. In real browsers el.play() is a
      // Promise and this is a no-op wrap.
      Promise.resolve(el.play()).catch(() => {
        if (unmounted) return; // R2-11: don't setState post-unmount
        usePlayerStore.getState().pause(); // keep the store honest
        setPlayBlocked(true); // surface a tap-to-play recovery affordance
      });
    }
    return () => {
      unmounted = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // store → element: play/pause
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    let unmounted = false; // R2-11: same unmount guard
    if (isPlaying) {
      Promise.resolve(el.play()).catch(() => {
        if (unmounted) return;
        usePlayerStore.getState().pause();
        setPlayBlocked(true);
      });
    } else {
      el.pause();
    }
    return () => {
      unmounted = true;
    };
  }, [isPlaying]);

  // store → element: volume (clamped upstream in the store).
  useEffect(() => {
    const el = audioRef.current;
    if (el) el.volume = volume;
  }, [volume]);

  // store → element: seek (currentTime only changes on user commit; the
  // element→store timeupdate does NOT echo back — see the scrubbing guard
  // in onTimeUpdate).
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (isUserSeeking) {
      // User COMMIT — ALWAYS write through, regardless of the 0.5s delta
      // below. Without this branch, a small user commit (<0.5s) would be
      // silently dropped by the loop-prevention guard.
      el.currentTime = currentTime;
      setIsUserSeeking(false);
      return;
    }
    // Loop-prevention delta — ONLY for element→store echo during playback
    // (NOT for user commits — those go through the isUserSeeking branch).
    if (Math.abs(el.currentTime - currentTime) > 0.5) el.currentTime = currentTime;
  }, [currentTime, isUserSeeking]);

  return (
    <div className={styles.bar} role="region" aria-label="Player">
      {/*
        Single owner of the <audio> element (DESIGN §4.4 invariant). The
        data-testid anchors the runtime single-mount architecture test
        (FE-PR4-04) + the PlayerBar self-check suite.
      */}
      <audio
        ref={audioRef}
        data-testid="player-audio"
        onTimeUpdate={(e) => {
          // JD fix #13: skip while the user is dragging the seek bar —
          // the drag's local state owns the thumb position; timeupdate
          // would yank it back.
          if (scrubbing) return;
          setCurrentTime(e.currentTarget.currentTime);
        }}
        onDurationChange={(e) => {
          // JD fix #15: guard against NaN / Infinity. Some browsers fire
          // onDurationChange with `duration === Infinity` for blob sources
          // before metadata settles; pushing that to the store would break
          // <SeekBar max=...>.
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setDuration(d);
        }}
        onEnded={() => next()}
        onPlay={() => {
          setPlayBlocked(false);
          // Feedback-loop guard: only sync when out of sync, else the
          // element's onPlay would retrigger the effect (ping-pong).
          if (!usePlayerStore.getState().isPlaying) usePlayerStore.getState().play();
        }}
        onPause={() => {
          if (usePlayerStore.getState().isPlaying) usePlayerStore.getState().pause();
        }}
      />
      <PrevButton onClick={prev} />
      <PlayPauseButton isPlaying={isPlaying} onClick={togglePlay} />
      <NextButton onClick={next} />
      {/*
        SeekBar drag split:
          - onInput        → local visual position (no store write)
          - onChange       → commit: write setCurrentTime once + setIsUserSeeking
          - onPointerDown  → setScrubbing(true)
          - onPointerUp    → setScrubbing(false)
        The onInput/onChange split keeps the drag smooth (no per-pixel
        store churn) and lets onTimeUpdate no-op while scrubbing.
      */}
      <SeekBar
        value={currentTime}
        max={duration}
        onPointerDown={() => setScrubbing(true)}
        onPointerUp={() => setScrubbing(false)}
        onInput={() => {
          /* local drag — no store write */
        }}
        onChange={(v) => {
          setCurrentTime(v);
          setScrubbing(false);
          setIsUserSeeking(true); // bypass the 0.5s loop-prevention delta
        }}
      />
      <VolumeControl value={volume} onChange={setVolume} />
      {playBlocked && (
        <TapToPlayOverlay
          onClick={() => {
            setPlayBlocked(false);
            togglePlay();
          }}
        />
      )}
    </div>
  );
}
