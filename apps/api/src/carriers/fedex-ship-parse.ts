/**
 * Reading a FedEx booking reply.
 *
 * FedEx's Ship collection carries 1,335 sample REQUESTS and no sample responses, so unlike the rate
 * parser this could not be written from their own examples. The documented shape is
 * `output.transactionShipments[].pieceResponses[].packageDocuments[]`, and the documented shape is
 * not the same thing as the observed one — we have never made a booking on either environment.
 *
 * So this looks in the documented places first and, failing that, walks the reply for anything that
 * is unmistakably a document: a content type or doc type, with either an encoded body or a URL. It
 * reports WHERE it found what it found, so the first real booking either confirms the documented
 * path or tells us the true one in a single line, instead of turning into an afternoon of guessing
 * against a reply nobody can re-request.
 *
 * Nothing here invents a field name. A path that is not found is reported as not found, and the
 * whole reply is stored regardless — a booking we cannot fully read beats no record of a label that
 * already exists and is already billable.
 *
 * PURE.
 */

export interface ShipDocument {
  /** LABEL, COMMERCIAL_INVOICE, and whatever else FedEx returns. Their vocabulary, not ours. */
  contentType: string | null;
  /** PDF, PNG, ZPLII. */
  docType: string | null;
  /** Base64, as FedEx encodes it. Never logged — it is the label itself. */
  encoded: string | null;
  /** Where FedEx hosts it, when it hosts it rather than inlining it. */
  url: string | null;
  /** The piece this belongs to, where the reply says. */
  trackingNumber: string | null;
  /** Where in the reply this was found, in dotted form. The point of the exercise. */
  foundAt: string;
}

export interface ShipReply {
  masterTrackingNumber: string | null;
  serviceName: string | null;
  /** Every document in the reply, labels and customs paperwork alike. */
  documents: ShipDocument[];
  /** One line saying what was and was not understood. Null when everything expected was found. */
  note: string | null;
}

const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
  return s.length ? s : null;
};

/** Does this object look like a document FedEx is handing us? */
function asDocument(node: any, path: string): ShipDocument | null {
  if (!node || typeof node !== 'object') return null;

  // The body, under any of the names FedEx uses across its APIs for the same thing.
  const encoded = text(node.encodedLabel) ?? text(node.content) ?? text(node.image);
  const url = text(node.url);
  if (!encoded && !url) return null;

  const contentType = text(node.contentType) ?? text(node.documentType);
  const docType = text(node.docType) ?? text(node.imageType) ?? text(node.documentFormat);
  // A body with no type at all is more likely to be something else entirely than a label.
  if (!contentType && !docType) return null;

  return { contentType, docType, encoded, url, trackingNumber: text(node.trackingNumber), foundAt: path };
}

/** Walk everything, depth-first, collecting anything document-shaped. Bounded, because replies vary. */
function walk(node: any, path: string, out: ShipDocument[], depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 12 || out.length >= 50) return;

  const found = asDocument(node, path);
  if (found) {
    out.push(found);
    return; // A document's own fields are not worth descending into.
  }

  if (Array.isArray(node)) {
    node.forEach((child, i) => walk(child, `${path}[${i}]`, out, depth + 1));
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    if (child && typeof child === 'object') walk(child, path ? `${path}.${key}` : key, out, depth + 1);
  }
}

/** Where FedEx's own documentation says the label is. Tried first, and named so a match is evidence. */
const DOCUMENTED = 'output.transactionShipments[0].pieceResponses[*].packageDocuments[*]';

export function parseShipReply(reply: any): ShipReply {
  const shipment = reply?.output?.transactionShipments?.[0] ?? null;
  const masterTrackingNumber = text(shipment?.masterTrackingNumber);
  const serviceName = text(shipment?.serviceName) ?? text(shipment?.serviceDescription?.description);

  const documents: ShipDocument[] = [];

  // 1. The documented path.
  const pieces = Array.isArray(shipment?.pieceResponses) ? shipment.pieceResponses : [];
  pieces.forEach((piece: any, i: number) => {
    const docs = Array.isArray(piece?.packageDocuments) ? piece.packageDocuments : [];
    docs.forEach((doc: any, j: number) => {
      const found = asDocument(doc, `output.transactionShipments[0].pieceResponses[${i}].packageDocuments[${j}]`);
      if (found) documents.push({ ...found, trackingNumber: found.trackingNumber ?? text(piece?.trackingNumber) });
    });
  });

  const documentedWorked = documents.length > 0;

  // 2. Anything else document-shaped, anywhere — customs paperwork lives elsewhere in the reply, and
  //    if the documented path found nothing this is what tells us where the label actually is.
  const elsewhere: ShipDocument[] = [];
  walk(reply, '', elsewhere);
  for (const doc of elsewhere) {
    if (!documents.some((d) => d.foundAt === doc.foundAt)) documents.push(doc);
  }

  const notes: string[] = [];
  if (!masterTrackingNumber) notes.push('No master tracking number could be read.');
  if (!documents.length) {
    notes.push('No label could be found in the reply. The whole reply is stored against the booking.');
  } else if (!documentedWorked) {
    notes.push(`No label at the documented path (${DOCUMENTED}); found one at ${documents[0].foundAt} instead.`);
  }

  return { masterTrackingNumber, serviceName, documents, note: notes.length ? notes.join(' ') : null };
}

/** The label among the documents, preferring one FedEx labelled as such. */
export function labelOf(reply: ShipReply): ShipDocument | null {
  return reply.documents.find((d) => (d.contentType ?? '').toUpperCase().includes('LABEL'))
    ?? reply.documents[0]
    ?? null;
}
