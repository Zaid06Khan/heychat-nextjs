import { PhoneMissed, PhoneOutgoing, PhoneIncoming } from 'lucide-react';

/**
 * A call, in the conversation, after the fact.
 *
 * A missed call used to leave nothing behind: a push notification, and once
 * that was dismissed the call had never happened as far as the app was
 * concerned. FOLLOWUPS §1.
 *
 * A CENTRED LINE, NOT A BUBBLE. A call is not something either person said, and
 * dressing it as a message means inheriting replies, reactions, editing and
 * delete-for-everyone — none of which mean anything for a call, and all of
 * which MessageBubble would offer.
 *
 * "Missed" is derived rather than stored: `started_at` is only set once media
 * actually flows, so a call that ended without one never connected. That is
 * also why this needed no migration.
 */
function duration(startedAt, endedAt) {
  const secs = Math.max(0, Math.round((new Date(endedAt) - new Date(startedAt)) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function CallRecord({ call, isOwn }) {
  const connected = Boolean(call.started_at);
  const time = new Date(call.created_date).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const Icon = !connected ? PhoneMissed : isOwn ? PhoneOutgoing : PhoneIncoming;

  // Wording follows who placed it, because "missed call" from the caller's own
  // side would be wrong — they did not miss it, it went unanswered.
  const label = !connected
    ? isOwn
      ? 'No answer'
      : 'Missed call'
    : `Call · ${duration(call.started_at, call.ended_at || call.created_date)}`;

  return (
    <div className="flex justify-center my-2">
      <div
        className={`flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full border-2 border-foreground bg-card ${
          connected ? 'text-muted-foreground' : 'text-destructive'
        }`}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
        <span className="text-muted-foreground font-normal tabular-nums">{time}</span>
      </div>
    </div>
  );
}
