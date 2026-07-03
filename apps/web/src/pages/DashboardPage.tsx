import { Link } from 'react-router-dom';
import { Building2, Lock, Settings, Users } from 'lucide-react';
import { useAuth } from '../lib/auth';

export function DashboardPage() {
  const { user, activeCompany } = useAuth();

  const adminCards = [
    { to: '/companies', label: 'Companies', desc: 'Registered entities, VAT, contacts', icon: Building2 },
    { to: '/users', label: 'Users & roles', desc: 'People, access to companies & modules', icon: Users },
    { to: '/modules', label: 'Modules & sharing', desc: 'Enable modules per company; share Products', icon: Settings },
  ];

  return (
    <div className="w-full">
      <div className="mb-6">
        <div className="eyebrow mb-1.5">Foundation</div>
        <h1 className="text-[24px] font-semibold tracking-tight text-n-900">
          Welcome, {user?.fullName?.split(' ')[0]}
        </h1>
        <p className="mt-1 text-[13.5px] text-n-500">
          {activeCompany ? (
            <>
              Active company: <span className="font-medium text-n-700">{activeCompany.officialName}</span>
            </>
          ) : (
            'No active company selected.'
          )}
        </p>
      </div>

      {user?.isAdmin && (
        <section className="mb-8">
          <h2 className="mb-3 text-[15px] font-semibold text-n-900">Administration</h2>
          <div className="grid grid-cols-3 gap-4 max-[1100px]:grid-cols-1">
            {adminCards.map((c) => {
              const Icon = c.icon;
              return (
                <Link key={c.to} to={c.to} className="card group p-5 transition-shadow hover:shadow-md">
                  <div className="mb-3 grid h-10 w-10 place-items-center rounded-md bg-teal-50 text-teal-600">
                    <Icon size={20} />
                  </div>
                  <div className="text-[15px] font-semibold text-n-900">{c.label}</div>
                  <div className="mt-1 text-[13px] text-n-500">{c.desc}</div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-[15px] font-semibold text-n-900">Your modules</h2>
        <div className="grid grid-cols-4 gap-3 max-[1100px]:grid-cols-2 max-[760px]:grid-cols-1">
          {(user?.modules ?? []).map((m) => {
            const live = m.status === 'core' || m.status === 'module-2' || m.status === 'module-3' || m.status === 'module-4';
            return (
              <div key={m.key} className="card flex items-center justify-between p-4">
                <div>
                  <div className="text-[13.5px] font-semibold text-n-800">{m.name}</div>
                  <div className="mono mt-0.5 text-[11px] text-n-400">{m.key}</div>
                </div>
                {live ? (
                  <span className="tag border border-success-bd bg-success-bg text-success">Active</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-n-400">
                    <Lock size={13} /> Soon
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
