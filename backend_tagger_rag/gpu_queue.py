# gpu_queue.py — a tiny async job queue for the ZeusPack servers.
#
# WHY: the whole team (<20 people) shares ONE GPU server. Without coordination,
# many requests hit the model at once → GPU contention, slowdowns, or OOM. This
# queue puts every heavy job in a single-file line: at most `concurrency` run at
# a time, the rest wait their turn (FIFO), and if the line gets too long we say
# "busy, try again" instead of letting people hang forever.
#
# It also runs the blocking model call in a worker thread (run_in_threadpool) so
# waiting requests and /queue-status stay responsive instead of freezing the
# whole server while the model thinks.
import asyncio
from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool


class GpuQueue:
    def __init__(self, name: str, concurrency: int = 1, max_waiting: int = 16):
        self.name        = name
        self.concurrency = concurrency
        self.max_waiting = max_waiting
        self._sem        = asyncio.Semaphore(concurrency)
        self.active      = 0   # jobs running right now
        self.waiting     = 0   # jobs sitting in line
        self.processed   = 0   # jobs finished since startup (for stats)

    def stats(self) -> dict:
        return {
            "name":        self.name,
            "concurrency": self.concurrency,
            "active":      self.active,
            "waiting":     self.waiting,
            "processed":   self.processed,
            # rough "how many are ahead of a new arrival" number for the UI
            "queue_depth": self.active + self.waiting,
        }

    async def run(self, fn, *args, **kwargs):
        """Wait for a slot, then run the (blocking) fn in a worker thread.
        Raises HTTP 503 if the waiting room is already full."""
        if self.waiting >= self.max_waiting:
            raise HTTPException(
                503,
                f"{self.name} server is busy ({self.waiting} requests waiting). "
                f"Please try again in a moment.",
            )

        self.waiting += 1
        entered = False
        try:
            async with self._sem:            # blocks here until a slot frees up
                entered = True
                self.waiting -= 1
                self.active  += 1
                try:
                    return await run_in_threadpool(fn, *args, **kwargs)
                finally:
                    self.active    -= 1
                    self.processed += 1
        finally:
            # If we were cancelled while still waiting (never entered the slot),
            # undo the waiting count so the gauge stays honest.
            if not entered:
                self.waiting -= 1
