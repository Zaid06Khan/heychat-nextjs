import { Image } from '@/components/ui/image';

export default function Avatar({ src, name, size = 40, online, isGroup }) {
  const initials = (name || '?').charAt(0).toUpperCase();
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {src ? (
        <Image src={src} alt={name} className="w-full h-full rounded-full object-cover" fittingType="fill" />
      ) : (
        <div
          className="w-full h-full rounded-full gradient-bg flex items-center justify-center text-white font-semibold no-select"
          style={{ fontSize: size * 0.4 }}
        >
          {initials}
        </div>
      )}
      {online && !isGroup && (
        <span
          className="absolute bottom-0 right-0 bg-accent rounded-full border-2 border-background"
          style={{ width: size * 0.28, height: size * 0.28 }}
        />
      )}
    </div>
  );
}