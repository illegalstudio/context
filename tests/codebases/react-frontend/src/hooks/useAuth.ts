import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

interface User {
  id: string;
  name: string;
  email: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    const token = localStorage.getItem('token');
    if (!token) {
      setState({ user: null, isAuthenticated: false, isLoading: false });
      return;
    }

    try {
      const user = await api.getCurrentUser();
      setState({ user, isAuthenticated: true, isLoading: false });
    } catch (error) {
      localStorage.removeItem('token');
      setState({ user: null, isAuthenticated: false, isLoading: false });
    }
  }

  const login = useCallback(async (email: string, password: string) => {
    const { token, user } = await api.login(email, password);
    localStorage.setItem('token', token);
    setState({ user, isAuthenticated: true, isLoading: false });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      localStorage.removeItem('token');
      setState({ user: null, isAuthenticated: false, isLoading: false });
    }
  }, []);

  return {
    ...state,
    login,
    logout,
  };
}
