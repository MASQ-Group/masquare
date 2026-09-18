import { describe, expect, it } from 'vitest';
import { documentDownload, documentsToStore, labelOf, parseShipReply } from './fedex-ship-parse';

/** The reply as FedEx documents it. Never yet observed — which is the whole point of this module. */
const documented = () => ({
  output: {
    transactionShipments: [{
      masterTrackingNumber: '794658123456',
      serviceName: 'FedEx International Priority',
      pieceResponses: [{
        trackingNumber: '794658123456',
        packageDocuments: [{
          contentType: 'LABEL',
          docType: 'PDF',
          encodedLabel: 'JVBERi0xLjQK',
          trackingNumber: '794658123456',
        }],
      }],
    }],
  },
});

describe('the documented shape', () => {
  it('reads the tracking number, the service and the label', () => {
    const reply = parseShipReply(documented());
    expect(reply.masterTrackingNumber).toBe('794658123456');
    expect(reply.serviceName).toBe('FedEx International Priority');
    expect(reply.documents).toHaveLength(1);
    expect(labelOf(reply)).toMatchObject({ contentType: 'LABEL', docType: 'PDF', encoded: 'JVBERi0xLjQK' });
  });

  it('says nothing when everything expected was found', () => {
    // A note means something needs a human. Silence is the success case.
    expect(parseShipReply(documented()).note).toBeNull();
  });

  it('names where it found it, so a real booking confirms the path', () => {
    expect(parseShipReply(documented()).documents[0].foundAt)
      .toBe('output.transactionShipments[0].pieceResponses[0].packageDocuments[0]');
  });

  it('carries the piece tracking number down to a document that omits it', () => {
    const reply = documented();
    delete (reply.output.transactionShipments[0].pieceResponses[0].packageDocuments[0] as any).trackingNumber;
    expect(parseShipReply(reply).documents[0].trackingNumber).toBe('794658123456');
  });
});

describe('a shape we did not expect', () => {
  it('finds a label somewhere else entirely, and says where', () => {
    const reply = parseShipReply({
      output: {
        transactionShipments: [{
          masterTrackingNumber: '794658123456',
          completedShipmentDetail: {
            shipmentDocuments: [{ contentType: 'LABEL', docType: 'PDF', encodedLabel: 'JVBERi0xLjQK' }],
          },
        }],
      },
    });
    expect(reply.documents).toHaveLength(1);
    expect(reply.note).toContain('documented path');
    expect(reply.note).toContain('completedShipmentDetail');
  });

  it('accepts a label hosted at a URL rather than inlined', () => {
    const reply = parseShipReply({
      output: {
        transactionShipments: [{
          masterTrackingNumber: '1',
          pieceResponses: [{ packageDocuments: [{ contentType: 'LABEL', docType: 'PDF', url: 'https://fedex.example/label.pdf' }] }],
        }],
      },
    });
    expect(labelOf(reply)).toMatchObject({ url: 'https://fedex.example/label.pdf', encoded: null });
  });

  it('reads the other names FedEx uses for the same two things', () => {
    const reply = parseShipReply({
      output: { transactionShipments: [{ pieceResponses: [{ packageDocuments: [{ documentType: 'LABEL', imageType: 'ZPLII', content: 'Xl5BMA==' }] }] }] },
    });
    expect(labelOf(reply)).toMatchObject({ contentType: 'LABEL', docType: 'ZPLII', encoded: 'Xl5BMA==' });
  });
});

describe('what it refuses to call a document', () => {
  it('ignores a string that is merely long', () => {
    // A body with no type at all is more likely to be something else than a label.
    const reply = parseShipReply({ output: { transactionShipments: [{ notes: { content: 'a very long note' } }] } });
    expect(reply.documents).toEqual([]);
  });

  it('ignores a type with nothing attached to it', () => {
    const reply = parseShipReply({ output: { transactionShipments: [{ thing: { contentType: 'LABEL', docType: 'PDF' } }] } });
    expect(reply.documents).toEqual([]);
  });
});

describe('a reply that went wrong', () => {
  it('says so rather than throwing, whatever it was handed', () => {
    for (const rubbish of [null, undefined, {}, { output: {} }, 'not json', 42, []]) {
      const reply = parseShipReply(rubbish);
      expect(reply.masterTrackingNumber, String(rubbish)).toBeNull();
      expect(reply.note, String(rubbish)).toContain('No label');
    }
  });

  it('reports a booking that produced a tracking number and no label', () => {
    // Worth distinguishing: the shipment exists and is billable either way.
    const reply = parseShipReply({ output: { transactionShipments: [{ masterTrackingNumber: '794658123456' }] } });
    expect(reply.masterTrackingNumber).toBe('794658123456');
    expect(reply.note).toContain('No label could be found');
    expect(reply.note).not.toContain('tracking number could be read');
  });

  it('does not run away down a reply that refers to itself', () => {
    const loop: any = { output: { transactionShipments: [{}] } };
    loop.output.transactionShipments[0].self = loop;
    expect(() => parseShipReply(loop)).not.toThrow();
  });
});

