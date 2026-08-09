import { Image } from '@/components/ui/image';
import { useSignedMedia } from '@/lib/media/useSignedMedia';

export default function Avatar({ src, name, size = 40, online, isGroup }) {
  const initials = (name || '?').charAt(0).toUpperCase();

  // Avatars live in the same private bucket as attachments (0006), so a stored
  // value is a key rather than a fetchable URL. Every caller passes `src`
  // straight from the database, so resolving here covers all of them at once.
  // While it resolves — and if it fails — the initial stands in, which is what
  // most accounts show anyway.
  const { url } = useSignedMedia(src ? { key: src } : {});

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
