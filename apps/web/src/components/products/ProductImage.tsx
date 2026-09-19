import { Package } from 'lucide-react';

/**
 * A product image, drawn the same way everywhere: a square, the whole image visible, and the same
 * margin of background on all four sides.
 *
 * Images arrive as uploaded, not prepared. The platform standard is square, but a landscape bag or a
 * portrait mop goes in as it is, and with `object-cover` in a fixed box one was cropped, and in a box
 * without a fixed height it set the card's height, so grid cards were all different heights. Here
 * the box is always square, the image is scaled down to fit inside it (`object-contain`), and the
 * padding is a percentage of the box, so a 32px thumbnail and a grid card keep the same proportions.
 *
 * Size, rounding and border come from `className`; give it a width (`w-10`, `w-full`), and the height
 * follows.
 */
export function ProductImage({
  src,
  alt = '',
  className = '',
  iconSize = 18,
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  iconSize?: number;
}) {
  return (
    <div className={`relative aspect-square shrink-0 overflow-hidden bg-n-0 ${className}`}>
      {src ? (
        // Padding on an absolutely placed box is a share of the square's width, so all four sides match.
        <img src={src} alt={alt} loading="lazy" draggable={false} className="absolute inset-0 h-full w-full object-contain p-[8%]" />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-n-50 text-n-300">
          <Package size={iconSize} strokeWidth={1.5} />
        </div>
      )}
    </div>
  );
}
