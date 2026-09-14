import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { ebayListingApi } from '../../lib/api';

/**
 * The finished eBay description, exactly as it would be sent.
 *
 * Not a mock-up: this is the same HTML the publish would carry, taken from the preview the server
 * already builds. Anything else would be a second renderer to keep in step with the first, and the
 * one it disagreed with would be the one nobody was looking at.
 *
 * Shown in an iframe, and that is a safety decision rather than a layout one. The description is
 * rendered from researched text, and dropping it into this page with `dangerouslySetInnerHTML` would
 * let it inherit — or reach — the platform's own styles and scripts. A sandboxed frame renders it
 * the way eBay will: isolated, with nothing allowed to run.
 */
export function EbayDescriptionPreview({ productId }: { productId: string }) {
  const [open, setOpen] = useState(false);

  const preview = useQuery({
    queryKey: ['ebay', 'preview', productId],
    queryFn: () => ebayListingApi.preview(productId),
    enabled: open,
  });

  const html = preview.data?.inventoryItem?.product?.description ?? '';

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 self-start text-[12px] font-semibold text-n-600 hover:text-n-800"
      >
        {open ? <EyeOff size={12} /> : <Eye size={12} />}
        {open ? 'Hide' : 'Preview'} the eBay description
      </button>

      {open && (
        preview.isLoading ? (
          <span className="flex items-center gap-1.5 text-[12px] text-n-500">
            <Loader2 size={12} className="animate-spin" /> Building it…
          </span>
        ) : html ? (
          <div className="overflow-hidden rounded-lg border border-n-200 bg-n-0">
            <iframe
              title="eBay description preview"
              // No scripts, no forms, no navigation: it is a picture of the listing, not a page.
              sandbox=""
              srcDoc={html}
              className="h-[420px] w-full border-0"
            />
          </div>
        ) : (
          <p className="text-[12px] text-n-500">
            Nothing to show yet — write the description above, or have Claude write it.
          </p>
        )
      )}
    </div>
  );
}
