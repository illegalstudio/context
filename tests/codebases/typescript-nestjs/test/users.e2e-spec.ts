import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('UsersController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/users (GET) should return empty array', () => {
    return request(app.getHttpServer())
      .get('/users')
      .expect(200)
      .expect([]);
  });

  it('/users (POST) should create a user', async () => {
    const response = await request(app.getHttpServer())
      .post('/users')
      .send({ name: 'John Doe', email: 'john@example.com' })
      .expect(201);

    expect(response.body).toMatchObject({
      name: 'John Doe',
      email: 'john@example.com',
    });
    expect(response.body.id).toBeDefined();
  });

  it('/users/:id (GET) should return 404 for non-existent user', () => {
    return request(app.getHttpServer())
      .get('/users/non-existent')
      .expect(404);
  });

  it('/users/:id (DELETE) should delete a user', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/users')
      .send({ name: 'To Delete', email: 'delete@example.com' });

    await request(app.getHttpServer())
      .delete(`/users/${createResponse.body.id}`)
      .expect(200);
  });
});