describe('choosing the label among several documents', () => {
  it('prefers the one FedEx called a label over the customs paperwork', () => {
    const reply = parseShipReply({
      output: {
        transactionShipments: [{
          masterTrackingNumber: '1',
          shipmentDocuments: [{ contentType: 'COMMERCIAL_INVOICE', docType: 'PDF', encodedLabel: 'aW52' }],
          pieceResponses: [{ packageDocuments: [{ contentType: 'LABEL', docType: 'PDF', encodedLabel: 'bGFi' }] }],
        }],
      },
    });
    expect(reply.documents.length).toBeGreaterThan(1);
    expect(labelOf(reply)!.encoded).toBe('bGFi');
  });
});

describe('documentsToStore � the shape the first real export booking returned', () => {
  // Observed on sandbox: label under the parcel, FedEx's commercial invoice under the shipment.
  const observed = () => parseShipReply({
    output: {
      transactionShipments: [{
        masterTrackingNumber: '794658123456',
        pieceResponses: [{
          trackingNumber: '794658123456',
          packageDocuments: [{ contentType: 'LABEL', docType: 'PDF', encodedLabel: Buffer.from('%PDF-label').toString('base64') }],
        }],
        shipmentDocuments: [{ contentType: 'COMMERCIAL_INVOICE', docType: 'PDF', encodedLabel: Buffer.from('%PDF-invoice').toString('base64') }],
      }],
    },
  });

  it('keeps the label and the invoice, each named for what it is', () => {
    const { documents, skipped } = documentsToStore(observed());
    expect(skipped).toEqual([]);
    expect(documents.map((d) => d.kind).sort()).toEqual(['COMMERCIAL_INVOICE', 'LABEL']);
  });

  it('decodes the bytes, so what is stored is the file rather than its base64', () => {
    const { documents } = documentsToStore(observed());
    expect(documents.find((d) => d.kind === 'LABEL')!.content.toString()).toBe('%PDF-label');
    expect(documents.find((d) => d.kind === 'COMMERCIAL_INVOICE')!.content.toString()).toBe('%PDF-invoice');
  });

  it('ties each label to its parcel and that parcel\u2019s tracking number', () => {
    const label = documentsToStore(observed()).documents.find((d) => d.kind === 'LABEL')!;
    expect(label.pieceIndex).toBe(0);
    expect(label.trackingNumber).toBe('794658123456');
  });

  it('treats a document under a parcel as its label, whatever FedEx called it', () => {
    // Location is structural; contentType strings are the part most likely to vary.
    const reply = parseShipReply({ output: { transactionShipments: [{ pieceResponses: [{}, { packageDocuments: [{ contentType: 'SHIPPING_LABEL_2', docType: 'ZPLII', encodedLabel: 'XkE=' }] }] }] } });
    const [doc] = documentsToStore(reply).documents;
    expect(doc).toMatchObject({ kind: 'LABEL', pieceIndex: 1, docType: 'ZPLII' });
  });

  it('leaves out a hosted document and says so, rather than storing a link that expires', () => {
    const reply = parseShipReply({ output: { transactionShipments: [{ pieceResponses: [{ packageDocuments: [{ contentType: 'LABEL', docType: 'PDF', url: 'https://fedex.example/l.pdf' }] }] }] } });
    const { documents, skipped } = documentsToStore(reply);
    expect(documents).toEqual([]);
    expect(skipped[0]).toContain('hosted');
  });
});

describe('documentDownload', () => {
  it('serves a PDF label as a PDF, named by reference and parcel', () => {
    expect(documentDownload({ kind: 'LABEL', docType: 'PDF', trackingNumber: '1', pieceIndex: 0 }, 'CB-2026-09-0001'))
      .toEqual({ mime: 'application/pdf', filename: 'CB-2026-09-0001-label-1.pdf' });
  });

  it('serves a thermal label as ZPL, and the invoice as the invoice', () => {
    expect(documentDownload({ kind: 'LABEL', docType: 'ZPLII', trackingNumber: null, pieceIndex: 1 }, 'X').filename).toBe('X-label-2.zpl');
    expect(documentDownload({ kind: 'COMMERCIAL_INVOICE', docType: 'PDF', trackingNumber: null, pieceIndex: null }, 'X').filename).toBe('X-invoice.pdf');
  });

  it('keeps anything but letters, digits and hyphens out of the filename', () => {
    // It goes into a Content-Disposition header; a quote or a newline there is a header of its own.
    expect(documentDownload({ kind: 'LABEL', docType: 'PDF', trackingNumber: null, pieceIndex: 0 }, 'A"B\r\nC/..').filename).toBe('ABC-label-1.pdf');
  });
});
