import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { availabilityApi, type Product } from '../../lib/api';
import { ProductSkuField } from '../sales/ProductSkuField';

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

/**
 * Put a product into availability by name, without it being listed anywhere first.
 *
 * Every other route in depended on the product already existing somewhere else: the onboarding
 * worklist is built from channel listings, so a product listed on no channel could never appear on
 * it. That made the ordinary case impossible — create a product, want to stock it, want to list it —
 * because availability was the step you could not reach until after the step that needed it.
 *
 * Nothing new on the server. `POST /availability/:productId` already upserts, so this is the screen
 * that was missing rather than the capability.
 */
export function AddToAvailabilityModal({ onClose, onAdded }: Props) {
  const [picked, setPicked] = useState<{ productId: string | null; sku: string }>({ productId: null, sku: '' });
  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState('0');

  const qty = Number(quantity);
  const qtyValid = Number.isFinite(qty) && qty >= 0 && Number.isInteger(qty);

  const add = useMutation({
    mutationFn: () => availabilityApi.setQuantity(picked.productId!, qty, 'Added to availability by hand'),
    onSuccess: () => {
      // The product's own SKU, not the one typed: a product can be picked by an alias, and the
      // toast should name the thing that is now in availability.
      toast.success(`${product?.mainSku ?? picked.sku} added to availability${qty > 0 ? ` with ${qty}` : ''}`);
      onAdded();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not add the product'),
  });

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(12,16,20,0.5)] p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !add.isPending) onClose(); }}
    >
      <div className="flex w-[460px] max-w-full flex-col rounded-lg bg-n-0 shadow-lg">
        <div className="border-b border-n-200 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-n-900">Add a product to availability</h2>
          <p className="mt-0.5 text-[12.5px] text-n-500">
            Any product in the catalogue, whether or not it is listed on a channel yet.
          </p>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <div>
            <label className="mb-1 block text-[12px] font-semibold text-n-600">Product</label>
            <ProductSkuField
              value={picked}
              onChange={(v) => { setPicked(v); if (!v.productId) setProduct(null); }}
              onPick={setProduct}
              autoSelectExact
            />
            {product && (
              <p className="mt-1.5 truncate text-[12px] text-n-500" title={product.title ?? undefined}>{product.title}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-[12px] font-semibold text-n-600">Sellable quantity</label>
            <input
              className="input mono w-32"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="numeric"
            />
            {/*
              Zero is a real and useful answer, so it is the default.
              It puts the product under management — visible, pushable, ready for a count — without
              claiming stock nobody has verified. A figure typed here is one somebody stands behind,
              and it goes to the channels as sellable.
            */}
            <p className="mt-1.5 text-[12px] text-n-500">
              Zero adds the product without claiming stock. Whatever you enter is what the channels
              will be told is sellable.
            </p>
            {!qtyValid && <p className="mt-1 text-[12px] text-danger">Enter a whole number, zero or more.</p>}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-n-200 px-5 py-3.5">
          <button
            className="inline-flex h-10 items-center rounded-md border border-n-200 bg-n-0 px-4 text-[13.5px] font-semibold text-n-700 hover:bg-n-50"
            onClick={() => !add.isPending && onClose()}
          >
            Cancel
          </button>
          <button
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-[13.5px] font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
            disabled={!picked.productId || !qtyValid || add.isPending}
            onClick={() => add.mutate()}
          >
            {add.isPending && <Loader2 size={14} className="animate-spin" />}
            {add.isPending ? 'Adding…' : 'Add to availability'}
          </button>
        </div>
      </div>
    </div>
  );
}
