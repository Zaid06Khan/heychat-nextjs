'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

/**
 * A QR code drawn on this device.
 *
 * REPLACES A THIRD-PARTY IMAGE REQUEST. This used to be an `<img>` pointing at
 * `api.qrserver.com` with the username in the query string — which told goQR.me
 * which username was on this device, and the IP it came from, every time
 * somebody opened their own profile.
 *
 * For an app whose promise is "no phone number, no email, just a username", the
 * username IS the identifier. It was the one piece of identity leaving for a
 * company with no other role here, and the only external host in the app apart
 * from a STUN server. Generating locally removes it outright rather than
 * disclosing it.
 *
 * Rendered to a <canvas> rather than an <img> with a data URI so nothing ever
 * becomes a URL that could be logged, shared or cached by accident.
 */
export default function QrCanvas({ value, size = 192, className = '' }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !value) return;

    let cancelled = false;
    QRCode.toCanvas(canvas, String(value), {
      width: size,
      margin: 1,
      // Fixed black on white. A QR code is read by a camera, not by a person,
      // and theming one is how you get an unscannable code on a dark phone.
      color: { dark: '#000000', light: '#FFFFFF' },
      errorCorrectionLevel: 'M',
    })
      .then(() => { if (!cancelled) setFailed(false); })
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => { cancelled = true; };
  }, [value, size]);

  if (failed) {
    return (
      <p className="text-sm text-muted-foreground" style={{ width: size }}>
        Could not draw a QR code. Your username is still shown below.
      </p>
    );
  }

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      role="img"
      aria-label={`QR code for @${value}`}
      className={className}
      style={{ width: size, height: size }}
    />
  );
}
