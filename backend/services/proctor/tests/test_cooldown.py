import asyncio

from proctor.cooldown import claim, cooldown_key, release


class FakeRedis:
    def __init__(self, fail=False):
        self.keys, self.fail, self.ttls = set(), fail, {}

    async def set(self, key, value, nx=False, ex=None):
        if self.fail:
            raise ConnectionError("down")
        if nx and key in self.keys:
            return None
        self.keys.add(key)
        self.ttls[key] = ex
        return True

    async def delete(self, key):
        self.keys.discard(key)


def run(coro):
    return asyncio.run(coro)


async def db_says(value):
    return value


def test_first_claim_wins_and_sets_the_window():
    redis = FakeRedis()
    assert run(claim(redis, "a1", "phone_detected", 30, lambda: db_says(False)))
    assert redis.ttls[cooldown_key("a1", "phone_detected")] == 30
    assert not run(claim(redis, "a1", "phone_detected", 30, lambda: db_says(True)))


def test_replicas_racing_on_one_attempt_record_once():
    redis = FakeRedis()

    async def race():
        return await asyncio.gather(*[claim(redis, "a1", "no_face", 30, lambda: db_says(True)) for _ in range(20)])

    assert sum(run(race())) == 1


def test_kinds_and_attempts_are_independent():
    redis = FakeRedis()
    assert run(claim(redis, "a1", "no_face", 30, lambda: db_says(False)))
    assert run(claim(redis, "a1", "phone_detected", 30, lambda: db_says(False)))
    assert run(claim(redis, "a2", "no_face", 30, lambda: db_says(False)))


def test_redis_failure_or_absence_uses_the_database_answer():
    assert run(claim(FakeRedis(fail=True), "a1", "no_face", 30, lambda: db_says(True)))
    assert not run(claim(FakeRedis(fail=True), "a1", "no_face", 30, lambda: db_says(False)))
    assert run(claim(None, "a1", "no_face", 30, lambda: db_says(True)))


def test_release_reopens_the_window():
    redis = FakeRedis()
    run(claim(redis, "a1", "no_face", 30, lambda: db_says(False)))
    run(release(redis, "a1", "no_face"))
    assert run(claim(redis, "a1", "no_face", 30, lambda: db_says(False)))


class FlakyRedis(FakeRedis):
    """Fails its first call, then works: the database fallback ran, and Redis recovered afterwards."""

    def __init__(self):
        super().__init__()
        self.calls = 0

    async def set(self, key, value, nx=False, ex=None):
        self.calls += 1
        if self.calls == 1:
            raise ConnectionError("down")
        return await super().set(key, value, nx=nx, ex=ex)


def test_database_fallback_also_claims_the_window_in_redis():
    redis = FlakyRedis()
    assert run(claim(redis, "a1", "phone_detected", 30, lambda: db_says(True)))
    assert cooldown_key("a1", "phone_detected") in redis.keys
    assert not run(claim(redis, "a1", "phone_detected", 30, lambda: db_says(True)))
