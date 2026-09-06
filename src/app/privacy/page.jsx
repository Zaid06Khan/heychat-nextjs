/**
 * /privacy — the policy both app stores refuse a listing without.
 *
 * A real App Router route, NOT a screen in the SPA. Two reasons: the store
 * listings need a plain web URL that resolves without a session, and a policy
 * has to stay readable by someone who has deleted their account and can no
 * longer sign in. A more specific segment wins over `[[...slug]]`, so this is
 * served instead of the catch-all mounting the SPA.
 *
 * It is deliberately a server component with no client JavaScript. Nothing here
 * needs state, and a page whose whole subject is "what this app collects about
 * you" should not itself be running anything.
 *
 * ACCURACY IS THE POINT. Every claim below was read out of the schema or a
 * route handler, not assumed from what messaging apps usually say. If you
 * change what the app collects, change this file in the same commit — Play's
 * Data Safety answers and Apple's App Privacy answers are both derived from it,
 * and a policy that disagrees with the app is worse than no policy.
 */

// ---------------------------------------------------------------------------
// The operator, as shown to users and to the stores.
//
// `name` MUST match the developer name on the Play Console account character
// for character. A policy naming one operator and a listing naming another is
// a rejection, and it is the kind that comes back weeks later.
//
// If `name` is ever set back to null the page renders a loud placeholder rather
// than quietly omitting it — a half-filled policy that reads as finished is how
// a wrong name gets shipped.
// ---------------------------------------------------------------------------
const OPERATOR = {
  name: 'Syed Talal Ali',
  email: 'talal.ali@thequreshico.ca',
  lastUpdated: '5 September 2026',
};

const operatorName = OPERATOR.name ?? '[OPERATOR NAME NOT YET SET]';

export const metadata = {
  title: 'Privacy Policy — Calamus3',
  description: 'What Calamus3 collects, where it is stored, and what it does not do.',
};

