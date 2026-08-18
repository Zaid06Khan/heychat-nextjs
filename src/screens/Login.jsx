import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { login, getSession } from '@/lib/heychatAuth';
import { ArrowLeft, Eye, EyeOff, Check } from 'lucide-react';
import Logo from '@/components/heychat/Logo';

/**
 * The username only. Never the password.
 *
 * This is a convenience for a device you already trust, and it is worth being
 * clear about what it is not: there is no "stay signed in" here, because the
 * session cookie already does that. All this removes is retyping a name.
 *
 * Storing the password would be a different thing entirely — it would put a
 * reusable credential in localStorage, readable by any script that ever runs on
 * this origin, for an account whose ONLY recovery path is a recovery password.
 */
const REMEMBER_KEY = 'calamus3_remembered_username';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(false);
  const navigate = useNavigate();

  // In an effect, not as an initialiser: this component renders on the server
  // during the SPA's first paint, where localStorage does not exist.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved) {
        setUsername(saved);
        setRemember(true);
      }
    } catch {
      // Private mode, or storage disabled. Nothing to restore.
    }
  }, []);

  if (getSession()) return <Navigate to="/home" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const name = username.trim();
      await login({ username: name, password });
      // Only after a login that actually worked — otherwise a typo gets
      // remembered and helpfully retyped for you every time.
      try {
        if (remember) localStorage.setItem(REMEMBER_KEY, name);
        else localStorage.removeItem(REMEMBER_KEY);
      } catch {
        // Not being able to remember is not a reason to fail the login.
      }
      navigate('/home');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col px-6">
      <Link to="/" className="flex items-center gap-2 pt-6 text-muted-foreground hover:text-foreground transition">
        <ArrowLeft className="w-4 h-4" /> Back
      </Link>
      <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full">
        <Logo className="w-20 h-20 mb-5" />
        <h1 className="text-3xl font-heading font-bold text-foreground mb-2">Welcome back</h1>
        <p className="text-muted-foreground mb-8">Log in with your username and password.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your_username"
              autoCapitalize="none"
              required
              className="w-full bg-secondary rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-secondary rounded-xl px-4 py-3 pr-12 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary"
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className={`w-5 h-5 rounded-md border-2 border-foreground flex items-center justify-center transition peer-focus-visible:ring-2 peer-focus-visible:ring-primary ${
                remember ? 'bg-accent text-accent-foreground' : 'bg-secondary text-transparent'
              }`}
            >
              <Check className="w-3.5 h-3.5" />
            </span>
            <span className="text-sm text-muted-foreground">Remember my username</span>
          </label>
          {error && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3 text-sm text-destructive">{error}</div>
          )}
          <button type="submit" disabled={loading} className="w-full py-3.5 rounded-xl gradient-bg text-white font-semibold disabled:opacity-50 hover:opacity-90 transition glow-violet">
            {loading ? 'Logging in...' : 'Log In'}
          </button>
        </form>
        <p className="text-center text-sm text-muted-foreground mt-6">
          Don't have an account? <Link to="/register" className="text-primary font-medium">Sign up</Link>
        </p>
        <p className="text-center text-sm text-muted-foreground mt-2">
          <Link to="/forgot-password" className="text-primary font-medium">Forgot password?</Link>
        </p>
      </div>
    </div>
  );
}