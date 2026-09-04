import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BulkImport, ModalShell, downloadTemplate, type ImportField } from '@masquare/ui';
import { adjustmentsApi, transfersApi, warehousesApi, type WarehouseNode } from '../../lib/api';

/**
 * Spreadsheet upload for the two manual inventory operations.
 *
 * Both follow the contract the opening-stock import set: validate the whole file, report every bad
 * row, write nothing unless all of it is clean. A half-applied inventory file is worse than a
 * rejected one, because the only way to find out how far it got is to compare the shelf by hand.
 */

const TRANSFER_FIELDS: ImportField[] = [
  { key: 'sku', label: 'SKU', required: true },
  { key: 'fromWarehouse', label: 'From Warehouse', required: true },
  { key: 'toWarehouse', label: 'To Warehouse', required: true },
  { key: 'quantity', label: 'Quantity' },
  { key: 'serials', label: 'Serial Numbers' },
  { key: 'notes', label: 'Notes' },
];

const ADJUSTMENT_FIELDS: ImportField[] = [
  { key: 'sku', label: 'SKU', required: true },
  { key: 'warehouse', label: 'Warehouse', required: true },
  { key: 'action', label: 'Action', required: true },
  { key: 'quantity', label: 'Quantity' },
  { key: 'serials', label: 'Serial Numbers' },
  { key: 'reason', label: 'Reason' },
  { key: 'notes', label: 'Notes' },
];

/** Wording the server accepts, so the dropdown can never offer something it will reject. */
const ACTIONS = ['Set', 'Add', 'Remove'];
const REASONS = ['Opening balance', 'Adjustment', 'Damage', 'Stocktake'];

const col = (fields: ImportField[], key: string) => fields.findIndex((f) => f.key === key);

/** Names only — a nested warehouse tree is still a flat set of names inside a spreadsheet cell. */
function flattenNames(nodes: WarehouseNode[]): string[] {
  return nodes.flatMap((n) => [n.name, ...flattenNames((n.children ?? []) as WarehouseNode[])]);
}

function useWarehouseNames() {
  const { data = [] } = useQuery({
    queryKey: ['warehouses', 'tree', false],
    queryFn: () => warehousesApi.tree({ includeInactive: false }),
  });
  return flattenNames(data as WarehouseNode[]);
}

/** Warn rather than fail silently when a closed column had nothing to offer. */
async function warnIfEmpty(promise: Promise<{ emptyLists: string[] }>) {
  const { emptyLists } = await promise;
  if (emptyLists.length) {
    toast.warning(`No values exist yet for: ${emptyLists.join(', ')}. Those columns accept free text in this file.`);
  }
}

// ---------------------------------------------------------------- transfers

function downloadTransferTemplate(warehouses: string[]) {
  const first = warehouses[0] ?? 'Main Warehouse';
  const second = warehouses[1] ?? first;
  return downloadTemplate('masquare-stock-transfer-template', {
    sheetName: 'Stock Transfer',
    headers: TRANSFER_FIELDS.map((f) => f.label),
    sampleRows: [
      ['RE-S8540', first, second, '12', '', 'Restocking the office shelf'],
      ['RE-AC8820', first, second, '3', '', ''],
      ['RE-TRACKED', first, second, '', 'SN-00412 SN-00418', 'Leave Quantity blank — the serials are the count'],
    ],
    // A typo in a warehouse name would file stock into a location that does not exist, so both
    // ends are closed lists rather than free text.
    lists: [
      { column: col(TRANSFER_FIELDS, 'fromWarehouse'), values: warehouses },
      { column: col(TRANSFER_FIELDS, 'toWarehouse'), values: warehouses },
    ],
  });
}

