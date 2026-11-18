"""Violation cooldown shared by every proctor replica.

One atomic Redis SET NX EX both checks and claims the window, so two replicas
analysing frames of the same attempt cannot both record a violation. Redis is
optional: with no client, or when it errors, the caller's database check runs
instead (the per-process lock still applies, replicas can then race as before).
"""
import logging
from collections.abc import Awaitable, Callable
from typing import Any

logger = logging.getLogger("proctor.cooldown")


def cooldown_key(attempt_id: str, kind: str) -> str:
    return f"proctor:cooldown:{attempt_id}:{kind}"


async def claim(
    redis: Any | None,
    attempt_id: str,
    kind: str,
    seconds: int,
    fallback: Callable[[], Awaitable[bool]],
) -> bool:
    """True when this caller may record a violation of this kind now."""
    if redis is not None:
        try:
            return bool(await redis.set(cooldown_key(attempt_id, kind), 1, nx=True, ex=seconds))
        except Exception as exc:  # Redis down: stay correct on the database path
            logger.warning("Redis cooldown unavailable, using the database: %s", exc)
            allowed = await fallback()
            if allowed:
                # Best effort: claim the window in Redis too, so once it recovers the next frame of this kind
                # inside the window is refused there instead of recording a duplicate.
                try:
                    await redis.set(cooldown_key(attempt_id, kind), 1, nx=True, ex=seconds)
                except Exception:
                    pass
            return allowed
    return await fallback()


async def release(redis: Any | None, attempt_id: str, kind: str) -> None:
    """Give the window back when the violation could not be stored, so it is not lost."""
    if redis is None:
        return
    try:
        await redis.delete(cooldown_key(attempt_id, kind))
    except Exception as exc:
        logger.warning("Could not release cooldown for %s/%s: %s", attempt_id, kind, exc)
