# End-to-end encryption — what it would actually cost here

**Status: a plan, not a commitment. No code has been written.**
Written 2026-08-16, for FOLLOWUPS §3.

This is deliberately specific to HeyChat as it stands today. Generic E2E advice
is easy to find and useless for deciding; what follows is which of *this app's*
existing features stop working, which decisions have to be made by a person
rather than by a library, and what the honest staging looks like.

---

## 1. Where things actually stand

**Today's claim is "Encrypted in transit", and that is true.** TLS protects the
wire. `messages.content` is then stored as ordinary text in Postgres, and the
server can read every message. RLS decides *who may read what* — that is access
control, and it is not encryption. A stolen database, a compromised server, or
anyone with the `service_role` key reads everything.

The UI used to claim end-to-end encryption. That claim was removed because it
was false. **The single most important thing in this document is: do not
reintroduce a claim the product cannot keep.** "As encrypted as possible" is a
reasonable instinct and a dangerous specification, because the natural result is
something that *sounds* end-to-end in the interface and is not.

### Two things people mean by "encrypt the messages"

| | Protects against | Cost | Is it E2E? |
|---|---|---|---|
| **At-rest encryption** with a server-held key | a stolen database dump or backup | low | **No.** The server still reads everything. |
| **End-to-end** with device-held keys | the server, the host, the database, us | high | Yes |

These are not steps on the same ladder. At-rest encryption is worth maybe a day
and is genuinely useful against one specific threat, but if it ships alongside
the word "encrypted" in the UI it will be read as the second thing. If it is
done, it should be described as exactly what it is.

---

## 2. What breaks, feature by feature

This is the part that decides whether the project is worth starting. Everything
below is something HeyChat already does.

### 2.1 Push notification previews — the biggest one

`/api/messages` writes the message and then calls `notifyForMessage()`, which
composes the notification text **server-side from the stored row**. With E2E the
server cannot read it, so it cannot write "Priya: are we still on for Thursday?"
onto a lock screen.

Options, all of them worse than today:

- **Always "New message".** Simple and honest. Note this makes the existing
  `hide_notification_preview` setting meaningless — it becomes the only
  behaviour, so a feature already built gets deleted.
- **Decrypt in the service worker.** Technically possible: the SW would read
  keys from IndexedDB. It means the message keys are reachable by any code
  running in that origin's worker context, and the SW has to handle a locked or
  never-unlocked state. Real messengers do this; it is not free.

Note that push is *already* the most fragile part of the app (§10), and this
makes it more so.

### 2.2 The conversation list preview

`last_messages_for_conversations()` (0011) exists precisely so the sidebar can
show the last message in one round trip instead of N+1. It returns `content`.
Under E2E that is ciphertext, so the list cannot render a preview until the
client has loaded keys and decrypted one message per conversation. The RPC still
earns its keep — it is still one round trip — but the list gains a decryption
pass and a "keys not ready yet" state.

### 2.3 Multi-device — and this is the expensive part

**This got harder eight days ago, not easier.** Device binding was removed on
2026-08-16 (§6), so an account can now legitimately be on a laptop and a phone
at once. Before that, one account was one device and E2E would have needed only
one key per account.

Now it needs:

- a per-**device** identity key, not per-account;
- a device list that is *cryptographically* meaningful, not just informational —
  adding a device means other devices must start encrypting to it, and revoking
  one must stop that. The Settings device list (0018) currently lists GoTrue
  sessions; it would have to become the key directory too, and the two must not
  disagree;
- **sender keys** for groups, rotated on every membership change — which means
  `group_invite_respond()` and `group_remove_member()` (0019, 0015) become
  crypto operations as well as membership operations;
- a decision about **history on a new device**: by default it cannot read
  anything sent before it existed. Either accept that, or build encrypted
  history transfer between devices.

### 2.4 Key backup, with no email

There is no email on an account. Since 0022 the recovery password is mandatory
and is the only way back into an account.

If keys live only on the device, **losing the device loses every message**, and
the recovery password gets you back into an account whose history is
permanently unreadable. Most people will consider that a bug regardless of what
the documentation says.

The standard answer is an encrypted key backup on the server, unlocked by a
secret only the user has. The recovery password is the obvious candidate and the
timing is convenient — it is now guaranteed to exist. The consequences:

