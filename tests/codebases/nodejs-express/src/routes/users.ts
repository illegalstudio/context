import { Router, Request, Response } from 'express';
import { UserController } from '../controllers/UserController.js';

const router = Router();
const userController = new UserController();

// GET /api/users
router.get('/', async (req: Request, res: Response) => {
  try {
    const users = await userController.getAllUsers();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/users/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const user = await userController.getUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// POST /api/users
router.post('/', async (req: Request, res: Response) => {
  try {
    const user = await userController.createUser(req.body);
    res.status(201).json(user);
  } catch (error) {
    res.status(400).json({ error: 'Failed to create user' });
  }
});

export { router as userRoutes };