function Section({ id, title, children }) {
  return (
    <section id={id} className="mb-10 scroll-mt-8">
      <h2 className="text-2xl font-display font-extrabold text-foreground mb-3">{title}</h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

export default function PrivacyPolicy() {
  return (
    <main className="min-h-screen bg-background px-6 py-12">
      <article className="max-w-2xl mx-auto">
        <header className="mb-10 pb-8 border-b-2 border-foreground">
          <h1 className="text-4xl font-display font-extrabold text-foreground mb-2">Privacy Policy</h1>
          <p className="text-sm font-medium text-muted-foreground">
            Calamus3 · Last updated {OPERATOR.lastUpdated}
          </p>
        </header>

        <p className="text-[15px] leading-relaxed text-foreground/90 mb-10">
          Calamus3 is a messaging app operated by {operatorName}. This policy describes what the app
          collects, where that information is stored, who can see it, and how to delete it. It is
          written to be accurate rather than reassuring; where the app does something you might not
          expect, it is stated plainly below.
        </p>

        <Section id="what-you-give-us" title="What you give us">
          <p>
            Creating an account requires a <strong>username</strong>, a <strong>password</strong>,
            and a <strong>recovery password</strong>. That is all. We do not ask for a phone number,
            an email address, a real name, or a date of birth, and there is nowhere in the app to
            provide one.
          </p>
          <p>
            The recovery password is required because there is no email on your account. If you
            forget your password, it is the only way back in — we cannot reset it for you and we
            cannot identify you by any other means.
          </p>
          <p>
            You may optionally add a <strong>display name</strong>, a <strong>profile picture</strong>,
            a short <strong>bio</strong>, and a <strong>country</strong>. Anything you put in these
            is visible to other users.
          </p>
          <p>
            Passwords and recovery passwords are stored only as bcrypt hashes. Nobody, including us,
            can read them back.
          </p>
        </Section>

        <Section id="what-the-app-stores" title="What the app stores as you use it">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>Messages and attachments</strong> you send and receive, along with who sent
              them, which conversation they belong to, when they were sent, and who has read them.
            </li>
            <li>
              <strong>Conversations and group membership</strong> — who is in a conversation, group
              names and cover images, and who administers a group.
            </li>
            <li>
              <strong>Contact requests</strong> you send or receive, and the list of accounts you
              have blocked.
            </li>
            <li>
              <strong>Call records</strong> — who started a call, who was in it, whether it
              connected, and how long it lasted. <em>Not the audio or video</em>, which is never
              recorded and never reaches our servers. See the section on calls below.
            </li>
            <li>
              <strong>Reports</strong> you submit about another user, including the reason and
              anything you write in the description.
            </li>
            <li>
              <strong>Session records.</strong> When you sign in, our authentication provider records
              the session together with the <strong>browser or device description and the IP
              address</strong> it was created from. This is what the device list in Settings shows
              you, and it is there so you can spot a session you do not recognise and sign it out.
            </li>
            <li>
              <strong>Push notification subscriptions</strong>, if you turn notifications on — a
              delivery address issued by your browser or operating system, the encryption keys used
              to secure a notification, and a browser description.
            </li>
          </ul>
          <p>
            Your <strong>IP address</strong> is also used momentarily to rate limit sign-ups and
            sign-in attempts. Those counters live in server memory, are never written to the
            database, and disappear when the server restarts.
          </p>
        </Section>

        <Section id="not-collected" title="What the app does not collect">
          <p>
            There is <strong>no analytics</strong>, no advertising SDK, no tracking pixel, and no
            third-party script of any kind in this app. We do not build a profile of you, we do not
            track you across other apps or websites, and we do not sell or rent your information to
            anyone.
          </p>
          <p>
            There is <strong>no device fingerprinting</strong>. An earlier version of this app
            derived a fingerprint from your browser and hardware; it was removed in August 2026 and
            the stored fingerprints were deleted with it.
          </p>
          <p>
            There are <strong>no ads and no in-app purchases</strong>. The app does not take payment,
            so it holds no payment information at all.
          </p>
          <p>
            Fonts are served from our own servers rather than a font CDN, so simply opening the app
            does not announce you to a third party.
          </p>
        </Section>

        <Section id="encryption" title="Messages are not end-to-end encrypted">
          <p>
            This is the most important thing on this page, so it is not buried:{' '}
            <strong>
              the text of your messages is stored in our database in a form the operator can read.
            </strong>{' '}
            Calamus3 does not currently offer end-to-end encryption for messages.
          </p>
          <p>What that does and does not mean:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              Your messages travel over an encrypted connection (HTTPS) and the database they are
              stored in is encrypted at rest, so they are protected from someone intercepting traffic
              or walking off with a disk.
            </li>
            <li>
              They are <em>not</em> protected from us. Anyone with administrative access to the
              database can read message content. Access is restricted, but the technical ability
              exists.
            </li>
            <li>
              It also means we can be legally compelled to hand message content over. An app with
              end-to-end encryption can honestly say it is unable to comply. We cannot say that, and
              we are not going to imply it.
            </li>
          </ul>
          <p>
            Attachments are stored in a private bucket that is not readable by URL; the app issues
            short-lived signed links to the people in the conversation. The same caveat applies — the
            operator can reach the underlying files.
          </p>
          <p>
            If message content that nobody but the recipient can read is a requirement for you, this
            app does not yet meet it.
          </p>
        </Section>

        <Section id="calls" title="Calls are end-to-end encrypted">
          <p>
            Voice and video calls work differently from messages, and better. Call media travels
            directly between the two devices and is end-to-end encrypted by the browser using
            DTLS-SRTP. It is never recorded, never stored, and never passes through our servers in a
            form anyone could listen to.
          </p>
          <p>
            When a direct connection cannot be established — typically behind restrictive firewalls
            or mobile carrier networks — the call is routed through a relay operated by Cloudflare.
            The relay forwards packets it cannot decrypt. It can see that a call is happening and the
            IP addresses of both ends; it cannot see or hear any part of the call itself.
          </p>
          <p>
            One consequence worth knowing, which is true of every app built on this technology: on a
            direct call, your IP address is visible to the person you are calling, because a direct
            connection is by definition between the two of you.
          </p>
        </Section>

        <Section id="who-else" title="Who else handles your information">
          <p>
            The app runs on three service providers. Each is bound by its own agreement to process
            data only on our instructions.
          </p>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>Supabase</strong> — hosts the database, account authentication, file storage,
              and realtime delivery. Everything described above under &ldquo;what the app
              stores&rdquo; lives here.
            </li>
            <li>
              <strong>Vercel</strong> — hosts the application itself and serves it to your device.
            </li>
            <li>
              <strong>Cloudflare</strong> — provides the call relay described above, used only when a
              direct connection fails.
            </li>
          </ul>
          <p>
            If you enable push notifications, the notification is delivered through the push service
            your browser or operating system provides (for example Google, Apple, or Mozilla).
            Notification content is encrypted to keys held by your device before it is handed over.
          </p>
          <p>
            We may disclose information if we are legally required to, or where we believe in good
            faith that it is necessary to prevent serious harm. Given that message content is
            readable by us, we think you are entitled to know that clearly rather than to find it in
            a footnote.
          </p>
        </Section>

        <Section id="moderation" title="Reports and moderation">
          <p>
            If you report a user, the report — including whatever you write in it and the identity of
            both accounts — is visible to moderators, who can suspend an account. Moderation
            decisions are recorded so there is a record of who did what and when. Do not put anything
            in a report description that you would not want a moderator to read.
          </p>
        </Section>

        <Section id="retention" title="How long things are kept, and deleting your account">
          <p>
            Messages are kept until they are deleted. If a conversation has disappearing messages
            turned on, its messages are removed automatically once their timer expires; the expiry is
            calculated on the server, not by the sending device. Deleting a message clears its text
            and removes its attachment rather than merely hiding it.
          </p>
          <p>
            You can delete your account yourself, at any time, from{' '}
            <strong>Settings &rarr; Delete account permanently</strong>. No email to us, no waiting
            period. Deletion removes your account, your profile, your messages, your one-to-one
            conversations, your contact requests, your call records, your reports, and your
            notification subscriptions. Groups you created are deleted with it.
          </p>
          <p>
            Two honest limits. Deletion cannot reach a copy someone else has already made — a
            screenshot, or a message you sent that someone saved elsewhere. And our database provider
            keeps routine backups for operational recovery, so deleted data can persist in those
            backups for a short period before they age out.
          </p>
        </Section>

        <Section id="your-choices" title="Your choices">
          <p>
            You can change or delete your profile information at any time, review and sign out
            individual devices from Settings, block another user, turn notifications off, and delete
            your account outright. If you want a copy of the information associated with your
            account, or have a question this policy does not answer, write to us at the address
            below.
          </p>
          <p>
            Because accounts carry no email address or phone number, we have no way to verify that
            you are the holder of an account other than your being signed in to it. Requests about a
            specific account may therefore need to be made from within the app.
          </p>
        </Section>

        <Section id="children" title="Children">
          <p>
            Calamus3 is not intended for children under 13, and we do not knowingly collect
            information from them. If you believe a child under 13 has created an account, contact us
            and we will remove it.
          </p>
        </Section>

        <Section id="changes" title="Changes to this policy">
          <p>
            If this policy changes, the date at the top of the page changes with it. Where a change
            materially affects what is collected or who can see it, we will say so in the app rather
            than relying on you to re-read this page.
          </p>
        </Section>

        <Section id="contact" title="Contact">
          <p>
            {operatorName}
            <br />
            <a
              href={`mailto:${OPERATOR.email}`}
              className="font-semibold text-primary underline underline-offset-2"
            >
              {OPERATOR.email}
            </a>
          </p>
        </Section>

        <footer className="pt-8 mt-10 border-t-2 border-foreground">
          <a
            href="/"
            className="inline-block px-6 py-3 rounded-full bg-card border-2 border-foreground text-foreground font-display font-bold shadow-pop-sm hover:-translate-y-0.5 transition"
          >
            Back to Calamus3
          </a>
        </footer>
      </article>
    </main>
  );
}
