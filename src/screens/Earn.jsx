import { useEffect, useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { getSession } from '@/lib/heychatAuth';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { Eye, Gamepad2, Download, DollarSign, Clock, CheckCircle2, Sparkles } from 'lucide-react';

/**
 * Reward amounts used to live right here, in the bundle:
 * `startActivity('game_play', 10, 1.00)` set the figure and inserted the row,
 * so anyone with devtools could credit themselves whatever they wanted.
 *
 * They now live in the earn_rewards table, which the browser cannot read
 * directly, and crediting goes through credit_earning() — a SECURITY DEFINER
 * function that takes an activity type and looks the amount up itself. The
 * numbers below are for display and for the countdown only; nothing this file
 * sends can change what gets paid. See supabase/migrations/0005_earnings.sql.
 */
const ICONS = { ad_watch: Eye, game_play: Gamepad2, app_download: Download };
const COPY = {
  ad_watch: { title: 'Watch an ad', sub: 'Watch a 15-second ad', unit: 'per ad' },
  game_play: { title: 'Play a game', sub: 'Play a quick game', unit: 'per game' },
  app_download: { title: 'Download an app', sub: 'Download a featured app', unit: 'per download' },
};

export default function Earn() {
  const [earnings, setEarnings] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState(null);
  const [timer, setTimer] = useState(0);
  const [error, setError] = useState('');
  const intervalRef = useRef(null);
  const session = getSession();

  useEffect(() => {
    loadEarnings();
    loadRewards();
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const loadRewards = async () => {
    const { data, error: e } = await getSupabaseBrowserClient().rpc('list_earn_rewards');
    if (e) { console.error(e); return; }
    setRewards(data || []);
  };

  const loadEarnings = async () => {
    try {
      const records = await base44.entities.Earning.filter({ account_id: session.id }, '-created_date', 50);
      setEarnings(records);
      setBalance(records.reduce((sum, e) => sum + Number(e.reward_amount || 0), 0));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const startActivity = (reward) => {
    setError('');
    setActivity(reward);
    setTimer(reward.duration_secs);
    intervalRef.current = setInterval(() => {
      setTimer((t) => {
        if (t <= 1) {
          clearInterval(intervalRef.current);
          completeActivity(reward.activity_type);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
  };

  const completeActivity = async (type) => {
    setActivity(null);
    setTimer(0);
    // Type only. The amount is the database's decision.
    const { error: e } = await getSupabaseBrowserClient().rpc('credit_earning', { p_activity: type });
    if (e) {
      console.error(e);
      setError("That didn't credit. Try again in a moment.");
      return;
    }
    loadEarnings();
  };

  const cancelActivity = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setActivity(null);
    setTimer(0);
  };

  const formatAmount = (amt) => `$${amt.toFixed(2)}`;
  const formatDate = (d) => new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const activityLabel = (type) => {
    if (type === 'ad_watch') return 'Ad watched';
    if (type === 'game_play') return 'Game played';
    if (type === 'app_download') return 'App downloaded';
    return type;
  };

  if (activity) {
    return (
      <div className="flex flex-col h-full bg-background items-center justify-center px-6">
        <div className="w-24 h-24 rounded-3xl gradient-bg flex items-center justify-center shadow-pop-lg mb-6">
          {(() => { const Icon = ICONS[activity.activity_type] || DollarSign; return <Icon className="w-12 h-12" />; })()}
        </div>
        <p className="text-2xl font-display font-extrabold text-foreground mb-2">
          {COPY[activity.activity_type]?.title || activity.activity_type}
        </p>
        <div className="text-6xl font-display font-extrabold text-primary mb-6">{timer}s</div>
        <div className="w-48 h-3 bg-secondary rounded-full overflow-hidden mb-6 border-2 border-foreground">
          <div
            className="h-full bg-primary transition-all duration-1000"
            style={{ width: `${((activity.duration_secs - timer) / activity.duration_secs) * 100}%` }}
          />
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          You'll earn {formatAmount(Number(activity.reward_amount))} when this finishes
        </p>
        <button onClick={cancelActivity} className="px-6 py-2.5 rounded-xl bg-card border-2 border-foreground shadow-pop-sm font-display font-bold text-sm hover:-translate-y-0.5 transition">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto">
      <div className="border-b border-border sticky top-0 bg-background z-10">
        <div className="px-4 py-3 max-w-2xl mx-auto w-full">
          <h1 className="text-2xl font-display font-extrabold text-foreground">Earn</h1>
        </div>
      </div>

      {/* Without the cap the balance card stretches to the full pane on a
          desktop window — a 1300px-wide gradient bar reading "$0.00". */}
      <div className="p-4 space-y-4 max-w-2xl mx-auto w-full">
        {/* Balance card — the one hero surface on this screen, so it gets
            citrus and the large shadow. Ink on citrus, never white. */}
        <div className="rounded-3xl bg-accent text-accent-foreground border-2 border-foreground shadow-pop-lg p-6">
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-widest">Your balance</span>
          </div>
          <p className="text-6xl font-display font-extrabold leading-none">{formatAmount(balance)}</p>
          <p className="text-xs font-semibold mt-3 opacity-70">Withdraw at $10 minimum</p>
        </div>

        {error && (
          <p className="text-sm font-semibold text-destructive bg-card border-2 border-foreground rounded-xl px-4 py-3">{error}</p>
        )}

        {/* Driven by the server's rate card rather than three hardcoded blocks,
            so changing a payout is a row update and not a redeploy. */}
        <div className="grid grid-cols-1 gap-3">
          {rewards.map((r) => {
            const Icon = ICONS[r.activity_type] || DollarSign;
            const copy = COPY[r.activity_type] || { title: r.activity_type, sub: '', unit: '' };
            return (
              <button
                key={r.activity_type}
                onClick={() => startActivity(r)}
                className="flex items-center gap-4 p-4 rounded-2xl bg-card border-2 border-foreground shadow-pop-sm hover:-translate-y-0.5 transition text-left"
              >
                <div className={`w-14 h-14 rounded-2xl border-2 border-foreground flex items-center justify-center shrink-0 ${
                  r.activity_type === 'ad_watch' ? 'bg-accent text-accent-foreground' : 'bg-primary text-primary-foreground'
                }`}>
                  <Icon className="w-7 h-7" />
                </div>
                <div className="flex-1">
                  <p className="font-display font-bold text-foreground">{copy.title}</p>
                  <p className="text-xs text-muted-foreground">{copy.sub}</p>
                </div>
                <div className="text-right">
                  <p className="font-display font-extrabold text-lg text-foreground">{formatAmount(Number(r.reward_amount))}</p>
                  <p className="text-[10px] text-muted-foreground">{copy.unit}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* How it works */}
        <div className="rounded-2xl bg-secondary border-2 border-foreground p-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-foreground" />
            <p className="text-sm font-semibold text-foreground">How earnings work</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            You earn 5¢ or 10% of ad revenue (whichever is lower) per ad watched, and $1 or 10% of game revenue (whichever is lower) per game played. Earnings are credited instantly and can be withdrawn once you reach $10.
          </p>
        </div>

        {/* History */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Earning History</h2>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : earnings.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-30" />
              <p className="text-sm text-muted-foreground">No earnings yet. Start watching ads or playing games!</p>
            </div>
          ) : (
            <div className="space-y-1">
              {earnings.map((e) => (
                <div key={e.id} className="flex items-center justify-between p-3 rounded-xl bg-card border-2 border-foreground">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-accent border-2 border-foreground flex items-center justify-center">
                      {e.activity_type === 'ad_watch' ? <Eye className="w-4 h-4 text-foreground" /> : e.activity_type === 'game_play' ? <Gamepad2 className="w-4 h-4 text-primary" /> : <Download className="w-4 h-4 text-primary" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{activityLabel(e.activity_type)}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(e.created_date)}</p>
                    </div>
                  </div>
                  <p className="font-display font-extrabold text-foreground">+{formatAmount(e.reward_amount)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}