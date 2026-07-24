/**
 * Purchase-order PDF template.
 *
 * This file is deliberately the ONLY place the document's look lives — edit the
 * markup, colours or wording here and nothing else needs to change. It returns a
 * self-contained HTML string (logo inlined, no external requests) which is rendered
 * to PDF by the headless browser in pdf.service.ts.
 *
 * Brand: maSquare teal #14A79D / green #8DC73F / orange #F1592A (tokens.css).
 */

export interface PoPdfCompany {
  officialName: string;
  registrationNumber?: string | null;
  vatNumbers: string[];
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressCity?: string | null;
  addressPostalCode?: string | null;
  addressCountry?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface PoPdfVendor {
  name: string;
  vatNumber?: string | null;
  addressLine1?: string | null;
  addressCity?: string | null;
  addressCountry?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface PoPdfData {
  poNumber: string;
  status: string;
  currency: string;
  createdAt: Date;
  submittedAt?: Date | null;
  expectedDeliveryDate?: Date | null;
  deliverToName?: string | null;
  notes?: string | null;
  vatTreatment?: 'standard' | 'reverse_charge' | 'outside_scope' | string | null;
  company: PoPdfCompany;
  vendor: PoPdfVendor;
  lines: { sku: string; productName: string; quantityOrdered: number; unitCost: number; vatRatePct?: number; vatAmount?: number }[];
}

const BRAND = { teal: '#14A79D', ink: '#16211F', muted: '#6B7772', line: '#E5E9E7', soft: '#FAFBFB' };

/** maSquare wordmark, inlined so the PDF needs no network access. */
const LOGO_SVG = `<svg viewBox="0 0 1402 432" xmlns="http://www.w3.org/2000/svg" style="width:132px;height:auto;display:block">
<path d="M0 432V0H467.65V432H322.971V108H305.434V432H160.755V108H143.218V432H0Z" fill="#14A79D"/>
<path fill-rule="evenodd" clip-rule="evenodd" d="M485.186 431.27V0H934.568V432H718.28V288.243H700.743V432L485.186 431.27ZM700.013 233.513H719.011V108H700.013V233.513Z" fill="#8DC73F"/>
<path d="M1401.49 432H951.374V0H1401.49V432ZM979.143 27.7295V404.271H1373.72V27.7295H979.143Z" fill="#F1592A"/>
</svg>`;

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const money = (v: number, ccy: string) => {
  const symbol = ccy === 'EUR' ? '€' : ccy === 'USD' ? '$' : ccy === 'GBP' ? '£' : `${ccy} `;
  return `${symbol}${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const date = (d?: Date | null) =>
  d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const addressLines = (a: { addressLine1?: string | null; addressLine2?: string | null; addressCity?: string | null; addressPostalCode?: string | null; addressCountry?: string | null }) =>
  [a.addressLine1, a.addressLine2, [a.addressPostalCode, a.addressCity].filter(Boolean).join(' '), a.addressCountry]
    .map((s) => (s ?? '').trim())
    .filter(Boolean);

export function renderPurchaseOrderHtml(d: PoPdfData): string {
  const subtotal = d.lines.reduce((s, l) => s + l.unitCost * l.quantityOrdered, 0);
  const vat = d.lines.reduce((s, l) => s + (l.vatAmount ?? 0), 0);
  const total = subtotal + vat;
  // VAT is charged per line, so the summary groups the distinct rates rather than
  // assuming a single order-wide percentage.
  const vatByRate = new Map<number, number>();
  for (const l of d.lines) {
    const rate = l.vatRatePct ?? 0;
    if (!(l.vatAmount ?? 0)) continue;
    vatByRate.set(rate, (vatByRate.get(rate) ?? 0) + (l.vatAmount ?? 0));
  }
  const vatNote =
    d.vatTreatment === 'reverse_charge'
      ? 'VAT reverse charge — Article 196, Council Directive 2006/112/EC. VAT to be accounted for by the recipient.'
      : d.vatTreatment === 'outside_scope'
        ? 'Outside the scope of EU VAT. Import VAT and duties payable on entry.'
        : '';
  const totalUnits = d.lines.reduce((s, l) => s + l.quantityOrdered, 0);

  const rows = d.lines
    .map(
      (l, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td class="code">${esc(l.sku)}</td>
        <td>${esc(l.productName)}</td>
        <td class="num">${l.quantityOrdered}</td>
        <td class="num">${money(l.unitCost, d.currency)}</td>
        <td class="num">${l.vatRatePct ? `${l.vatRatePct}%` : '—'}</td>
        <td class="num strong">${money(l.unitCost * l.quantityOrdered, d.currency)}</td>
      </tr>`,
    )
    .join('');

  const vatNoteHtml = vatNote ? `<div class="vat-note">${esc(vatNote)}</div>` : '';

  const companyAddr = addressLines(d.company).map((l) => `<div>${esc(l)}</div>`).join('');
  const vendorAddr = [d.vendor.addressLine1, [d.vendor.addressCity, d.vendor.addressCountry].filter(Boolean).join(', ')]
    .filter(Boolean)
    .map((l) => `<div>${esc(l)}</div>`)
    .join('');

  const legalBits = [
    d.company.registrationNumber ? `Reg. no. ${esc(d.company.registrationNumber)}` : '',
    d.company.vatNumbers.length ? `VAT ${d.company.vatNumbers.map(esc).join(' · ')}` : '',
  ].filter(Boolean).join(' &nbsp;|&nbsp; ');

  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 16mm 14mm 18mm; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         font-size: 10.5px; color: ${BRAND.ink}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .head { display:flex; align-items:flex-start; justify-content:space-between; gap:24px; }
  .title { font-size: 25px; font-weight: 700; letter-spacing:-.02em; margin:0; }
  .po-no { font-family: "SFMono-Regular", Consolas, monospace; font-size: 13px; font-weight:700; color:${BRAND.teal}; margin-top:2px; }
  .rule { height:3px; background:${BRAND.teal}; border-radius:2px; margin:14px 0 18px; }

  .cols { display:flex; gap:26px; }
  .col { flex:1; }
  .lbl { font-size:8.5px; font-weight:700; letter-spacing:.10em; text-transform:uppercase; color:${BRAND.muted}; margin-bottom:5px; }
  .party { font-size:12px; font-weight:700; margin-bottom:2px; }
  .col div { line-height:1.5; color:#3B4642; }

  .meta { margin-top:18px; display:flex; gap:0; border:1px solid ${BRAND.line}; border-radius:6px; overflow:hidden; }
  .meta .cell { flex:1; padding:8px 11px; border-right:1px solid ${BRAND.line}; }
  .meta .cell:last-child { border-right:none; }
  .meta .v { font-weight:700; margin-top:2px; }

  table { width:100%; border-collapse:collapse; margin-top:18px; }
  thead th { background:${BRAND.soft}; border-bottom:1.5px solid ${BRAND.teal};
             font-size:8.5px; font-weight:700; letter-spacing:.07em; text-transform:uppercase;
             color:${BRAND.muted}; padding:7px 8px; text-align:left; }
  tbody td { padding:7px 8px; border-bottom:1px solid ${BRAND.line}; vertical-align:top; }
  tbody tr:nth-child(even) td { background:#FCFDFD; }
  .num { text-align:right; font-variant-numeric: tabular-nums; white-space:nowrap; }
  .code { font-family:"SFMono-Regular", Consolas, monospace; font-size:10px; white-space:nowrap; }
  .strong { font-weight:700; }

  .totals { margin-top:14px; display:flex; justify-content:flex-end; }
  .totals table { width:250px; margin:0; }
  .totals td { padding:5px 8px; border:none; }
  .totals .k { color:${BRAND.muted}; }
  .totals .grand td { border-top:1.5px solid ${BRAND.teal}; padding-top:8px; font-size:13px; font-weight:700; }
  .totals .grand .v { color:${BRAND.teal}; }

  .vat-note { clear:both; margin-top:16px; padding:8px 11px; border-left:3px solid ${BRAND.teal}; background:${BRAND.soft}; font-size:9.5px; color:${BRAND.muted}; }
  .notes { margin-top:20px; padding:10px 12px; background:${BRAND.soft}; border:1px solid ${BRAND.line}; border-radius:6px; }
  .foot { position: fixed; bottom: 0; left:0; right:0; padding-top:7px; border-top:1px solid ${BRAND.line};
          font-size:8.5px; color:${BRAND.muted}; text-align:center; line-height:1.5; }
</style></head>
<body>
  <div class="head">
    <div>
      ${LOGO_SVG}
      <div style="margin-top:9px;font-weight:700;font-size:11px">${esc(d.company.officialName)}</div>
      <div style="color:${BRAND.muted};line-height:1.5">${companyAddr}</div>
    </div>
    <div style="text-align:right">
      <h1 class="title">Purchase Order</h1>
      <div class="po-no">${esc(d.poNumber)}</div>
    </div>
  </div>

  <div class="rule"></div>

  <div class="cols">
    <div class="col">
      <div class="lbl">Supplier</div>
      <div class="party">${esc(d.vendor.name)}</div>
      ${vendorAddr}
      ${d.vendor.vatNumber ? `<div>VAT ${esc(d.vendor.vatNumber)}</div>` : ''}
      ${d.vendor.email ? `<div>${esc(d.vendor.email)}</div>` : ''}
      ${d.vendor.phone ? `<div>${esc(d.vendor.phone)}</div>` : ''}
    </div>
    <div class="col">
      <div class="lbl">Deliver to</div>
      <div class="party">${esc(d.company.officialName)}</div>
      ${companyAddr}
      ${d.deliverToName ? `<div style="margin-top:4px;color:${BRAND.muted}">Warehouse: ${esc(d.deliverToName)}</div>` : ''}
    </div>
  </div>

  <div class="meta">
    <div class="cell"><div class="lbl">Order date</div><div class="v">${date(d.submittedAt ?? d.createdAt)}</div></div>
    <div class="cell"><div class="lbl">Expected delivery</div><div class="v">${date(d.expectedDeliveryDate)}</div></div>
    <div class="cell"><div class="lbl">Currency</div><div class="v">${esc(d.currency)}</div></div>
    <div class="cell"><div class="lbl">Total units</div><div class="v">${totalUnits}</div></div>
  </div>

  <table>
    <thead><tr>
      <th class="num" style="width:26px">#</th>
      <th style="width:110px">SKU</th>
      <th>Description</th>
      <th class="num" style="width:44px">Qty</th>
      <th class="num" style="width:78px">Unit cost</th>
      <th class="num" style="width:44px">VAT</th>
      <th class="num" style="width:86px">Line total</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals"><table>
    <tr><td class="k">Subtotal (net)</td><td class="num">${money(subtotal, d.currency)}</td></tr>
    ${[...vatByRate.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rate, amt]) => `<tr><td class="k">VAT ${rate}%</td><td class="num">${money(amt, d.currency)}</td></tr>`)
      .join('')}
    <tr class="grand"><td>Total</td><td class="num v">${money(total, d.currency)}</td></tr>
  </table></div>

  ${vatNoteHtml}

  ${d.notes ? `<div class="notes"><div class="lbl">Notes</div><div>${esc(d.notes).replace(/\n/g, '<br>')}</div></div>` : ''}

  <div class="foot">
    ${esc(d.company.officialName)}${legalBits ? ` &nbsp;|&nbsp; ${legalBits}` : ''}
    ${d.company.email || d.company.phone ? `<br>${[d.company.email, d.company.phone].filter(Boolean).map(esc).join(' &nbsp;|&nbsp; ')}` : ''}
  </div>
</body></html>`;
}
