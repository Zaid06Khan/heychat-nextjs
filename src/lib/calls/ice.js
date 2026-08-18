'use client';

/**
 * Where the browser looks to find a route to the other person.
 *
 * TWO KINDS OF SERVER, and the difference is the whole cost story.
 *
 * STUN just tells a browser what its own public address looks like from
 * outside. It handles no media, costs essentially nothing, and Google runs a
 * free one that everybody uses. For most pairs of people that is enough: they
 * discover each other's addresses and connect directly.
 *
 * TURN *relays the audio* when a direct connection is impossible — symmetric
 * NAT, strict corporate firewalls, some mobile carriers. Roughly 15-20% of
 * connections need it, and because it carries the media it costs bandwidth for
 * as long as the call lasts. That is why it is self-hosted here rather than
 * bought per-minute.
 *
 * DELIBERATELY OPTIONAL. With no TURN configured, calls still work for the
 * majority who can connect directly — they simply fail for the minority who
 * cannot, rather than failing for everyone. That is what makes it possible to
 * build and test this before the relay exists.
 */

const STUN_ONLY = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * @returns {RTCConfiguration}
 */
export function getIceConfig() {
  const url = process.env.NEXT_PUBLIC_TURN_URL;
  const username = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const credential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

  if (!url || !username || !credential) {
    return { iceServers: STUN_ONLY };
  }

  return {
    iceServers: [
      ...STUN_ONLY,
      // Both transports. UDP is what you want; TCP/443 is what gets through a
      // firewall that blocks everything else, which is precisely the network
      // where a relay was needed in the first place.
      { urls: url, username, credential },
    ],
  };
}

/** Whether a relay is configured, for honest UI when a call cannot connect. */
export function hasTurn() {
  return Boolean(
    process.env.NEXT_PUBLIC_TURN_URL &&
      process.env.NEXT_PUBLIC_TURN_USERNAME &&
      process.env.NEXT_PUBLIC_TURN_CREDENTIAL
  );
}