export function TransferImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const warehouses = useWarehouseNames();

  const commit = async (rows: Record<string, string>[]) => {
    const payload = rows.map((r) => ({
      sku: r.sku,
      fromWarehouse: r.fromWarehouse,
      toWarehouse: r.toWarehouse,
      quantity: r.quantity,
      serials: r.serials,
      notes: r.notes,
    }));

    const check = await transfersApi.importValidate(payload);
    const bad = check.rows.filter((r) => !r.valid);
    if (bad.length) {
      toast.error(`${bad.length} row${bad.length === 1 ? '' : 's'} rejected — nothing moved. First: row ${bad[0].row}, ${bad[0].errors[0]}`);
      throw new Error('validation failed');
    }

    const res = await transfersApi.importCommit(payload);
    toast.success(
      `${res.totalUnits} unit${res.totalUnits === 1 ? '' : 's'} moved across ${res.transferCount} transfer${
        res.transferCount === 1 ? '' : 's'
      } (${res.transfers.map((t) => t.reference).join(', ')})`,
    );
    onDone();
  };

  return (
    <ModalShell
      open
      title="Import Stock Transfers"
      subtitle="Move stock between warehouses from a spreadsheet."
      primaryLabel="Close"
      onPrimary={onClose}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <p className="rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12.5px] text-info">
          Rows sharing the same <strong>From</strong> and <strong>To</strong> are posted as one transfer with one
          reference. Serial-tracked products need the serials listed instead of a quantity.
          <button onClick={() => warnIfEmpty(downloadTransferTemplate(warehouses))} className="ml-1 font-semibold underline">
            Download the template
          </button>
          .
        </p>
        <BulkImport fields={TRANSFER_FIELDS} onCommit={commit} onClose={onClose} />
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------- adjustments

function downloadAdjustmentTemplate(warehouses: string[]) {
  const first = warehouses[0] ?? 'Main Warehouse';
  return downloadTemplate('masquare-stock-adjustment-template', {
    sheetName: 'Stock Adjustments',
    headers: ADJUSTMENT_FIELDS.map((f) => f.label),
    sampleRows: [
      ['RE-S8540', first, 'Set', '25', '', 'Stocktake', 'Counted on the shelf'],
      ['RE-AC8820', first, 'Add', '8', '', 'Adjustment', ''],
      ['RE-AC8820', first, 'Remove', '2', '', 'Damage', 'Crushed in the box'],
      ['RE-TRACKED', first, 'Add', '', 'SN-00412 SN-00418', 'Adjustment', 'Serials are the count'],
    ],
    lists: [
      { column: col(ADJUSTMENT_FIELDS, 'warehouse'), values: warehouses },
      { column: col(ADJUSTMENT_FIELDS, 'action'), values: ACTIONS },
      { column: col(ADJUSTMENT_FIELDS, 'reason'), values: REASONS },
    ],
  });
}

export function AdjustmentImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const warehouses = useWarehouseNames();

  const commit = async (rows: Record<string, string>[]) => {
    const payload = rows.map((r) => ({
      sku: r.sku,
      warehouse: r.warehouse,
      action: r.action,
      quantity: r.quantity,
      serials: r.serials,
      reason: r.reason,
      notes: r.notes,
    }));

    const check = await adjustmentsApi.importValidate(payload);
    const bad = check.rows.filter((r) => !r.valid);
    if (bad.length) {
      toast.error(`${bad.length} row${bad.length === 1 ? '' : 's'} rejected — nothing changed. First: row ${bad[0].row}, ${bad[0].errors[0]}`);
      throw new Error('validation failed');
    }

    const res = await adjustmentsApi.importCommit(payload);
    if (res.failed > 0) {
      // The file passed its dry run, so a failure here means the stock changed underneath it.
      // Saying how many landed beats a bare error on a partly-applied file.
      toast.error(
        `${res.applied} applied, ${res.failed} failed after the check passed — the stock changed underneath. First: row ${res.failures[0].row}, ${res.failures[0].message}`,
      );
    } else {
      toast.success(`${res.applied} adjustment${res.applied === 1 ? '' : 's'} applied${res.unchanged ? `, ${res.unchanged} already correct` : ''}`);
    }
    onDone();
  };

  return (
    <ModalShell
      open
      title="Import Stock Adjustments"
      subtitle="Set, add or remove quantities across many products at once."
      primaryLabel="Close"
      onPrimary={onClose}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <p className="rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12.5px] text-info">
          <strong>Set</strong> states the true count; <strong>Add</strong> and <strong>Remove</strong> state the change.
          Serial-tracked products can only Add or Remove, with the serials listed.
          <button onClick={() => warnIfEmpty(downloadAdjustmentTemplate(warehouses))} className="ml-1 font-semibold underline">
            Download the template
          </button>
          .
        </p>
        <BulkImport fields={ADJUSTMENT_FIELDS} onCommit={commit} onClose={onClose} />
      </div>
    </ModalShell>
  );
}
