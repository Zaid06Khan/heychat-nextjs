import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { resetPasswordWithRecovery } from '@/lib/heychatAuth';
import { ArrowLeft, Eye, EyeOff, CheckCircle2, KeyRound } from 'lucide-react';
import Logo from '@/components/heychat/Logo';

export default function ForgotPassword() {
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const validateNewPassword = () => {
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return false; }
    if (newPassword.length < 8) { setError('Password must be at least 8 characters'); return false; }
    if (!/[A-Z]/.test(newPassword)) { setError('Password must contain at least one uppercase letter'); return false; }
    if (!/[0-9]/.test(newPassword)) { setError('Password must contain at least one number'); return false; }
    return true;
  };

  const handleUsernameSubmit = (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim()) return;
    setStep(2);
  };

  const handleRecoveryReset = async (e) => {
    e.preventDefault();
    setError('');
    if (!recoveryPassword) { setError('Enter your recovery password'); return; }
    if (!validateNewPassword()) return;
    setLoading(true);
    try {
      await resetPasswordWithRecovery({ username: username.trim(), recoveryPassword, newPassword });
      setStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const resetFormState = () => {
    setRecoveryPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col px-6">
      <Link to="/login" className="flex items-center gap-2 pt-6 text-muted-foreground hover:text-foreground transition">
        <ArrowLeft className="w-4 h-4" /> Back to login
      </Link>
      <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full">
        <Logo className="w-20 h-20 mb-5" />

        {step === 1 && (
          <>
            <h1 className="text-3xl font-heading font-bold text-foreground mb-2">Forgot password</h1>
            <p className="text-muted-foreground mb-8">Enter your username to reset your password.</p>
            <form onSubmit={handleUsernameSubmit} className="space-y-4">
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
              {error && <div className="bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3 text-sm text-destructive">{error}</div>}
              <button type="submit" disabled={!username.trim()} className="w-full py-3.5 rounded-xl gradient-bg text-white font-semibold disabled:opacity-50 hover:opacity-90 transition glow-violet">
                Continue
              </button>
            </form>
          </>
        )}

        {/* There used to be a step 2 offering a choice: verify with this
            device, or use the recovery password. The device option went with
            device binding (FOLLOWUPS #6) — it had nothing left to verify — so
            the recovery password is now the only route, and a menu with one
            item is not a menu. Username goes straight here. */}
        {step === 2 && (
          <>
            <div className="flex items-center gap-2 mb-2">
              <KeyRound className="w-6 h-6 text-primary" />
              <h1 className="text-3xl font-heading font-bold text-foreground">Recovery password</h1>
            </div>
            <p className="text-muted-foreground mb-8">Enter your recovery password and choose a new password for @{username}.</p>
            <form onSubmit={handleRecoveryReset} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Recovery password</label>
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} value={recoveryPassword} onChange={(e) => setRecoveryPassword(e.target.value)} placeholder="Your recovery password" required className="w-full bg-secondary rounded-xl px-4 py-3 pr-12 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">{showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">New password</label>
                <input type={showPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min 8 chars, 1 uppercase, 1 number" required className="w-full bg-secondary rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Confirm new password</label>
                <input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" required className="w-full bg-secondary rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary" />
              </div>
              {error && <div className="bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3 text-sm text-destructive">{error}</div>}
              <button type="submit" disabled={loading} className="w-full py-3.5 rounded-xl gradient-bg text-white font-semibold disabled:opacity-50 hover:opacity-90 transition glow-violet">{loading ? 'Resetting...' : 'Reset password'}</button>
            </form>
            <button onClick={() => { setStep(1); resetFormState(); }} className="w-full text-center text-sm text-muted-foreground mt-4 hover:text-foreground transition">← Use a different username</button>
          </>
        )}

        {step === 3 && (
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-accent/20 flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-foreground" />
            </div>
            <h1 className="text-3xl font-heading font-bold text-foreground mb-2">Password reset</h1>
            <p className="text-muted-foreground mb-8">Your password has been changed successfully. You can now log in with your new password.</p>
            <button onClick={() => navigate('/login')} className="w-full py-3.5 rounded-xl gradient-bg text-white font-semibold hover:opacity-90 transition glow-violet">Back to login</button>
          </div>
        )}
      </div>
    </div>
  );
}