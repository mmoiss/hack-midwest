class _UserQuery:
    def get(self, user_id):
        return _USERS.get(user_id)

    def get_or_404(self, user_id):
        user = _USERS.get(user_id)
        if user is None:
            raise LookupError(f"No user {user_id}")
        return user


class User:
    query = _UserQuery()

    def __init__(self, id, name, email):
        self.id = id
        self.name = name
        self.email = email


_USERS = {
    1: User(1, "Ada Lovelace", "ada@example.com"),
    2: User(2, "Grace Hopper", "grace@example.com"),
}
