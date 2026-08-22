export interface TableScrollProps {
  children: React.ReactNode;
  /** Any CSS length. The default keeps roughly a screenful in view without pinning the page. */
  maxHeight?: string;
  className?: string;
}

/**
 * Scroll container for a long table, with the column headers pinned.
 *
 * The rows scroll inside this box rather than down the page, which is what makes a sticky head
 * useful: the head stays against the top of the table, not the top of the window, so the filters
 * and the row count above it stay reachable while you read row four hundred.
 *
 * Pair with a table whose thead is styled by the .tbl-scroll rule in index.css.
 */
export function TableScroll({ children, maxHeight = 'min(62vh, 640px)', className = '' }: TableScrollProps) {
  return (
    <div className={`tbl-scroll ${className}`} style={{ maxHeight }}>
      {children}
    </div>
  );
}
