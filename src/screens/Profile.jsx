import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { getCurrentAccount } from '@/lib/heychatAuth';
import { Camera, Save, QrCode, Share2 } from 'lucide-react';
import Avatar from '@/components/heychat/Avatar';

export default function Profile() {
  const [account, setAccount] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState('');
  const [saving, setSaving] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState('');

  // Object URLs are held by the browser until revoked, so a session of trying
  // photos would leak every one of them.
  useEffect(() => () => { if (avatarPreview) URL.revokeObjectURL(avatarPreview); }, [avatarPreview]);

  useEffect(() => {
    (async () => {
      const acc = await getCurrentAccount();
      setAccount(acc);
      setDisplayName(acc.display_name || '');
      setBio(acc.bio || '');
      setAvatar(acc.avatar || '');
    })();
  }, []);

  // A photo is stored as a private storage KEY, and /api/media/sign will only
  // sign a key that some account already lists as its avatar. So a picked photo
  // is unrenderable until it has been saved — which is why picking one used to
  // do nothing visible at all. Two changes fix that: show the local file
  // immediately, and save it immediately rather than waiting for "Save Changes".
  const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    // Clear the input so choosing the SAME file again still fires a change.
    e.target.value = '';
    if (!file) return;

    setAvatarError('');

    if (!file.type.startsWith('image/')) {
      setAvatarError('That file is not an image.');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError('That photo is larger than 8 MB. Try a smaller one.');
      return;
    }

    const localUrl = URL.createObjectURL(file);
    setAvatarPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return localUrl;
    });
    setAvatarBusy(true);

    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      await base44.entities.Account.update(account.id, { avatar: file_url });
      setAvatar(file_url);
      setAccount((a) => (a ? { ...a, avatar: file_url } : a));
    } catch (err) {
      console.error(err);
      setAvatarError('That photo could not be uploaded. Please try again.');
      // Drop the preview, so the avatar reflects what is actually stored rather
      // than a picture that only exists in this tab.
      setAvatarPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return '';
      });
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await base44.entities.Account.update(account.id, {
        display_name: displayName.trim() || account.username,
        bio: bio.trim(),
        avatar,
      });
      setAccount({ ...account, display_name: displayName.trim() || account.username, bio: bio.trim(), avatar });
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleShare = async () => {
    const link = `${window.location.origin}/?ref=${account.username}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Calamus3', text: `Connect with me on Calamus3: @${account.username}`, url: link }); } catch {}
    } else {
      try { await navigator.clipboard.writeText(link); alert('Profile link copied to clipboard!'); } catch { alert(link); }
    }
  };

  if (!account) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto">
      <div className="border-b border-border sticky top-0 bg-background z-10">
        <div className="flex items-center gap-3 px-4 py-3 max-w-2xl mx-auto w-full">
          <h1 className="text-2xl font-display font-extrabold text-foreground flex-1">Profile</h1>
          <button onClick={handleShare} className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition">
            <Share2 className="w-5 h-5" />
          </button>
          <button onClick={() => setShowQR(true)} className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition">
            <QrCode className="w-5 h-5" />
          </button>
        </div>
      </div>
      <div className="p-6 flex flex-col items-center max-w-2xl mx-auto w-full">
        <div className="relative">
          <Avatar src={avatar} name={displayName || account.username} size={100} previewUrl={avatarPreview} />
          {avatarBusy && (
            <div
              role="status"
              aria-label="Uploading photo"
              className="absolute inset-0 rounded-full bg-foreground/40 flex items-center justify-center"
            >
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          <label className="absolute bottom-0 right-0 w-8 h-8 rounded-full gradient-bg flex items-center justify-center cursor-pointer border-2 border-background">
            <Camera className="w-4 h-4 text-white" />
            <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
          </label>
        </div>
        <p className="text-xs text-muted-foreground mt-2">@{account.username}</p>
        {avatarError && (
          <p className="text-xs text-destructive mt-2 text-center">{avatarError}</p>
        )}
      </div>
      <div className="px-4 pb-8 space-y-4 max-w-2xl mx-auto w-full">
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">Display name</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={account.username} className="w-full bg-secondary rounded-xl px-4 py-3 text-foreground outline-none focus:ring-2 focus:ring-primary" />
        </div>
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">Bio</label>
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell people about yourself..." rows={3} className="w-full bg-secondary rounded-xl px-4 py-3 text-foreground outline-none focus:ring-2 focus:ring-primary resize-none" />
        </div>
        <button onClick={handleSave} disabled={saving} className="w-full py-3.5 rounded-xl gradient-bg font-display font-bold shadow-pop-sm disabled:opacity-50 hover:-translate-y-0.5 transition flex items-center justify-center gap-2">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {showQR && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowQR(false)}>
          <div className="w-full max-w-xs bg-card border border-border rounded-3xl p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-heading font-bold text-foreground mb-1">Your QR Code</h3>
            <p className="text-sm text-muted-foreground mb-4">Share this with people to let them add you as a contact</p>
            <div className="bg-white p-4 rounded-2xl mx-auto w-fit">
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(account.username)}`} alt="QR Code" className="w-48 h-48" />
            </div>
            <p className="text-sm text-foreground font-medium mt-4">@{account.username}</p>
            <button onClick={() => setShowQR(false)} className="w-full mt-4 py-3 rounded-xl bg-secondary text-foreground font-medium">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}