class _OrderQuery:
    def all(self):
        return list(_ORDERS.values())


class Order:
    query = _OrderQuery()

    def __init__(self, id, user_id, total):
        self.id = id
        self.user_id = user_id
        self.total = total

    def to_dict(self):
        return {"id": self.id, "user_id": self.user_id, "total": self.total}


_ORDERS = {
    1: Order(1, 1, 42.50),
}
