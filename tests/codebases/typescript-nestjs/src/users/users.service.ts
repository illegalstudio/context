import { Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';

interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

@Injectable()
export class UsersService {
  private users: Map<string, User> = new Map();

  findAll(): User[] {
    return Array.from(this.users.values());
  }

  findOne(id: string): User | undefined {
    return this.users.get(id);
  }

  findByEmail(email: string): User | undefined {
    return Array.from(this.users.values()).find(u => u.email === email);
  }

  create(createUserDto: CreateUserDto): User {
    const user: User = {
      id: Date.now().toString(),
      ...createUserDto,
      createdAt: new Date(),
    };
    this.users.set(user.id, user);
    return user;
  }

  update(id: string, updateUserDto: Partial<CreateUserDto>): User | undefined {
    const user = this.users.get(id);
    if (!user) {
      return undefined;
    }

    const updatedUser = {
      ...user,
      ...updateUserDto,
    };
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  remove(id: string): boolean {
    return this.users.delete(id);
  }
}
