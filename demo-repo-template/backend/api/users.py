# Owns GET /users/{id} (spec entry seeded by backend/seed.py; shape: {id, name, email}).
from flask import Flask, jsonify

from backend.models.user import User

app = Flask(__name__)


@app.route("/users/<int:user_id>")
def get_user(user_id: int):
    user = User.query.get(user_id)
    return jsonify({
        "id": user.id,
        "name": user.name,
        "email": user.email,
    })
