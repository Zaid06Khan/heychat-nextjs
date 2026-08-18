import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      if (!localStorage.getItem('heychat_install_dismissed')) setShow(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(() => {
        setShow(false);
        setDeferredPrompt(null);
      });
    }
  };

  const handleDismiss = () => {
    setShow(false);
    localStorage.setItem('heychat_install_dismissed', '1');
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50 animate-slide-up">
      <div className="bg-card border border-border rounded-2xl p-4 glow-soft">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl gradient-bg flex items-center justify-center shrink-0">
            <Download className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-foreground text-sm">Install Calamus3</p>
            <p className="text-muted-foreground text-xs mt-0.5">Add to your home screen for a native app experience.</p>
          </div>
          <button onClick={handleDismiss} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <button
          onClick={handleInstall}
          className="w-full mt-3 py-2 rounded-xl gradient-bg text-white text-sm font-semibold hover:opacity-90 transition"
        >
          Install App
        </button>
      </div>
    </div>
  );
}