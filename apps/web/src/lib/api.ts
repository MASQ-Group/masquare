import axios from 'axios';

const TOKEN_KEY = 'masquare.token';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401 && !location.pathname.startsWith('/login')) {
      localStorage.removeItem(TOKEN_KEY);
      location.href = '/login';
    }
    return Promise.reject(err);
  },
);

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

// ---- Types ----
export interface CompanyRef {
  id: string;
  officialName: string;
  registrationNumber?: string | null;
  addressCountry?: string | null;
}
export interface ModuleRef {
  key: string;
  name: string;
  status?: string | null;
}
export interface Me {
  id: string;
  fullName: string;
  email: string;
  isAdmin: boolean;
  status: string;
  companies: CompanyRef[];
  modules: ModuleRef[];
}

export interface Company {
  id: string;
  officialName: string;
  registrationNumber?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressCity?: string | null;
  addressRegion?: string | null;
  addressPostalCode?: string | null;
  addressCountry?: string | null;
  email?: string | null;
  website?: string | null;
  phoneLandline?: string | null;
  phoneMobile?: string | null;
  vatRegistrations: { id: string; country: string; vatNumber: string }[];
  contactPersons: {
    id: string;
    name: string;
    surname?: string | null;
    email?: string | null;
    phone?: string | null;
    role?: string | null;
  }[];
}

export interface User {
  id: string;
  fullName: string;
  email: string;
  isAdmin: boolean;
  status: 'active' | 'disabled';
  companyIds: string[];
  moduleIds: string[];
}

export interface ModuleCatalogItem {
  id: string;
  key: string;
  name: string;
  status?: string | null;
  isCore: boolean;
  shareable: boolean;
  enabledCompanyIds: string[];
  sharedCompanyIds: string[];
}

// ---- Endpoints ----
export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ accessToken: string; user: Me }>('/auth/login', { email, password }).then((r) => r.data),
  me: () => api.get<Me>('/auth/me').then((r) => r.data),
};

export const companiesApi = {
  list: () => api.get<Company[]>('/companies').then((r) => r.data),
  get: (id: string) => api.get<Company>(`/companies/${id}`).then((r) => r.data),
  create: (body: Partial<Company>) => api.post<Company>('/companies', body).then((r) => r.data),
  update: (id: string, body: Partial<Company>) =>
    api.patch<Company>(`/companies/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/companies/${id}`).then((r) => r.data),
};

export const usersApi = {
  list: () => api.get<User[]>('/users').then((r) => r.data),
  create: (body: Partial<User> & { password?: string }) =>
    api.post<User>('/users', body).then((r) => r.data),
  update: (id: string, body: Partial<User> & { password?: string }) =>
    api.patch<User>(`/users/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/users/${id}`).then((r) => r.data),
};

export const modulesApi = {
  list: () => api.get<ModuleCatalogItem[]>('/modules').then((r) => r.data),
  setParticipants: (key: string, companyIds: string[]) =>
    api.put<ModuleCatalogItem[]>(`/modules/${key}/participants`, { companyIds }).then((r) => r.data),
};
