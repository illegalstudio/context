import React, { useState } from 'react';
import { Button } from './Button';
import { api } from '../services/api';

interface User {
  id: string;
  name: string;
  email: string;
}

interface UserFormProps {
  onSubmit: (user: User) => void;
  onCancel: () => void;
}

export function UserForm({ onSubmit, onCancel }: UserFormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim() || !email.trim()) {
      setError('Please fill in all fields');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const user = await api.createUser({ name, email });
      onSubmit(user);
    } catch (err) {
      setError('Failed to create user');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="user-form" onSubmit={handleSubmit}>
      <h3>Create New User</h3>

      {error && <div className="error">{error}</div>}

      <div className="form-group">
        <label htmlFor="name">Name</label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          disabled={loading}
        />
      </div>

      <div className="form-group">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          disabled={loading}
        />
      </div>

      <div className="form-actions">
        <Button type="submit" disabled={loading}>
          {loading ? 'Creating...' : 'Create User'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
