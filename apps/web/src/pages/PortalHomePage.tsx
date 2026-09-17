import { PackageSearch } from 'lucide-react';
import { useAuth } from '../lib/auth';

/**
 * Where a customer's own people land.
 *
 * A placeholder, and honestly labelled as one: the account, the invitation and the boundary that
 * keeps these users out of the platform are built, and the shipments they will file are not. Better
 * a page that says so than an empty version of somebody else's application.
 */
export function PortalHomePage() {
  const { user, signOut } = useAuth();

  return (
    <div className="grid min-h-screen place-items-center bg-n-50 px-4">
      <div className="w-full max-w-[520px] rounded-xl border border-n-200 bg-n-0 p-8 shadow-sm">
        <PackageSearch size={24} className="mb-3 text-teal-600" />
        <h1 className="mb-1 text-[19px] font-semibold text-n-900">
          {user?.customer?.name ? `${user.customer.name} shipments` : 'Your shipments'}
        </h1>
        <p className="mb-5 text-[13.5px] leading-relaxed text-n-600">
          Your login works — you are signed in as {user?.email}. Filing shipments and following them is being built now,
          and this page becomes that as soon as it is ready.
        </p>
        <button type="button" className="hbtn" onClick={() => signOut()}>Sign out</button>
      </div>
    </div>
  );
}
