/**
 * The mark: the Calamus3 shield — gold on near-black, quill and scroll.
 *
 * Adopted 2026-08-18, replacing a drawn two-tailed speech bubble (which had
 * itself replaced a shield-with-a-tick that read as antivirus).
 *
 * IT IS A COMPLETE LOCKUP, NOT A GLYPH, and that changed how it is used. The
 * old mark was a monochrome path that took `currentColor`, so every call site
 * sat it inside a `gradient-bg` chip and coloured it with `text-white`. This one
 * carries its own palette and its own dark shield ground, so those chips are
 * gone — a blue gradient behind a gold shield fought it and hid the silhouette.
 * Call sites now render the mark at the size the chip used to be.
 *
 * RASTER, NOT VECTOR, because the artwork is a rendered illustration with
 * gradients, bevels and circuit tracery. There is no faithful path version of
 * it. The consequence is worth stating plainly: it is built for 32px and up.
 * Below that the tracery and the wordmark inside the shield turn to mush — the
 * favicon is legible as "a gold shield" and no more. A simplified small-size
 * variant would be a separate piece of artwork, not something to derive here.
 *
 * `/logo.png` is 512px square with a transparent ground. The other sizes
 * (manifest, apple-touch, favicon) are generated from the same source; see
 * scripts/build-icons.mjs.
 */
export default function Logo({ className = 'w-10 h-10', alt = '' }) {
  return (
    <img
      src="/logo.png"
      alt={alt}
      // Decorative wherever it sits beside the wordmark, which is every current
      // call site. A caller that uses it as the only naming passes `alt`.
      aria-hidden={alt ? undefined : 'true'}
      draggable="false"
      className={`${className} object-contain select-none`}
    />
  );
}
