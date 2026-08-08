import { Image } from '@/components/ui/image';

export default function Avatar({ src, name, size = 40, online, isGroup }) {
  const initials = (name || '?').charAt(0).toUpperCase();
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {src ? (
        <Image src={src} alt={name} className="w-full h-full rounded-full object-cover outline outline-2 outline-foreground" fittingType="fill" />
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