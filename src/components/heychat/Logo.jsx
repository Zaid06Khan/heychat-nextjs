export default function Logo({ className = 'w-10 h-10' }) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M48 22 L70 34 L70 56 Q70 70 48 78 Q26 70 26 56 L26 34 Z" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinejoin="round" />
      <circle cx="80" cy="20" r="5" fill="currentColor" />
      <circle cx="91" cy="14" r="3.5" fill="currentColor" />
      <circle cx="84" cy="8" r="2.5" fill="currentColor" />
    </svg>
  );
}