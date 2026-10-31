import type { ImgHTMLAttributes } from "react";

/**
 * One of the site's drawings (public/clindesk/*.svg, a few kB each). A plain <img>: next/image adds nothing for
 * vector files. Decorative unless the caller gives an alt text; below 480 px most sit in a `.deco` box the CSS hides.
 */
export function Drawing({ alt = "", ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} {...props} />;
}
