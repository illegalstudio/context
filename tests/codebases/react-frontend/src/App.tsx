import React from 'react';
import { UserList } from './components/UserList';
import { useAuth } from './hooks/useAuth';

function App() {
  const { user, isAuthenticated, logout } = useAuth();

  return (
    <div className="app">
      <header>
        <h1>User Management</h1>
        {isAuthenticated && (
          <div className="user-info">
            <span>Welcome, {user?.name}</span>
            <button onClick={logout}>Logout</button>
          </div>
        )}
      </header>

      <main>
        {isAuthenticated ? (
          <UserList />
        ) : (
          <p>Please log in to view users.</p>
        )}
      </main>
    </div>
  );
}

export default App;
