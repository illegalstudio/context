import pytest
from app import create_app, db
from app.models.user import User


@pytest.fixture
def app():
    app = create_app()
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'

    with app.app_context():
        db.create_all()
        yield app
        db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()


class TestUserRoutes:
    def test_get_users_empty(self, client):
        response = client.get('/api/users/')
        assert response.status_code == 200
        assert response.json == []

    def test_create_user(self, client, app):
        response = client.post('/api/users/', json={
            'name': 'John Doe',
            'email': 'john@example.com'
        })
        assert response.status_code == 201
        assert response.json['name'] == 'John Doe'
        assert response.json['email'] == 'john@example.com'

    def test_create_user_duplicate_email(self, client, app):
        client.post('/api/users/', json={
            'name': 'John Doe',
            'email': 'john@example.com'
        })
        response = client.post('/api/users/', json={
            'name': 'Jane Doe',
            'email': 'john@example.com'
        })
        assert response.status_code == 400
        assert 'Email already exists' in response.json['error']

    def test_get_user(self, client, app):
        create_response = client.post('/api/users/', json={
            'name': 'Test User',
            'email': 'test@example.com'
        })
        user_id = create_response.json['id']

        response = client.get(f'/api/users/{user_id}')
        assert response.status_code == 200
        assert response.json['name'] == 'Test User'

    def test_delete_user(self, client, app):
        create_response = client.post('/api/users/', json={
            'name': 'To Delete',
            'email': 'delete@example.com'
        })
        user_id = create_response.json['id']

        response = client.delete(f'/api/users/{user_id}')
        assert response.status_code == 200

        get_response = client.get(f'/api/users/{user_id}')
        assert get_response.status_code == 404
