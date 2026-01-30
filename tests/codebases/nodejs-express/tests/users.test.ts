import { describe, it, expect, beforeEach } from 'vitest';
import { UserController } from '../src/controllers/UserController.js';

describe('UserController', () => {
  let controller: UserController;

  beforeEach(() => {
    controller = new UserController();
  });

  it('should create a user', async () => {
    const user = await controller.createUser({
      name: 'John Doe',
      email: 'john@example.com',
    });

    expect(user.name).toBe('John Doe');
    expect(user.email).toBe('john@example.com');
    expect(user.id).toBeDefined();
  });

  it('should get all users', async () => {
    await controller.createUser({ name: 'User 1', email: 'user1@test.com' });
    // Small delay to ensure different timestamps for IDs
    await new Promise(resolve => setTimeout(resolve, 2));
    await controller.createUser({ name: 'User 2', email: 'user2@test.com' });

    const users = await controller.getAllUsers();
    expect(users).toHaveLength(2);
  });

  it('should get user by id', async () => {
    const created = await controller.createUser({
      name: 'Test User',
      email: 'test@test.com',
    });

    const found = await controller.getUserById(created.id);
    expect(found).toBeDefined();
    expect(found?.email).toBe('test@test.com');
  });

  it('should return null for non-existent user', async () => {
    const found = await controller.getUserById('non-existent');
    expect(found).toBeNull();
  });
});
