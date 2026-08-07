import { Link, Navigate } from 'react-router-dom';
import { Lock, Flame, Video, Users } from 'lucide-react';
import { getSession } from '@/lib/heychatAuth';
import Logo from '@/components/heychat/Logo';

export default function Landing() {
  if (getSession()) return <Navigate to="/home" replace />;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-primary rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-accent rounded-full blur-3xl" />
        </div>
        <div className="relative z-10 max-w-md">
          <div className="w-20 h-20 mx-auto rounded-3xl gradient-bg flex items-center justify-center glow-soft mb-8 animate-slide-up">
            <Logo className="w-11 h-11 text-white" />
          </div>
          <h1 className="text-5xl font-heading font-bold gradient-text mb-3 animate-slide-up">HeyChat</h1>
          <p className="text-lg text-muted-foreground mb-2 animate-slide-up">Private. Simple. Yours.</p>
          <p className="text-sm text-muted-foreground mb-10 max-w-sm mx-auto animate-slide-up">
            Private messaging with disappearing messages, media sharing, and video calls. No phone number. No email. Just a username.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center animate-slide-up">
            <Link to="/register" className="px-8 py-3.5 rounded-full gradient-bg text-white font-semibold hover:opacity-90 transition glow-violet">
              Create Account
            </Link>
            <Link to="/login" className="px-8 py-3.5 rounded-full border border-border text-foreground font-semibold hover:bg-secondary transition">
              Log In
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
            { icon: Lock, label: 'Encrypted in Transit' },
            { icon: Flame, label: 'Disappearing Messages' },
            { icon: Video, label: 'Video Calls' },
            { icon: Users, label: 'Group Chats' },
          ].map((f, i) => (
            <div key={i} className="flex flex-col items-center text-center gap-2">
              <div className="w-12 h-12 rounded-2xl bg-card border border-border flex items-center justify-center">
                <f.icon className="w-5 h-5 text-accent" />
              </div>
              <p className="text-xs text-muted-foreground">{f.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}