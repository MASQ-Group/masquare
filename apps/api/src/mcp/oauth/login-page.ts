/**
 * The page a person sees when Claude asks to connect to maSquare: who is asking, what it will be
 * able to do, and a sign-in form.
 *
 * Plain server-rendered HTML with no script, because it is shown to someone about to type a
 * password: nothing on it should come from anywhere but here. Every value placed in it is escaped.
 */

export interface LoginPageInput {
  /** The app asking, as it named itself at registration, e.g. "Claude". */
  clientName: string;
  /** The signed sign-in request the form hands back. */
  pending: string;
  /** Where the form posts to. */
  action: string;
  /** Where "Cancel" sends the person: the app, told that access was refused. */
  cancelUrl: string;
  email?: string;
  error?: string;
}

export function renderLoginPage(p: LoginPageInput): string {
  const error = p.error ? `<p class="error" role="alert">${escapeHtml(p.error)}</p>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Connect ${escapeHtml(p.clientName)} to maSquare</title>
<style>
  :root { --teal: #0f8b8d; --teal-dark: #0b6e70; --ink: #1c2530; --muted: #5b6672; --line: #d9dee3; --bg: #f5f7f8; --card: #fff; --err: #b42318; }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #e8ecef; --muted: #9aa5b1; --line: #33404c; --bg: #11181f; --card: #18222b; --err: #f97066; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
         background: var(--bg); color: var(--ink); font: 15px/1.5 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width: 100%; max-width: 380px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 28px; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { margin: 0 0 16px; color: var(--muted); }
  ul { margin: 0 0 20px; padding-left: 18px; color: var(--muted); }
  label { display: block; font-weight: 600; margin: 0 0 6px; }
  input { width: 100%; padding: 10px 12px; margin: 0 0 14px; border: 1px solid var(--line); border-radius: 8px;
          background: transparent; color: var(--ink); font: inherit; }
  input:focus { outline: 2px solid var(--teal); outline-offset: 1px; }
  button { width: 100%; padding: 11px; border: 0; border-radius: 8px; background: var(--teal); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  button:hover { background: var(--teal-dark); }
  .cancel { display: block; text-align: center; margin-top: 14px; color: var(--muted); }
  .error { color: var(--err); font-weight: 600; }
</style>
</head>
<body>
<main>
  <h1>Connect ${escapeHtml(p.clientName)} to maSquare</h1>
  <p>${escapeHtml(p.clientName)} is asking to work in maSquare as the account you sign in with. It will be able to:</p>
  <ul>
    <li>read products and what each marketplace still needs</li>
    <li>submit researched facts and product wording</li>
  </ul>
  <p>It cannot change settings, prices, users or companies. Administrator accounts cannot connect.</p>
  ${error}
  <form method="post" action="${escapeHtml(p.action)}">
    <input type="hidden" name="pending" value="${escapeHtml(p.pending)}">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username" required value="${escapeHtml(p.email ?? '')}">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Sign in and connect</button>
  </form>
  <a class="cancel" href="${escapeHtml(p.cancelUrl)}">Cancel</a>
</main>
</body>
</html>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Headers for the page: never framed (so it cannot be overlaid to capture a password), never
 * cached, no script at all, and the form may post only here and then be sent on to the app.
 */
export function loginPageHeaders(redirectUri: string): Record<string, string> {
  const appOrigin = new URL(redirectUri).origin;
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${appOrigin}; frame-ancestors 'none'; base-uri 'none'`,
  };
}
