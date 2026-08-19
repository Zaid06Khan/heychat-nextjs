# Known issues

What is wrong with Calamus3 right now, in plain language, for people using it
rather than building it.

`FOLLOWUPS.md` is the engineering version — longer, with the reasoning and the
migration numbers. This file is the short honest list, kept because a small
group of real users is about to see the app and should not have to guess which
rough edges are known.

**Last reviewed 2026-08-19.**

---

## Calls fail for some people, and it is not their network's fault

**Roughly 15–20% of connections cannot be made.** A call needs a direct route
between the two phones. On most networks that works. On some — strict office
firewalls, certain mobile carriers, and a NAT arrangement called symmetric NAT —
there is no direct route, and the call needs a relay server in the middle to
forward the audio. **There is no relay yet.**

**What it looks like when it happens:** the call rings, gets as far as
"Connecting…", and then ends with *"The call could not connect"*. The app says
so explicitly rather than blaming you — the message names the missing relay.

**Who it affects:** it is a property of the pair of networks, not of the person.
The same two people may connect fine at home and never at the office. If calls
work for you once, they will usually keep working from that network.

**Why we shipped anyway:** without a relay, those calls fail. *With* the feature
withheld, every call fails. Roughly four out of five connect today, and the
alternative was nobody calling anyone.

**The fix, and it is a known one:** coturn on the existing DigitalOcean droplet.
The app already reads `NEXT_PUBLIC_TURN_URL` / `_USERNAME` / `_CREDENTIAL`, so it
is configuration rather than new code. Blocked on checking which ports are free
on that box.

**Accepted for now**, deliberately, so the app can go in front of real people.

---

## Messages are not end-to-end encrypted

They are encrypted **in transit** — nobody on the wifi can read them — but they
are stored in plain text in the database, and whoever runs the server can read
them. The app says "Encrypted in transit" and means exactly that.

**Calls are different.** WebRTC encrypts audio and video end-to-end between the
two browsers, and that holds even on a relayed call. So a call is private from
the server in a way a message is not.

Doing this properly is a real project with real costs (search stops working,
losing a device means losing history, multi-device needs a key design). The
write-up is `docs/E2E-ENCRYPTION.md`. **Do not describe the app as end-to-end
encrypted anywhere.**

---

## A missed call leaves no trace

If someone calls and you do not answer, there is a push notification and nothing
else. No missed-call entry, no record in the conversation. Dismiss the
notification and the call never happened as far as the app is concerned.

---

## Ringing is not instant if the app is closed

A call reaches a closed app by push notification, which is as fast as the push
service decides to be. Tapping it opens the conversation and the call is still
ringing — the caller rings for 45 seconds.

**On iPhone, notifications only work if the app is on your home screen.** Safari
does not deliver web push to a tab. The app offers instructions the first time
you open it on an iPhone.

---

## Suspension is not instant

If an account is suspended, it cannot sign in again and its saved sessions are
revoked — but a browser that is already open keeps working until its access
token expires, usually within the hour.

---

## Smaller things

- **Group calls do not exist.** The call button is hidden in groups rather than
  present and broken. Group calling needs different infrastructure entirely.
- **You cannot turn the camera on mid-call.** Hang up and call back with the
  video button.
- **Video does not adapt to a weak connection.** No quality ceiling is set, so a
  poor uplink degrades however the browser decides.
- **Leaving the tab hides the video** but keeps the call and the audio running.
- **Muted conversations still count toward the unread badge.**
- **Ten languages have never been checked by a native speaker.**
- **Nothing works offline.** The app needs a connection; there is no cached
  view of past messages.

---

## Reporting something not on this list

Use the flag icon in a conversation. Reports go to a queue a moderator actually
reads — as of 2026-08-19 there is one, which is new. Suspension, dismissal and
"reviewed, no action" are the available outcomes, and every decision is
recorded.
