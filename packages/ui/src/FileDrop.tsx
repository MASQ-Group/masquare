import { useCallback, useRef, useState, type ReactNode } from 'react';
import { cn } from './cn';

export interface FileDropProps {
  /** Called with the chosen file(s). Single-file callers get the first. */
  onFiles: (files: File[]) => void;
  /** `accept` for the hidden input, e.g. ".csv,.xls,.xlsx". Also enforced on drop. */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  className?: string;
  /** Content of the target. Receives whether a file is currently hovering over it. */
  children: ReactNode | ((state: { dragging: boolean }) => ReactNode);
}

/**
 * Click-or-drop file target.
 *
 * Every upload in the platform accepts a dropped file, not only a browsed one — dragging is what
 * people reach for first with a file already open in a folder, and a target that silently ignores
 * a drop reads as broken rather than unsupported.
 *
 * Drag state is tracked with a counter, not a boolean: dragenter/dragleave fire for every child
 * element the pointer crosses, so a boolean flickers off the moment the cursor moves over the
 * label inside the zone.
 */
export function FileDrop({ onFiles, accept, multiple, disabled, className, children }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  /** Honour `accept` on drop too — the browser only applies it to the file picker. */
  const filterAccepted = useCallback(
    (files: File[]) => {
      if (!accept) return files;
      const rules = accept.split(',').map((r) => r.trim().toLowerCase()).filter(Boolean);
      if (!rules.length) return files;
      return files.filter((f) => {
        const name = f.name.toLowerCase();
        const type = f.type.toLowerCase();
        return rules.some((r) =>
          r.startsWith('.') ? name.endsWith(r)
          : r.endsWith('/*') ? type.startsWith(r.slice(0, -1))
          : type === r,
        );
      });
    },
    [accept],
  );

  const deliver = (list: FileList | null) => {
    if (!list?.length) return;
    const accepted = filterAccepted([...list]);
    if (accepted.length) onFiles(multiple ? accepted : [accepted[0]]);
  };

  const reset = () => { depth.current = 0; setDragging(false); };

  return (
    <div
      onDragEnter={(e) => {
        if (disabled) return;
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => { if (!disabled) e.preventDefault(); }}
      onDragLeave={(e) => {
        if (disabled) return;
        e.preventDefault();
        depth.current -= 1;
        if (depth.current <= 0) reset();
      }}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        reset();
        deliver(e.dataTransfer?.files ?? null);
      }}
      onClick={() => { if (!disabled) inputRef.current?.click(); }}
      className={cn(disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer', className)}
    >
      {typeof children === 'function' ? children({ dragging }) : children}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          deliver(e.target.files);
          // Allow re-picking the same file straight after (onChange would not fire otherwise).
          e.target.value = '';
        }}
      />
    </div>
  );
}