- the strength of every backup is the strength of a user-chosen password;
- the current rule is "at least 8 characters" (`validatePassword`), which is far
  too weak to be the root of a key hierarchy, so that rule would have to change;
- the server holds the encrypted blob, so an offline attack on it is possible if
  the database leaks. This is the same trade WhatsApp and Signal make, and both
  push people toward long random recovery codes rather than passwords.

### 2.5 Report and moderation

`ReportDialog` sends a reason to a `reports` table for "the HeyChat team" to
review. With E2E there is nothing readable to review. Every E2E messenger has
this problem and none has solved it well. The realistic options:

- the reporter's client attaches the plaintext it saw (forgeable by the
  reporter — they can report anything as anything);
- reports carry no content, and moderation becomes account-level only;
- drop the moderation promise and say so.

**This is a product decision, not a cryptographic one**, and it should be made
before any code is written rather than discovered afterwards.

### 2.6 Edit history

`message_edits.previous_content` (0020) becomes ciphertext. That is fine — but
each prior version needs its own decryption, and the message key for an edited
message must remain available for as long as its history does.

### 2.7 Things that are genuinely unaffected

- **Disappearing messages** (0010). The sweep deletes rows without reading them.
- **Search.** There is none, so nothing is lost. Worth noting because "E2E kills
  search" is the usual objection and it does not apply here — but it does mean
  search can never be added server-side later.
- **Unread counts** (0014). Counts rows, does not read bodies.
- **Delete for me / delete chat** (0016, 0023). Both operate on ids and
  timestamps.
- **Media.** Attachments are already private objects behind signed URLs (0006).
  They would additionally be encrypted client-side with a key carried in the
  message — an addition, not a rework.

---

## 3. What to use

**libsignal** (X3DH + Double Ratchet) or **MLS** (RFC 9420). Do not hand-roll a
protocol, and do not assemble one out of WebCrypto primitives because the parts
look simple. The failure mode of a hand-rolled protocol is that it looks like it
works.

- **libsignal** — battle-tested, the direct-message story is excellent, group
  support is sender-keys and workable. The JS/WASM story is less polished than
  the mobile ones.
- **MLS** — designed for groups from the start, better asymptotics for large
  groups, younger ecosystem.

For a messenger whose groups cap at 256 members (0019), **libsignal is the
sensible default**.

---

## 4. Staging, if it goes ahead

Ordered so that each stage is independently shippable and the expensive
decisions come first.

**Stage 0 — decide, write nothing.** Three answers needed, all of them
product decisions: what happens to push previews; what happens to Report; and
whether losing your last device is allowed to lose your history. Nothing below
can be scoped until these are settled.

**Stage 1 — identity and keys.** Per-device keypairs, prekey bundles on the
server, the device list becomes the key directory. No message is encrypted yet.
This is where multi-device (§6) gets paid for.

**Stage 2 — direct messages, text only.** Double Ratchet between two devices.
`messages.content` becomes ciphertext. The conversation list and push previews
both change here; this is the stage where the app visibly gets worse before it
gets better.

**Stage 3 — attachments.** Encrypt the blob client-side, carry the key in the
message. Existing signed-URL plumbing stays.

**Stage 4 — groups.** Sender keys, rotation wired into the membership functions.

**Stage 5 — key backup**, using whatever Stage 0 decided about device loss.

---

## 5. Recommendation

**Do it before there are users, or accept never doing it.**

Right now the app has one real account. Every message in the database is
plaintext, and there is no migration story for turning existing plaintext
history into ciphertext that anyone can read — you either abandon the history or
keep a plaintext era forever. That cost only grows. Deploying first and
encrypting later is the more expensive order, and it is the order that usually
ends with it never happening.

Against that: this is a multi-week project that touches push, the conversation
list, groups, moderation and account recovery — most of what has been built in
the last week — and it is the kind of work where "nearly finished" is worth
nothing.

**So the real question is not technical.** It is whether HeyChat is a product
whose point is privacy, or a messenger that is privately hosted. If the first,
E2E is not a feature to add later; it is the thing, and Stage 0 should start now.
If the second, then say "encrypted in transit, stored on our own server", which
is true, defensible, and much cheaper — and stop there deliberately rather than
by drift.

**Until that is decided, the honest position is the current one.** The UI says
"Encrypted in transit". Leave it saying exactly that.
