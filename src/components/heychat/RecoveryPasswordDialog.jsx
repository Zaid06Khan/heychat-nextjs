import { useState } from 'react';
import { setRecoveryPassword } from '@/lib/heychatAuth';
import { X, Eye, EyeOff, KeyRound } from 'lucide-react';

export default function RecoveryPasswordDialog({ open, onClose, hasRecoveryPassword }) {
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (recoveryPassword !== confirmPassword) { setError('Recovery passwords do not match'); return; }
    if (recoveryPassword.length < 8) { setError('Recovery password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      await setRecoveryPassword(recoveryPassword);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setRecoveryPassword('');
        setConfirmPassword('');
        onClose();
      }, 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-card border border-border rounded-3xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <KeyRound className="w-5 h-5 text-primary" />
            </div>
            <h3 className="text-lg font-heading font-bold text-foreground">{hasRecoveryPassword ? 'Update recovery password' : 'Set recovery password'}</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          {hasRecoveryPassword
            ? 'Choose a new recovery password. You can use it to reset your main password if you forget it.'
            : 'Choose a recovery password (min 8 characters). You can use it to reset your main password if you forget it.'}
        </p>
        {success ? (
          <div className="bg-accent/10 border border-accent/20 rounded-xl px-4 py-3 text-sm text-accent text-center">Recovery password saved!</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Recovery password</label>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={recoveryPassword} onChange={(e) => setRecoveryPassword(e.target.value)} placeholder="Min 8 characters" required className="w-full bg-secondary rounded-xl px-4 py-3 pr-12 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">{showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Confirm recovery password</label>
              <input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" required className="w-full bg-secondary rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary" />
            </div>
            {error && <div className="bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3 text-sm text-destructive">{error}</div>}
            <button type="submit" disabled={loading} className="w-full py-3.5 rounded-xl gradient-bg text-white font-semibold disabled:opacity-50 hover:opacity-90 transition glow-violet">{loading ? 'Saving...' : 'Save recovery password'}</button>
          </form>
        )}
      </div>
    </div>
  );
}