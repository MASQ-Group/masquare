import { useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { toast } from 'sonner';
import { integrationsApi } from '../../lib/api';

interface Props {
  /** Connector type key (amazon / ebay / onbuy) — the logo is stored against this. */
  channelType: string;
  /** Display name, used for the monogram fallback and alt text. */
  label: string;
  /** Current logo URL, or undefined when none is set. */
  url?: string;
  /** Called after a successful upload or removal so the page can refetch. */
  onChanged: () => void;
}

/** Fallback tints for the monogram when no logo is set. Keyed by channel type;
 *  anything unmapped falls back to a neutral chip. */
const BRAND: Record<string, { bg: string; color: string }> = {
  amazon: { bg: '#232F3E', color: '#FF9900' },
  ebay: { bg: '#EEF3FB', color: '#2C6ED5' },
  onbuy: { bg: '#F4ECFB', color: '#7A3FBF' },
};

const ACCEPT = '.png,.jpg,.jpeg,.webp,.svg,image/*';
const MAX_BYTES = 1_000_000;

/** The 36px logo tile shown at the left of an integration group header. Click to
 *  set or replace the brand logo; a logo can be removed on hover. */
export function ChannelLogoTile({ channelType, label, url, onChanged }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const brand = BRAND[channelType] ?? { bg: '#EEF1F0', color: '#3B4642' };
  const mono = (label || channelType).charAt(0).toUpperCase();

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be re-picked after a failed attempt
    if (!file) return;
    if (!/\.(png|jpe?g|webp|svg)$/i.test(file.name)) { toast.error('Logo must be a PNG, JPG, WEBP or SVG image'); return; }
    if (file.size > MAX_BYTES) { toast.error('Logo must be 1 MB or smaller'); return; }
    setBusy(true);
    try {
      await integrationsApi.uploadChannelLogo(channelType, file);
      toast.success(`${label} logo updated`);
      onChanged();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Could not upload logo');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await integrationsApi.removeChannelLogo(channelType);
      toast.success(`${label} logo removed`);
      onChanged();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Could not remove logo');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="group/logo relative shrink-0">
      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        title={url ? `Replace ${label} logo` : `Add ${label} logo`}
        className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-lg border border-n-200 bg-n-0 disabled:opacity-60"
      >
        {url ? (
          <img src={url} alt={`${label} logo`} className="h-full w-full object-contain p-1" />
        ) : (
          <span className="grid h-full w-full place-items-center text-[14px] font-bold" style={{ background: brand.bg, color: brand.color }}>
            {mono}
          </span>
        )}
        {/* Hover overlay signals the tile is editable. */}
        <span className="absolute inset-0 hidden place-items-center bg-black/45 text-white group-hover/logo:grid">
          <Camera size={14} />
        </span>
      </button>

      {url && (
        <button
          type="button"
          disabled={busy}
          onClick={remove}
          title="Remove logo"
          className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 place-items-center rounded-full border border-n-200 bg-n-0 text-n-500 shadow-sm hover:border-danger-bd hover:bg-danger-bg hover:text-danger group-hover/logo:grid"
        >
          <X size={11} />
        </button>
      )}

      <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={onPick} />
    </div>
  );
}
