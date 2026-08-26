import { Link } from 'react-router-dom';
import styles from './LandingPage.module.css';

/**
 * LandingPage — the PUBLIC root at `/` (REQ-FE-008 route split, DESIGN §8).
 *
 * Static + presentational ONLY:
 *  - NO store reads (the route gate `<RedirectIfAuthed>` is the single auth
 *    seam), NO backend calls, NO query hooks. Every unauthenticated visitor
 *    to `/` sees this page; authenticated ones never reach it (the gate
 *    navigates them to /home).
 *  - Copy is real product copy for THIS app: an owner-supplied FLAC/MP3
 *    catalog streamed over HTTP Range requests, with live search,
 *    queue-backed playlists and a unified library.
 *
 * Layout contract (DESIGN §11.2 — CSS Modules over theme.css tokens, no
 * frameworks, no animation libraries):
 *  - Asymmetric editorial hero: ~60% typographic block / ~40% visual panel
 *    with a deliberate vertical offset — hierarchy comes from scale contrast
 *    (display headline vs small muted kicker), not from boxes.
 *  - Features are numbered editorial ROWS on a 12-column grid with varying
 *    alignment/widths per row (NOT a card grid).
 *  - "How it works" is a staggered diagonal of three steps along a timeline.
 *  - Motion is CSS-only (staggered entrance keyframes + a format marquee +
 *    pulsing waveform bars) and fully disabled under
 *    `prefers-reduced-motion: reduce`.
 *  - Landmarks: header/main/footer; the h1 is unique to the hero. The mock
 *    player panel is decorative → aria-hidden (it contains no focusables).
 */

/** Marquee vocabulary — the real technical claims of the app, repeated. */
const FORMATS = [
  'HTTP Range requests',
  '206 Partial Content',
  'FLAC',
  'MP3',
  'Instant seek',
  'Live search',
  'Playlists',
  'Saved albums',
  'One audio element',
];

/** Waveform bar heights (percent) for the decorative player panel. */
const BAR_HEIGHTS = [34, 58, 42, 74, 51, 88, 63, 45, 79, 55, 92, 48, 66, 38];

type FeatureVariant = 'lead' | 'offset' | 'wide' | 'trailing';

interface Feature {
  index: string;
  title: string;
  copy: string;
  /** Which editorial grid placement the row uses (see module css). */
  variant: FeatureVariant;
}

const FEATURES: Feature[] = [
  {
    index: '01',
    title: 'Streams in slices, not wholes',
    copy: 'The player fetches audio with HTTP Range requests (206 Partial Content), so scrubbing to the last chorus never downloads the first one. Seeking is as instant as your connection.',
    variant: 'lead',
  },
  {
    index: '02',
    title: 'Search that answers while you type',
    copy: 'Every keystroke queries the catalog — albums, artists and tracks arrive live in the results list. No submit button anywhere.',
    variant: 'offset',
  },
  {
    index: '03',
    title: 'Playlists backed by a real queue',
    copy: 'Playing an album or playlist seeds an explicit queue in the player store. Skip, previous and autoplay read from that queue — the model is simple and the behavior is predictable.',
    variant: 'wide',
  },
  {
    index: '04',
    title: 'One library for what you keep',
    copy: 'Saved albums and your own playlists land in a single unified library view. The collection you curate is the collection you browse.',
    variant: 'trailing',
  },
];

const ROW_CLASS: Record<FeatureVariant, string> = {
  lead: styles.rowLead,
  offset: styles.rowOffset,
  wide: styles.rowWide,
  trailing: styles.rowTrailing,
};

const STEPS = [
  {
    index: '01',
    title: 'Create an account',
    copy: 'Register with an email, a password and a display name. The session is a memory-only access token plus an httpOnly refresh cookie — nothing tracks you and nothing outlives the cookie.',
  },
  {
    index: '02',
    title: 'Browse the catalog',
    copy: 'Album pages list the tracks, artist pages gather the records, and live search narrows all of it while you type.',
  },
  {
    index: '03',
    title: 'Press play',
    copy: 'A single audio element stays mounted across every route, and each slice of the file is fetched over Range requests only when the playhead needs it.',
  },
];

