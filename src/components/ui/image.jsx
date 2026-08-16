import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * A plain <img>, with a fallback that does not phone home.
 *
 * This file used to be 244 lines of Wix Media Platform machinery inherited from
 * Base44: it detected `media.base44.com` / `static.wixstatic.com` URLs and
 * rebuilt them as `/v1/fill/w_,h_,q_,enc_webp/…` transform URLs, with a blurred
 * 20px placeholder, a container-measuring hook and a device-pixel-ratio srcset.
 *
 * ALL OF IT WAS ALREADY DEAD. Media moved into a private Supabase bucket in
 * 0006 and is fetched through a signed URL on the Supabase host, so
 * `parseWixMediaUrl()` returned null for every image the app actually renders
 * and both call sites had been falling through to a bare <img> for months.
 *
 * The one part still running was the worst part: `onError` swapped the source
 * to a hardcoded `static.wixstatic.com` image, so a broken attachment in a
 * privacy-first messenger made a request to a third-party CDN — announcing to
 * Wix that someone using this app had failed to load an image. That is the
 * whole reason this was worth deleting rather than leaving alone.
 *
 * The prop surface is unchanged so the two call sites did not have to move.
 * `fittingType` maps onto object-fit, which is what it always meant.
 */
const Image = React.forwardRef(
  (
    {
      src,
      alt,
      className,
      style,
      fittingType = "fill",
      // Accepted and ignored: the Wix transform pipeline is gone, and these only
      // ever configured it. Kept in the signature so a stray prop at a call site
      // lands here instead of being spread onto the DOM as an unknown attribute.
      originWidth,
      originHeight,
      focalPointX,
      focalPointY,
      quality,
      ...props
    },
    ref
  ) => {
    const [failed, setFailed] = React.useState(false)

    React.useEffect(() => {
      setFailed(false)
    }, [src])

    // No src, or a load that failed: an inert box holding the same space. It
    // makes no request at all, which is the point — and callers like Avatar
    // already draw their own placeholder when they have nothing to show.
    if (!src || failed) {
      return (
        <span
          ref={ref}
          aria-hidden="true"
          className={cn("inline-block bg-secondary", className)}
          style={style}
          data-empty-image
        />
      )
    }

    return (
      <img
        ref={ref}
        src={src}
        alt={alt}
        loading="lazy"
        className={className}
        style={{ objectFit: fittingType === "fit" ? "contain" : "cover", ...style }}
        onError={() => setFailed(true)}
        {...props}
      />
    )
  }
)
Image.displayName = "Image"

export { Image }
