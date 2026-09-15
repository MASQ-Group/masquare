import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { settingsApi } from '../../lib/api';
import { refreshFavicon } from '../../lib/favicon';
import { SectionHeader } from './shared';

/**
 * The icon in the browser tab, for every user and on the sign-in page.
 *
 * A square image reads best: it is drawn at 16–32 px, where anything detailed turns to a smudge.
 * ICO, PNG and SVG are the formats every browser handles; WEBP and JPG work in current ones.
 */
export function FaviconCard({ readOnly }: { readOnly: boolean }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const { data } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const url = data?.faviconUrl ?? null;

  const upload = useMutation({
    mutationFn: (file: File) => settingsApi.uploadFavicon(file),
    onSuccess: () => {
      toast.success('Browser icon updated');
      qc.invalidateQueries({ queryKey: ['settings'] });
      refreshFavicon(true);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not upload the icon'),
  });
  const remove = useMutation({
    mutationFn: () => settingsApi.removeFavicon(),
    onSuccess: () => {
      toast.success('Browser icon removed');
      qc.invalidateQueries({ queryKey: ['settings'] });
      refreshFavicon(false);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not remove the icon'),
  });

  const busy = upload.isPending || remove.isPending;

  return (
    <div className="mt-6">
      <SectionHeader title="Browser icon" description="The favicon shown in the browser tab, for everyone and on the sign-in page." />
      <div className="card flex flex-wrap items-center gap-4 p-5">
        {/* Shown at the size a tab draws it, and larger, so a detail that vanishes at 16 px is visible here first. */}
        <div className="flex items-end gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-md border border-n-200 bg-n-25">
            {url ? <img src={url} alt="Current browser icon" className="h-8 w-8 object-contain" /> : <span className="text-[11px] text-n-400">None</span>}
          </div>
          {url && (
            <div className="grid h-6 w-6 place-items-center rounded border border-n-200 bg-n-0" title="At tab size">
              <img src={url} alt="" className="h-4 w-4 object-contain" />
            </div>
          )}
        </div>

        <div className="flex min-w-[200px] flex-1 flex-col gap-1">
          <span className="text-[12.5px] text-n-600">
            {url ? 'Replace it with a new image, or remove it to use the browser’s default.' : 'No icon set — browsers show their default.'}
          </span>
          <span className="text-[11.5px] text-n-400">Square ICO, PNG or SVG works best. 500 KB at most.</span>
        </div>

        <div className="flex gap-2">
          <input
            ref={input}
            type="file"
            accept=".ico,.png,.svg,.webp,.jpg,.jpeg,image/x-icon,image/png,image/svg+xml,image/webp,image/jpeg"
            className="hidden"
            aria-label="Choose a browser icon"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }}
          />
          <button type="button" className="hbtn" disabled={readOnly || busy} onClick={() => input.current?.click()}>
            {upload.isPending ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />} {url ? 'Replace' : 'Upload icon'}
          </button>
          {url && (
            <button type="button" className="hbtn" disabled={readOnly || busy} onClick={() => remove.mutate()}>
              {remove.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
