import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { login, getSession } from '@/lib/heychatAuth';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import Logo from '@/components/heychat/Logo';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  if (getSession()) return <Navigate to="/home" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login({ username: username.trim(), password });
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
        <div className="w-16 h-16 rounded-2xl gradient-bg flex items-center justify-center glow-soft mb-6">
          <Logo className="w-9 h-9 text-white" />
        </div>
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