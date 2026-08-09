/**
 * Generates a VAPID keypair for Web Push and prints it as .env.local lines.
 *
 *     npm run push:keys
 *
 * Run this ONCE per deployment and keep the result. Regenerating invalidates
 * every existing subscription: browsers bind a subscription to the public key
 * that created it, so after a rotation the push service rejects sends to every
 * endpoint you already have and every user silently stops getting
 * notifications until their next app start re-subscribes them.
 *
 * The public key is compiled into the browser bundle, which is fine and
 * unavoidable — the subscribing client hands it to the push service by design.
 * The private key signs the requests that prove a notification came from this
 * app, and belongs only in the server's environment.
 */
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`
Add these to .env.local (and to your host's environment for production):

NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:you@example.com

Keep VAPID_PRIVATE_KEY out of git and out of the browser -- never prefix it
with NEXT_PUBLIC_. Regenerating these keys unsubscribes every existing device.
`);
