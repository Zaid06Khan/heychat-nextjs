import { Image } from '@/components/ui/image';
import { useSignedMedia } from '@/lib/media/useSignedMedia';

export default function Avatar({ src, name, size = 40, online, isGroup, previewUrl }) {
  const initials = (name || '?').charAt(0).toUpperCase();

  // Avatars live in the same private bucket as attachments (0006), so a stored
  // value is a key rather than a fetchable URL. Every caller passes `src`
  // straight from the database, so resolving here covers all of them at once.
  // While it resolves — and if it fails — the initial stands in, which is what
  // most accounts show anyway.
  // `previewUrl` short-circuits all of that. A photo the user just picked is
  // not yet referenced as anybody's avatar, and /api/media/sign deliberately
  // refuses to sign a key that isn't — so the only thing that can render it
  // before the save lands is the local file itself.
  const { url: signedUrl } = useSignedMedia(!previewUrl && src ? { key: src } : {});
  const url = previewUrl || signedUrl;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {url ? (
        <Image src={url} alt={name} className="w-full h-full rounded-full object-cover outline outline-2 outline-foreground" fittingType="fill" />
      ) : (
        <div
          className="w-full h-full rounded-full gradient-bg flex items-center justify-center font-display font-extrabold no-select"
          style={{ fontSize: size * 0.44 }}
        >
          {initials}
        </div>
      )}
      {online && !isGroup && (
        <span
          className="absolute bottom-0 right-0 bg-accent rounded-full border-2 border-foreground"
          style={{ width: size * 0.3, height: size * 0.3 }}
        />
      )}
    </div>
  );
}
