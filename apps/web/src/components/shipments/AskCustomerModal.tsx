import { useState } from 'react';
import { ModalShell } from '@masquare/ui';
import type { CustomerShipment } from '../../lib/api';

/**
 * Sending a shipment back with a question.
 *
 * The question is the whole point, so it is written in full rather than picked from a list: what is
 * missing on a shipment is different every time, and a customer reading "more information required"
 * learns nothing and telephones. It goes to their screen verbatim, which is why the field says so.
 */
export function AskCustomerModal({ shipment, busy, onAsk, onClose }: {
  shipment: CustomerShipment;
  busy: boolean;
  onAsk: (question: string) => void;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState(shipment.infoRequest ?? '');

  return (
    <ModalShell
      open
      title={`Ask about ${shipment.reference}`}
      subtitle={`${shipment.customer.name} — it goes back to their list until they answer.`}
      dirty={question.trim().length > 0}
      primaryLabel={busy ? 'Sending…' : 'Send it back'}
      primaryDisabled={busy || question.trim().length === 0}
      onPrimary={() => onAsk(question.trim())}
      onClose={onClose}
      initialSize={{ w: 560, h: 380 }}
    >
      <div className="p-1">
        <label className="block">
          <span className="label">What do you need from them?</span>
          <textarea
            className="input h-28 py-2"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="The weight of the second parcel, and a telephone number for the recipient."
            autoFocus
          />
          <span className="mt-1 block text-[11.5px] text-n-500">
            They see this exactly as written, so say what is missing rather than that something is.
          </span>
        </label>
      </div>
    </ModalShell>
  );
}
