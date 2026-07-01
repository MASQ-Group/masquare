import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authApi, tokenStore, type Me } from './api';

const ACTIVE_COMPANY_KEY = 'masquare.activeCompanyId';

interface AuthContextValue {
  user: Me | null;
  loading: boolean;
  activeCompanyId: string | null;
  setActiveCompany: (id: string) => void;
  activeCompany: Me['companies'][number] | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(
    localStorage.getItem(ACTIVE_COMPANY_KEY),
  );

  const loadMe = useCallback(async () => {
    const me = await authApi.me();
    setUser(me);
    // Ensure the active company is one the user can actually access.
    setActiveCompanyId((current) => {
      const valid = current && me.companies.some((c) => c.id === current);
      const next = valid ? current : me.companies[0]?.id ?? null;
      if (next) localStorage.setItem(ACTIVE_COMPANY_KEY, next);
      return next;
    });
  }, []);

  useEffect(() => {
    (async () => {
      if (!tokenStore.get()) {
        setLoading(false);
        return;
      }
      try {
        await loadMe();
      } catch {
        tokenStore.clear();
      } finally {
        setLoading(false);
      }
    })();
  }, [loadMe]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { accessToken } = await authApi.login(email, password);
      tokenStore.set(accessToken);
      await loadMe();
    },
    [loadMe],
  );

  const signOut = useCallback(() => {
    tokenStore.clear();
    localStorage.removeItem(ACTIVE_COMPANY_KEY);
    setUser(null);
    setActiveCompanyId(null);
  }, []);

  const setActiveCompany = useCallback((id: string) => {
    localStorage.setItem(ACTIVE_COMPANY_KEY, id);
    setActiveCompanyId(id);
  }, []);

  const activeCompany = useMemo(
    () => user?.companies.find((c) => c.id === activeCompanyId) ?? null,
    [user, activeCompanyId],
  );

  const value: AuthContextValue = {
    user,
    loading,
    activeCompanyId,
    setActiveCompany,
    activeCompany,
    signIn,
    signOut,
    refresh: loadMe,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
