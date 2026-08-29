import { useRef, useState } from 'react';
import { FileText, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { productsApi, type ProductDocumentItem } from '../../lib/api';

const MAX_DOCUMENTS = 3;

/** Bytes as something a person reads. Sizes come from the server so nothing has to be fetched. */
const size = (bytes: number | null) => {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Documents a buyer may need before ordering — datasheet, certificate, manual.
 *
 * The name is asked for before the upload, not derived from the filename: "DS-4471-rev-C.pdf" tells
 * a buyer nothing and "Datasheet" tells them everything, and it is the name they will see on the
 * store. Three is the cap — a shelf, not an archive.
 */
export function ProductDocuments({ productId, value, onChange }: {
  productId: string;
  value: ProductDocumentItem[];
  onChange: (next: ProductDocumentItem[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const full = value.length >= MAX_DOCUMENTS;

  const upload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const updated = await productsApi.uploadDocument(productId, file, name.trim());
      onChange(updated.documents);
      setName('');
      toast.success('Document added');
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not upload the document');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async (documentId: string) => {
    try {
      const updated = await productsApi.deleteDocument(productId, documentId);
      onChange(updated.documents);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not remove the document');
    }
  };

  const rename = async (documentId: string, next: string) => {
    const label = next.trim();
    if (!label) return;
    try {
      const updated = await productsApi.renameDocument(productId, documentId, label);
      onChange(updated.documents);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not rename the document');
    }
  };

  return (
    <div>
      <label className="label">Product documents</label>
      <p className="mb-2 text-[12px] text-n-400">
        PDFs a customer may need before ordering — a datasheet, a certificate, a manual. Up to {MAX_DOCUMENTS}.
        They are shown to signed-in customers who can see this product, never published openly.
      </p>

      {value.length > 0 && (
        <div className="mb-2 space-y-1.5">
          {value.map((d) => (
            <div key={d.id} className="flex items-center gap-2 rounded-md border border-n-200 bg-n-0 px-2.5 py-2">
              <FileText size={15} className="shrink-0 text-n-400" />
              {/* Editable in place: the name is the whole point of the row, and renaming it is the
                  most likely thing anyone wants to do to a document already uploaded. */}
              <input
                className="min-w-0 flex-1 bg-transparent text-[13px] text-n-800 outline-none"
                defaultValue={d.name}
                onBlur={(e) => { if (e.target.value.trim() !== d.name) rename(d.id, e.target.value); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              />
              {size(d.sizeBytes) && <span className="mono shrink-0 text-[11.5px] text-n-400">{size(d.sizeBytes)}</span>}
              <button
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-n-400 hover:bg-danger-bg hover:text-danger"
                title="Remove this document"
                onClick={() => remove(d.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {full ? (
        <p className="text-[12.5px] text-n-500">
          {MAX_DOCUMENTS} documents attached — remove one to add another.
        </p>
      ) : (
        <div className="flex items-center gap-2">
          {/* The name comes first: the upload is disabled without it, so a document cannot arrive
              carrying a filename nobody chose. */}
          <input
            className="input h-9 flex-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Document name, e.g. Datasheet"
            maxLength={80}
          />
          <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => upload(e.target.files)} />
          <button
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[13px] font-medium text-n-700 hover:border-teal-300 hover:text-teal-700 disabled:opacity-50"
            disabled={busy || !name.trim()}
            title={!name.trim() ? 'Name the document first' : 'Choose a PDF'}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={15} /> {busy ? 'Uploading…' : 'Add PDF'}
          </button>
        </div>
      )}
    </div>
  );
}
