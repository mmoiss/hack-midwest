# Owns GET /orders (spec entry seeded by backend/seed.py; shape: {orders: Order[]}).
from flask import Flask, jsonify

from backend.models.order import Order

app = Flask(__name__)


@app.route("/orders")
def list_orders():
    return jsonify({"orders": [o.to_dict() for o in Order.query.all()]})
