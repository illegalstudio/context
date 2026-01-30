import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { UserList } from '../components/UserList';
import { api } from '../services/api';

vi.mock('../services/api');

describe('UserList', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should display loading state initially', () => {
    vi.mocked(api.getUsers).mockResolvedValue([]);
    render(<UserList />);
    expect(screen.getByText('Loading users...')).toBeInTheDocument();
  });

  it('should display users after loading', async () => {
    vi.mocked(api.getUsers).mockResolvedValue([
      { id: '1', name: 'John Doe', email: 'john@example.com' },
      { id: '2', name: 'Jane Doe', email: 'jane@example.com' },
    ]);

    render(<UserList />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
  });

  it('should display error message on failure', async () => {
    vi.mocked(api.getUsers).mockRejectedValue(new Error('Network error'));

    render(<UserList />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load users')).toBeInTheDocument();
    });
  });
});
