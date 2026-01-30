const API_BASE = '/api';

interface User {
  id: string;
  name: string;
  email: string;
}

interface CreateUserDTO {
  name: string;
  email: string;
}

interface LoginResponse {
  token: string;
  user: User;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('token');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers as Record<string, string>,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

export const api = {
  // Auth
  async login(email: string, password: string): Promise<LoginResponse> {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  async logout(): Promise<void> {
    await request('/auth/logout', { method: 'POST' });
  },

  async getCurrentUser(): Promise<User> {
    return request('/auth/me');
  },

  // Users
  async getUsers(): Promise<User[]> {
    return request('/users');
  },

  async getUser(id: string): Promise<User> {
    return request(`/users/${id}`);
  },

  async createUser(data: CreateUserDTO): Promise<User> {
    return request('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async deleteUser(id: string): Promise<void> {
    await request(`/users/${id}`, { method: 'DELETE' });
  },
};
