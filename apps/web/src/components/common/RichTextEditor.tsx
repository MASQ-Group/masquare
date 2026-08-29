import { useEffect, useRef, useState } from 'react';
import { Bold, Code, Italic, Link2, List, ListOrdered, Underline } from 'lucide-react';

/**
 * A small rich text editor over HTML, with a source view.
 *
 * The stored value is HTML because that is what the marketplaces and the store both consume — this
 * edits it directly rather than through an intermediate format that would have to be converted
 * twice and would quietly drop anything it did not model.
 *
 * The source toggle is not a power-user extra. Copy arrives from suppliers as HTML, and an editor
 * that cannot be opened up leaves someone hand-fixing markup they cannot see.
 *
 * Deliberately no library: two fields do not justify a dependency, and the ones worth having are
 * larger than this whole editor.
 */
export function RichTextEditor({ value, onChange, placeholder, minHeight = 140 }: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState(false);

  // Only write into the DOM when the value differs from what is already there. Assigning innerHTML
  // on every keystroke would move the caret to the start on each character typed.
  useEffect(() => {
    if (source || !ref.current) return;
    if (ref.current.innerHTML !== value) ref.current.innerHTML = value ?? '';
  }, [value, source]);

  const exec = (command: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    onChange(ref.current?.innerHTML ?? '');
  };

  const addLink = () => {
    const url = window.prompt('Link URL');
    if (url) exec('createLink', url);
  };

  const Btn = ({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()} // keep the selection while the button takes focus
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded text-n-500 hover:bg-n-100 hover:text-n-800"
    >
      {children}
    </button>
  );

  return (
    <div className="overflow-hidden rounded-md border border-n-200 bg-n-0 focus-within:border-teal-300">
      <div className="flex items-center gap-0.5 border-b border-n-100 bg-n-25 px-1.5 py-1">
        {!source && (
          <>
            <Btn title="Bold" onClick={() => exec('bold')}><Bold size={14} /></Btn>
            <Btn title="Italic" onClick={() => exec('italic')}><Italic size={14} /></Btn>
            <Btn title="Underline" onClick={() => exec('underline')}><Underline size={14} /></Btn>
            <span className="mx-1 h-4 w-px bg-n-200" />
            <Btn title="Bulleted list" onClick={() => exec('insertUnorderedList')}><List size={14} /></Btn>
            <Btn title="Numbered list" onClick={() => exec('insertOrderedList')}><ListOrdered size={14} /></Btn>
            <Btn title="Add link" onClick={addLink}><Link2 size={14} /></Btn>
          </>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setSource((v) => !v)}
          title={source ? 'Back to the formatted view' : 'Edit the HTML directly'}
          className={`inline-flex h-7 items-center gap-1.5 rounded px-2 text-[12px] font-medium ${source ? 'bg-n-100 text-n-800' : 'text-n-500 hover:bg-n-100 hover:text-n-800'}`}
        >
          <Code size={14} /> HTML
        </button>
      </div>

      {source ? (
        <textarea
          className="mono block w-full resize-y border-0 px-3 py-2.5 text-[12.5px] leading-[1.6] text-n-800 outline-none"
          style={{ minHeight }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="<p>HTML…</p>"
          spellCheck={false}
        />
      ) : (
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          data-placeholder={placeholder}
          onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
          // Paste as plain text: copy arrives from suppliers carrying fonts, colours and spans that
          // would then be published. Anyone who genuinely wants markup has the HTML view.
          onPaste={(e) => {
            e.preventDefault();
            document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
          }}
          className="rte block w-full px-3 py-2.5 text-[13.5px] leading-[1.6] text-n-800 outline-none"
          style={{ minHeight }}
        />
      )}
    </div>
  );
}
