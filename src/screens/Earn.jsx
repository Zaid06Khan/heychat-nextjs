import { useEffect, useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { getSession } from '@/lib/heychatAuth';
import { Eye, Gamepad2, Download, DollarSign, Clock, CheckCircle2, Sparkles } from 'lucide-react';

export default function Earn() {
  const [earnings, setEarnings] = useState([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState(null);
  const [timer, setTimer] = useState(0);
  const intervalRef = useRef(null);
  const session = getSession();

  useEffect(() => {
    loadEarnings();
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const loadEarnings = async () => {
    try {
      const records = await base44.entities.Earning.filter({ account_id: session.id }, '-created_date', 50);
      setEarnings(records);
      setBalance(records.reduce((sum, e) => sum + (e.reward_amount || 0), 0));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const startActivity = (type, duration, reward) => {
    setActivity({ type, reward });
    setTimer(duration);
    intervalRef.current = setInterval(() => {
      setTimer((t) => {
        if (t <= 1) {
          clearInterval(intervalRef.current);
          completeActivity(type, reward);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
  };

  const completeActivity = async (type, reward) => {
    setActivity(null);
    setTimer(0);
    await base44.entities.Earning.create({
      account_id: session.id,
      activity_type: type,
      reward_amount: reward,
      currency: 'USD',
      status: 'credited',
    });
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
        <div className="w-24 h-24 rounded-3xl gradient-bg flex items-center justify-center glow-soft mb-6">
          {activity.type === 'ad_watch' ? <Eye className="w-12 h-12 text-white" /> : <Gamepad2 className="w-12 h-12 text-white" />}
        </div>
        <p className="text-2xl font-heading font-bold text-foreground mb-2">
          {activity.type === 'ad_watch' ? 'Watching Ad...' : 'Playing Game...'}
        </p>
        <div className="text-5xl font-heading font-bold gradient-text mb-6">{timer}s</div>
        <div className="w-48 h-2 bg-secondary rounded-full overflow-hidden mb-6">
          <div
            className="h-full gradient-bg transition-all duration-1000"
            style={{ width: `${((activity.type === 'ad_watch' ? 15 : 10) - timer) / (activity.type === 'ad_watch' ? 15 : 10) * 100}%` }}
          />
        </div>
        <p className="text-sm text-muted-foreground mb-4">You'll earn {formatAmount(activity.reward)} when complete</p>
        <button onClick={cancelActivity} className="px-6 py-2.5 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-secondary/70 transition">
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

        {/* Activity cards */}
        <div className="grid grid-cols-1 gap-3">
          <button
            onClick={() => startActivity('ad_watch', 15, 0.05)}
            className="flex items-center gap-4 p-4 rounded-2xl bg-card border-2 border-foreground shadow-pop-sm hover:-translate-y-0.5 transition text-left"
          >
            <div className="w-14 h-14 rounded-2xl bg-accent border-2 border-foreground flex items-center justify-center shrink-0">
              <Eye className="w-7 h-7 text-accent-foreground" />
            </div>
            <div className="flex-1">
              <p className="font-display font-bold text-foreground">Watch Ad</p>
              <p className="text-xs text-muted-foreground">Watch a 15-second ad</p>
            </div>
            <div className="text-right">
              <p className="font-display font-extrabold text-lg text-foreground">$0.05</p>
              <p className="text-[10px] text-muted-foreground">per ad</p>
            </div>
          </button>

          <button
            onClick={() => startActivity('game_play', 10, 1.00)}
            className="flex items-center gap-4 p-4 rounded-2xl bg-card border-2 border-foreground shadow-pop-sm hover:-translate-y-0.5 transition text-left"
          >
            <div className="w-14 h-14 rounded-2xl bg-primary border-2 border-foreground flex items-center justify-center shrink-0">
              <Gamepad2 className="w-7 h-7 text-primary-foreground" />
            </div>
            <div className="flex-1">
              <p className="font-display font-bold text-foreground">Play Game</p>
              <p className="text-xs text-muted-foreground">Play a quick game</p>
            </div>
            <div className="text-right">
              <p className="font-display font-extrabold text-lg text-foreground">$1.00</p>
              <p className="text-[10px] text-muted-foreground">per game</p>
            </div>
          </button>

          <button
            onClick={() => startActivity('app_download', 10, 0.50)}
            className="flex items-center gap-4 p-4 rounded-2xl bg-card border-2 border-foreground shadow-pop-sm hover:-translate-y-0.5 transition text-left"
          >
            <div className="w-14 h-14 rounded-2xl bg-primary border-2 border-foreground flex items-center justify-center shrink-0">
              <Download className="w-7 h-7 text-primary-foreground" />
            </div>
            <div className="flex-1">
              <p className="font-display font-bold text-foreground">Download App</p>
              <p className="text-xs text-muted-foreground">Download a featured app</p>
            </div>
            <div className="text-right">
              <p className="font-display font-extrabold text-lg text-foreground">$0.50</p>
              <p className="text-[10px] text-muted-foreground">per download</p>
            </div>
          </button>
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