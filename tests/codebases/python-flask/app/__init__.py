from flask import Flask
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def create_app():
    app = Flask(__name__)
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///app.db'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SECRET_KEY'] = 'dev-secret-key'

    db.init_app(app)

    from app.routes.users import users_bp
    app.register_blueprint(users_bp, url_prefix='/api/users')

    with app.app_context():
        db.create_all()

    return app