export function LandingPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.wordmark}>
          spotify-clon<span className={styles.wordmarkDot}>.</span>
        </p>
        <Link className={styles.headerLink} to="/login">
          Sign in
        </Link>
      </header>

      <main>
        <section className={styles.hero} aria-label="Introduction">
          <div className={styles.heroCopy}>
            <p className={styles.kicker}>
              Self-hosted streaming · React + NestJS + Postgres
            </p>
            <h1 className={styles.headline}>
              A streaming app for the library{' '}
              <em className={styles.headlineEm}>you already own.</em>
            </h1>
            <p className={styles.lede}>
              The library owner uploads the FLAC and MP3 files; everyone with
              an account gets the full browsing experience — live search,
              playlists, saved albums, and a player that seeks instantly over
              HTTP Range requests.
            </p>
            <div className={styles.ctaRow}>
              <Link className={styles.ctaPrimary} to="/register">
                Create your account
              </Link>
              <Link className={styles.ctaGhost} to="/login">
                Sign in
              </Link>
            </div>
            <p className={styles.finePrint}>
              Demo deployment — accounts are local to this server.
            </p>
          </div>

          {/* Decorative mock of the real player: range-segmented download
              ruler + waveform. No focusables inside, so aria-hidden is safe. */}
          <div className={styles.heroPanel} aria-hidden="true">
            <div className={styles.panel}>
              <p className={styles.panelLabel}>Now streaming</p>
              <p className={styles.panelTrack}>So What</p>
              <p className={styles.panelMeta}>
                Miles Davis — Kind of Blue (1959)
              </p>
              <div className={styles.waveform}>
                {BAR_HEIGHTS.map((height, i) => (
                  <span key={i} className={styles.bar} style={{ height: `${height}%` }} />
                ))}
              </div>
              <div className={styles.rangeRuler}>
                <span className={styles.rangeSegment}>0–1 MB</span>
                <span className={styles.rangeSegment}>1–2 MB</span>
                <span className={`${styles.rangeSegment} ${styles.rangeTail}`}>
                  2–2.4 MB
                </span>
                <span className={styles.playhead} />
              </div>
              <p className={styles.panelCaption}>
                Fetched in slices on demand — 206 Partial Content, no
                full-file download.
              </p>
              <div className={styles.panelControls}>
                <span className={styles.playGlyph} />
                <span className={styles.panelTime}>0:00 / 9:22</span>
              </div>
            </div>
          </div>
        </section>

        <div className={styles.marquee} aria-hidden="true">
          <div className={styles.marqueeTrack}>
            {[0, 1].map((group) => (
              <div className={styles.marqueeGroup} key={group}>
                {FORMATS.map((word) => (
                  <span className={styles.marqueeItem} key={word}>
                    {word}
                    <span className={styles.marqueeDot}> · </span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        <section className={styles.features} aria-labelledby="features-title">
          <p className={styles.sectionKicker}>Features — 01–04</p>
          <h2 id="features-title" className={styles.sectionTitle}>
            Built like a product, not a demo.
          </h2>
          <div className={styles.featureRows}>
            {FEATURES.map((feature) => (
              <article
                key={feature.index}
                className={`${styles.featureRow} ${ROW_CLASS[feature.variant]}`}
              >
                <p className={styles.featureIndex} aria-hidden="true">
                  {feature.index}
                </p>
                <h3 className={styles.featureTitle}>{feature.title}</h3>
                <p className={styles.featureCopy}>{feature.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.steps} aria-labelledby="steps-title">
          <p className={styles.sectionKicker}>How it works</p>
          <h2 id="steps-title" className={styles.sectionTitle}>
            From zero to playing in three steps.
          </h2>
          <ol className={styles.stepList}>
            {STEPS.map((step) => (
              <li key={step.index} className={styles.step}>
                <p className={styles.stepIndex}>Step {step.index}</p>
                <h3 className={styles.stepTitle}>{step.title}</h3>
                <p className={styles.stepCopy}>{step.copy}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className={styles.footer}>
        <p className={styles.legal}>
          Demo project — music files supplied by the library owner.
        </p>
        <p className={styles.stack}>React · NestJS · Prisma · PostgreSQL</p>
        <nav className={styles.footerNav} aria-label="Account">
          <Link className={styles.footerLink} to="/login">
            Sign in
          </Link>
          <Link className={styles.footerLink} to="/register">
            Create account
          </Link>
        </nav>
      </footer>
    </div>
  );
}
