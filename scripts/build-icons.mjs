/**
 * Regenerate every icon size from the one master logo.
 *
 *     node scripts/build-icons.mjs [path-to-source.png]
 *
 * The master is `assets/logo-master.png` — the original 1261x1247 artwork with
 * a transparent ground, kept in the repo so these are reproducible rather than
 * a set of binaries nobody can rebuild.
 *
 * TWO THINGS HERE ARE NOT OBVIOUS:
 *
 * 1. Icons are COMPOSITED onto a canvas, not resize-extend-flattened. The
 *    obvious pipeline (resize with a transparent background, extend with an
 *    opaque one, then flatten) leaves a visible pale seam exactly where the
 *    padded region meets the artwork.
 *
 * 2. The opaque variants exist for specific platform behaviour, not taste.
 *    A maskable icon is cropped to whatever shape the launcher likes, so the
 *    mark sits inside the 80% safe zone on a solid ground. iOS ignores
 *    transparency in a touch icon and composites it on black, so that one is
 *    opaque too — otherwise the gold tracery sits on an accidental background.
 */
import sharp from 'sharp';

const SRC = process.argv[2] || 'assets/logo-master.png';

const INK = { r: 0x12, g: 0x10, b: 0x0e, alpha: 1 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

async function build(size, bg, inset = 1) {
  const inner = Math.round(size * inset);
  const logo = await sharp(SRC)
    .resize(inner, inner, { fit: 'contain', background: CLEAR })
    .png()
    .toBuffer();

  return sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: logo, gravity: 'centre' }])
    .png({ compressionLevel: 9 });
}

const targets = [
  ['public/logo.png', 512, CLEAR, 1],
  ['public/icon-192.png', 192, CLEAR, 1],
  ['public/icon-512.png', 512, CLEAR, 1],
  ['public/icon-maskable-512.png', 512, INK, 0.72],
  ['src/app/apple-icon.png', 180, INK, 0.84],
  ['src/app/icon.png', 512, CLEAR, 1],
];

for (const [out, size, bg, inset] of targets) {
  await (await build(size, bg, inset)).toFile(out);
  console.log(`  ${out}  ${size}x${size}`);
}
console.log('done');
