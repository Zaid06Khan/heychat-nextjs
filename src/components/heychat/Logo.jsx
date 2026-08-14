/**
 * The mark: one speech bubble, split down the middle, with two tails.
 *
 * One conversation, two voices — the seam and the second tail are the whole
 * idea, and they are what stop it being the generic bubble every chat app uses.
 * It replaced a shield with a tick in it, which read as antivirus rather than
 * anything to do with talking to people.
 *
 * MONOCHROME ON PURPOSE. Every call site puts this inside a coloured chip and
 * sets the colour with `text-*`, so the mark takes `currentColor` and carries no
 * palette of its own. The two-tone version — blue and citrus halves — lives in
 * `public/icon.svg`, which is the only place a full-colour lockup is wanted.
 * Keeping them apart is why the app icon can be ink-on-dark while the in-app
 * mark stays white on blue.
 *
 * Drawn in a 100×100 box with a 7-unit stroke so it still holds at the smallest
 * size it is used at (w-5, i.e. 20px).
 */
export default function Logo({ className = 'w-10 h-10' }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Right half, tail dropping right of centre. */}
      <path
        d="M50 12 h28 a18 18 0 0 1 18 18 v24 a18 18 0 0 1 -18 18 h-8 v16 l-16 -16 h-4 z"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinejoin="round"
      />
      {/* Left half, mirrored. The shared edge at x=50 is drawn by both and is
          the seam that makes it two bubbles rather than one. */}
      <path
        d="M50 12 h-28 a18 18 0 0 0 -18 18 v24 a18 18 0 0 0 18 18 h8 v16 l16 -16 h4 z"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
