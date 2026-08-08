import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { register, checkUsernameAvailability, getSession } from '@/lib/heychatAuth';
import { ArrowLeft, Eye, EyeOff, Check, X, Lock } from 'lucide-react';
import Logo from '@/components/heychat/Logo';

export default function Register() {
  const [username, setUsername] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [confirmRecoveryPassword, setConfirmRecoveryPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const navigate = useNavigate();

  if (getSession()) return <Navigate to="/home" replace />;

  const checkUsername = async (val) => {
    setUsername(val);
    if (val.length < 3) { setUsernameAvailable(null); return; }
    setChecking(true);
    try {
      const available = await checkUsernameAvailability(val.trim());
      setUsernameAvailable(available);
    } catch { setUsernameAvailable(null); }
    finally { setChecking(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (!/[A-Z]/.test(password)) { setError('Password must include at least one uppercase letter'); return; }
    if (!/[0-9]/.test(password)) { setError('Password must include at least one number'); return; }
    if (recoveryPassword !== confirmRecoveryPassword) { setError('Recovery passwords do not match'); return; }
    if (recoveryPassword.length < 8) { setError('Recovery password must be at least 8 characters'); return; }
    if (usernameAvailable === false) { setError('Username is already taken'); return; }
    setLoading(true);
    try {
      await register({ username: username.trim(), password, display_name: displayName.trim(), recovery_password: recoveryPassword });
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
      <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full py-8">
        <div className="w-16 h-16 rounded-2xl gradient-bg flex items-center justify-center glow-soft mb-6">
          <Logo className="w-9 h-9 text-white" />
        </div>
        <h1 className="text-3xl font-heading font-bold text-foreground mb-2">Create your account</h1>
        <p className="text-muted-foreground mb-2">No phone number. No email. Just a username.</p>
        <div className="flex items-center gap-2 mb-8 text-xs text-accent bg-accent/10 rounded-lg px-3 py-2">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          <span>Your account is bound to this device. Choose a recovery password you can use to reset your main password if you forget it.</span>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Username</label>
            <div className="relative">
              <input
                type="text"
                value={username}
                onChange={(e) => checkUsername(e.target.value)}
                placeholder="choose_a_username"
                autoCapitalize="none"
                required
                className="w-full bg-secondary rounded-xl px-4 py-3 pr-10 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary"
              />
              {checking && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />}
              {!checking && usernameAvailable === true && <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground" />}
              {!checking && usernameAvailable === false && <X className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-destructive" />}
            </div>
            {usernameAvailable === false && <p className="text-xs text-destructive mt-1">Username is already taken</p>}
            {usernameAvailable === true && <p className="text-xs text-accent mt-1">Username is available</p>}
          </div>
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Display name (optional)</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="What should people call you?"
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
                placeholder="Min 8 chars, 1 uppercase, 1 number"
                required
                className="w-full bg-secondary rounded-xl px-4 py-3 pr-12 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary"
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Confirm password</label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full bg-secondary rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Recovery password</label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={recoveryPassword}
              onChange={(e) => setRecoveryPassword(e.target.value)}
              placeholder="Min 8 chars — used if you forget your password"
              required
              className="w-full bg-secondary rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Confirm recovery password</label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmRecoveryPassword}
              onChange={(e) => setConfirmRecoveryPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full bg-secondary rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          {error && <div className="bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3 text-sm text-destructive">{error}</div>}
          <button type="submit" disabled={loading || usernameAvailable === false} className="w-full py-3.5 rounded-xl gradient-bg text-white font-semibold disabled:opacity-50 hover:opacity-90 transition glow-violet">
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>
        <p className="text-center text-sm text-muted-foreground mt-6">
          Already have an account? <Link to="/login" className="text-primary font-medium">Log in</Link>
        </p>
      </div>
    </div>
  );
}