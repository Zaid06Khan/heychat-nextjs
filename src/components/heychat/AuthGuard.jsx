import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { getSession } from '@/lib/heychatAuth';

export default function AuthGuard() {
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(!!getSession());
    setChecking(false);
  }, []);

  if (checking) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!authed) return <Navigate to="/" replace />;
  return <Outlet />;
}