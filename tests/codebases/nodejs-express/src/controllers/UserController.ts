import { User } from '../models/User.js';

interface CreateUserDTO {
  name: string;
  email: string;
}

export class UserController {
  private users: Map<string, User> = new Map();

  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async getUserById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  async createUser(data: CreateUserDTO): Promise<User> {
    const user = new User(
      Date.now().toString(),
      data.name,
      data.email
    );
    this.users.set(user.id, user);
    return user;
  }

  async updateUser(id: string, data: Partial<CreateUserDTO>): Promise<User | null> {
    const user = this.users.get(id);
    if (!user) {
      return null;
    }

    if (data.name) user.name = data.name;
    if (data.email) user.email = data.email;

    return user;
  }

  async deleteUser(id: string): Promise<boolean> {
    return this.users.delete(id);
  }
}
