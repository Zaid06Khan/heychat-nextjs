import { Link, Navigate } from 'react-router-dom';
import { Lock, Flame, AtSign, Users } from 'lucide-react';
import { getSession } from '@/lib/heychatAuth';
import Logo from '@/components/heychat/Logo';

export default function Landing() {
  if (getSession()) return <Navigate to="/home" replace />;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* The blurred colour orbs that used to sit here were built for the old
          near-black theme. On paper they read as smudges, and Bodega has no
          blur in it at all. */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="max-w-md">
          <Logo className="w-28 h-28 mx-auto mb-6 animate-slide-up" />
          <h1 className="text-6xl font-display font-extrabold text-foreground mb-3 animate-slide-up">Calamus3</h1>
          <p className="text-xl font-display font-bold text-primary mb-3 animate-slide-up">Private. Simple. Yours.</p>
          <p className="text-sm font-medium text-muted-foreground mb-10 max-w-sm mx-auto animate-slide-up">
            Messages that disappear when you want them to. No phone number, no
            email — just a username.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center animate-slide-up">
            <Link to="/register" className="px-8 py-3.5 rounded-full gradient-bg font-display font-bold shadow-pop-sm hover:-translate-y-0.5 transition">
              Create account
            </Link>
            <Link to="/login" className="px-8 py-3.5 rounded-full bg-card border-2 border-foreground text-foreground font-display font-bold shadow-pop-sm hover:-translate-y-0.5 transition">
              Log in
            </Link>
          </div>
        </div>
      </div>

      <div className="px-6 pb-12">
        <div className="max-w-2xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            // Says "in transit" because that is what is actually true today:
            // HTTPS to the server, encrypted at rest on the database disk.
            // Message bodies are readable by the server. Do not restore the
            // end-to-end claim until E2EE is genuinely implemented.
            { icon: Lock, label: 'Encrypted in transit' },
            { icon: Flame, label: 'Disappearing messages' },
            // "Video calls" used to sit here. It has never worked -- CallOverlay
            // shows you your own camera and there is no peer connection behind
            // it -- so advertising it on the front door was the same kind of
            // false claim as the end-to-end encryption line that was already
            // removed. Put it back when calls actually connect.
            { icon: AtSign, label: 'No phone or email' },
            { icon: Users, label: 'Group chats' },
          ].map((f, i) => (
            <div key={i} className="flex flex-col items-center text-center gap-2">
              <div className="w-12 h-12 rounded-2xl bg-card border-2 border-foreground shadow-pop-sm flex items-center justify-center">
                <f.icon className="w-5 h-5 text-foreground" strokeWidth={2.25} />
              </div>
              <p className="text-xs font-bold text-muted-foreground">{f.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}