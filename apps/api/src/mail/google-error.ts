/**
 * What Google's refusal actually means, in words somebody can act on.
 *
 * Every failure mode of a delegated service account arrives as the same two-word error with no
 * explanation attached — `unauthorized_client`, `invalid_grant`, `403` — and each of them sends a
 * reasonable person to the wrong place. The usual wrong place is the key: people re-download it,
 * paste it again, and nothing changes, because the key was never the problem.
 *
 * The four that account for nearly all of them, and what each really is:
 *
 *  - unauthorized_client   — delegation is missing, or was granted for a different scope. This is
 *                            the Workspace admin console, not Google Cloud, and the client ID there
 *                            is the service account's NUMERIC id, not its email address.
 *  - invalid_grant         — usually the mailbox: it does not exist, is not in the delegated domain,
 *                            or is a group rather than a user. Sometimes the server's clock.
 *  - 403 with a Gmail body — delegation is fine and the Gmail API itself is not enabled on the
 *                            project.
 *  - 400 precondition      — the sender mailbox has no Gmail licence.
 *
 * PURE.
 */

export interface GoogleErrorContext {
  /** The mailbox we asked to send as, named in the advice because it is the usual culprit. */
  senderAddress?: string | null;
  /** The service account address, for the same reason. */
  clientEmail?: string | null;
}

export function describeGoogleFailure(status: number, body: unknown, ctx: GoogleErrorContext = {}): string {
  const b = body as any;
  const code = String(b?.error?.status ?? b?.error ?? '').trim();
  const detail = String(b?.error_description ?? b?.error?.message ?? '').trim();
  const sender = ctx.senderAddress || 'the sender address';

  if (code === 'unauthorized_client') {
    return [
      'Google refused the service account for this mailbox. The key is fine — it signed the request.',
      'In the Google Workspace admin console, under Security → Access and data control → API controls → Domain-wide delegation, add the service account and grant it the scope https://www.googleapis.com/auth/gmail.send.',
      'The Client ID there is the service account’s NUMERIC id (the `client_id` in the key file), not its email address — using the email is the commonest cause of this exact error.',
    ].join(' ');
  }

  if (code === 'invalid_grant') {
    return [
      `Google would not act as ${sender}.`,
      'Usually the mailbox: it must be a real user in the delegated domain, with a Gmail licence, and not a group or an alias.',
      detail.includes('JWT') || detail.toLowerCase().includes('time')
        ? 'It can also be a clock: the assertion is signed with a timestamp, and a server more than a few minutes out is refused.'
        : '',
    ].filter(Boolean).join(' ');
  }

  if (status === 403) {
    return detail.toLowerCase().includes('not been used') || detail.toLowerCase().includes('disabled')
      ? 'The Gmail API is not enabled on this Google Cloud project. Enable it, then try again — it takes a minute or two to take effect.'
      : `Google refused the send (403)${detail ? `: ${detail}` : ''}. Delegation reached Gmail, so this is about what ${sender} is allowed to do rather than about the key.`;
  }

  if (status === 400 && detail.toLowerCase().includes('precondition')) {
    return `${sender} cannot send: the mailbox has no Gmail licence, or Gmail is switched off for that user.`;
  }

  if (status === 429) return 'Google is rate-limiting us. Wait a moment and try again.';
  if (status >= 500) return `Google returned ${status}. Their side, not ours — try again shortly.`;

  return detail || (code ? `Google refused this (${code}).` : `Google refused this (${status}).`);
}
