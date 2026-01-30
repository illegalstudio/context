import express from 'express';
import { User, ApiResponse } from '@mixed/shared';

const app = express();
app.use(express.json());

const users: User[] = [];

app.get('/api/users', (req, res) => {
  const response: ApiResponse<User[]> = {
    success: true,
    data: users,
  };
  res.json(response);
});

app.post('/api/users', (req, res) => {
  const { name, email } = req.body;
  const user: User = {
    id: Date.now().toString(),
    name,
    email,
    createdAt: new Date(),
  };
  users.push(user);

  const response: ApiResponse<User> = {
    success: true,
    data: user,
  };
  res.status(201).json(response);
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});

export default app;
