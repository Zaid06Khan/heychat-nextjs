import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { getCurrentAccount, logout, deleteAccount } from '@/lib/heychatAuth';
import { ArrowLeft, Shield, Eye, Users, Trash2, LogOut, Smartphone, AlertTriangle, Globe, KeyRound, MapPin } from 'lucide-react';
import { LANGUAGES, setLanguage } from '@/lib/i18n';
import ChangePasswordDialog from '@/components/heychat/ChangePasswordDialog';
import RecoveryPasswordDialog from '@/components/heychat/RecoveryPasswordDialog';
import { COUNTRIES } from '@/lib/countries';

export default function Settings() {
  const [account, setAccount] = useState(null);
  const [showDelete, setShowDelete] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const acc = await getCurrentAccount();
      setAccount(acc);
    })();
  }, []);

  const updateSetting = async (key, value) => {
    await base44.entities.Account.update(account.id, { [key]: value });
    setAccount({ ...account, [key]: value });
  };

  const handleLanguageChange = async (lang) => {
    await base44.entities.Account.update(account.id, { language: lang });
    setLanguage(lang);
    setAccount({ ...account, language: lang });
    window.location.reload();
  };

  const handleOptOut = async (value) => {
    await base44.entities.Account.update(account.id, { opt_out_of_suggestions: value });
    setAccount({ ...account, opt_out_of_suggestions: value });
  };

  const handleDelete = async () => {
    if (deleteConfirm !== 'DELETE') return;
    await deleteAccount();
    navigate('/');
  };

  if (!account) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto">
      <div className="border-b border-border sticky top-0 bg-background z-10">
        <div className="flex items-center gap-3 px-4 py-3 max-w-2xl mx-auto w-full">
          <h1 className="text-xl font-heading font-bold text-foreground">Settings</h1>
        </div>
      </div>
      <div className="p-4 space-y-6 max-w-2xl mx-auto w-full">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4" /> Privacy
          </h2>
          <div className="space-y-1 bg-card rounded-2xl border border-border p-2">
            <div className="flex items-center justify-between p-3">
              <div className="flex items-center gap-3">
                <Eye className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Online status visibility</p>
                  <p className="text-xs text-muted-foreground">Who can see when you're online</p>
                </div>
              </div>
              <select value={account.online_status_visibility} onChange={(e) => updateSetting('online_status_visibility', e.target.value)} className="bg-secondary text-foreground text-sm rounded-lg px-3 py-1.5 outline-none">
                <option value="everyone">Everyone</option>
                <option value="contacts_only">Contacts only</option>
                <option value="nobody">Nobody</option>
              </select>
            </div>
            <div className="flex items-center justify-between p-3">
              <div className="flex items-center gap-3">
                <Users className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Who can add you to groups</p>
                  <p className="text-xs text-muted-foreground">Group invitation permission</p>
                </div>
              </div>
              <select value={account.group_add_permission} onChange={(e) => updateSetting('group_add_permission', e.target.value)} className="bg-secondary text-foreground text-sm rounded-lg px-3 py-1.5 outline-none">
                <option value="everyone">Everyone</option>
                <option value="contacts_only">Contacts only</option>
              </select>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
            <Globe className="w-4 h-4" /> Language
          </h2>
          <div className="bg-card rounded-2xl border border-border p-4">
            <select value={account.language || 'en'} onChange={(e) => handleLanguageChange(e.target.value)} className="w-full bg-secondary text-foreground rounded-xl px-4 py-3 outline-none">
              {Object.entries(LANGUAGES).map(([code, lang]) => (
                <option key={code} value={code}>{lang.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Discoverability</h2>
          <div className="space-y-1 bg-card rounded-2xl border border-border p-2">
            <div className="flex items-center justify-between p-3">
              <div className="flex items-center gap-3">
                <MapPin className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Country</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Used to suggest nearby people</p>
                </div>
              </div>
              <select value={account.country || ''} onChange={(e) => updateSetting('country', e.target.value)} className="bg-secondary text-foreground text-sm rounded-lg px-3 py-1.5 outline-none max-w-[140px]">
                <option value="">Select...</option>
                {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <label className="flex items-center justify-between cursor-pointer p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Opt out of suggestions</p>
                <p className="text-xs text-muted-foreground mt-0.5">Don't show me to other people as a suggestion</p>
              </div>
              <input type="checkbox" checked={account.opt_out_of_suggestions || false} onChange={(e) => handleOptOut(e.target.checked)} className="w-5 h-5 accent-primary" />
            </label>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
            <Smartphone className="w-4 h-4" /> Device
          </h2>
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="flex items-center gap-3">
              <Smartphone className="w-5 h-5 text-accent" />
              <div>
                <p className="text-sm font-medium text-foreground">Device-bound account</p>
                <p className="text-xs text-muted-foreground mt-0.5">This account is permanently linked to this device's fingerprint.</p>
                <p className="text-xs text-muted-foreground mt-1 font-mono break-all">
                  {account.device_fingerprint_hash?.substring(0, 32)}...
                </p>
              </div>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> Security
          </h2>
          <div className="space-y-1 bg-card rounded-2xl border border-border p-2">
            <button onClick={() => setShowPasswordDialog(true)} className="w-full flex items-center justify-between text-left p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Change password</p>
                <p className="text-xs text-muted-foreground mt-0.5">Only available on your registered device</p>
              </div>
              <ArrowLeft className="w-4 h-4 text-muted-foreground rotate-180" />
            </button>
            <button onClick={() => setShowRecoveryDialog(true)} className="w-full flex items-center justify-between text-left p-3">
              <div>
                <p className="text-sm font-medium text-foreground">{account.recovery_password_hash ? 'Update recovery password' : 'Set recovery password'}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{account.recovery_password_hash ? 'Change your password recovery key' : 'Required to reset your password if you forget it'}</p>
              </div>
              <ArrowLeft className="w-4 h-4 text-muted-foreground rotate-180" />
            </button>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Account</h2>
          <div className="space-y-1">
            <button onClick={async () => { await logout(); navigate('/'); }} className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:bg-secondary transition text-left">
              <LogOut className="w-5 h-5 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">Log out</p>
            </button>
            <button onClick={() => setShowDelete(true)} className="w-full flex items-center gap-3 p-3 rounded-xl bg-destructive/10 border border-destructive/20 hover:bg-destructive/20 transition text-left">
              <Trash2 className="w-5 h-5 text-destructive" />
              <p className="text-sm font-medium text-destructive">Delete account permanently</p>
            </button>
          </div>
        </div>
      </div>

      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowDelete(false)}>
          <div className="w-full max-w-sm bg-card border border-border rounded-3xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-2xl bg-destructive/20 flex items-center justify-center mb-4">
              <AlertTriangle className="w-6 h-6 text-destructive" />
            </div>
            <h3 className="text-lg font-heading font-bold text-foreground mb-2">Delete account?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              This will permanently delete your account, all messages, and conversations. This cannot be undone.
            </p>
            <p className="text-sm text-muted-foreground mb-2">Type <span className="font-mono font-bold text-foreground">DELETE</span> to confirm:</p>
            <input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder="DELETE" className="w-full bg-secondary rounded-xl px-4 py-3 text-foreground outline-none mb-4" />
            <div className="flex gap-2">
              <button onClick={() => setShowDelete(false)} className="flex-1 py-3 rounded-xl bg-secondary text-foreground font-medium">Cancel</button>
              <button onClick={handleDelete} disabled={deleteConfirm !== 'DELETE'} className="flex-1 py-3 rounded-xl bg-destructive text-white font-semibold disabled:opacity-40">Delete</button>
            </div>
          </div>
        </div>
      )}
      <ChangePasswordDialog open={showPasswordDialog} onClose={() => setShowPasswordDialog(false)} />
      <RecoveryPasswordDialog open={showRecoveryDialog} onClose={() => setShowRecoveryDialog(false)} hasRecoveryPassword={!!account.recovery_password_hash} />
    </div>
  );
}