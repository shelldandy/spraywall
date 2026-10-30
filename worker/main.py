"""Lease-aware Spraywall detection worker."""

import json
import logging
import os
import threading
import time
import uuid
from dataclasses import dataclass

import psycopg

from detection.align import estimate_alignment
from detection.match import match_holds
from detection.storage import download_image

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

POLL_INTERVAL = max(1, int(os.environ.get("POLL_INTERVAL_SECONDS", "5")))
DATABASE_URL = os.environ.get("DATABASE_URL", "")
INFERENCE_BACKEND = os.environ.get("INFERENCE_BACKEND", "local").lower()
MAX_ATTEMPTS = max(1, int(os.environ.get("DETECTION_MAX_ATTEMPTS", "3")))


def clamp_heartbeat_seconds(lease_seconds: int, requested_seconds: int) -> int:
    """Keep heartbeat renewals comfortably ahead of lease expiration."""
    safe_lease_seconds = max(3, lease_seconds)
    return min(max(1, requested_seconds), max(1, safe_lease_seconds // 3))


LEASE_SECONDS = max(3, int(os.environ.get("DETECTION_LEASE_SECONDS", "900")))
_requested_heartbeat_seconds = int(os.environ.get("DETECTION_HEARTBEAT_SECONDS", "30"))
HEARTBEAT_SECONDS = clamp_heartbeat_seconds(LEASE_SECONDS, _requested_heartbeat_seconds)
if HEARTBEAT_SECONDS != _requested_heartbeat_seconds:
    logger.warning(
        "DETECTION_HEARTBEAT_SECONDS=%d is unsafe for a %d-second lease; clamping to %d seconds",
        _requested_heartbeat_seconds,
        LEASE_SECONDS,
        HEARTBEAT_SECONDS,
    )
RETRY_BACKOFF_SECONDS = max(1, int(os.environ.get("DETECTION_RETRY_BACKOFF_SECONDS", "10")))
RETRY_BACKOFF_MAX_SECONDS = max(
    RETRY_BACKOFF_SECONDS,
    int(os.environ.get("DETECTION_RETRY_BACKOFF_MAX_SECONDS", "300")),
)

if INFERENCE_BACKEND == "modal":
    from detection.remote import detect_holds_remote as detect_holds
elif INFERENCE_BACKEND == "local":
    from detection.infer import detect_holds
else:
    raise SystemExit(f"Unknown INFERENCE_BACKEND: {INFERENCE_BACKEND!r} (expected 'local' or 'modal')")


@dataclass(frozen=True)
class DetectionJob:
    id: str
    wall_image_id: str
    wall_id: str
    storage_key: str
    reset_kind: str | None
    parent_image_id: str | None
    lease_token: str
    attempt_count: int


class LeaseLostError(RuntimeError):
    """Raised when this worker no longer owns a claimed job."""


class DiscardedJobError(RuntimeError):
    """Raised when an image or wall was intentionally removed during processing."""


def retry_backoff_seconds(attempt_count: int) -> int:
    """Return capped exponential backoff for the failed attempt just completed."""
    exponent = max(0, attempt_count - 1)
    return min(RETRY_BACKOFF_SECONDS * (2**exponent), RETRY_BACKOFF_MAX_SECONDS)


def claim_job(conn) -> DetectionJob | None:
    """Atomically claim one eligible job, reclaiming expired leases safely."""
    with conn.transaction():
        with conn.cursor() as cur:
            # A worker killed on its final attempt must become terminal even
            # though it never had a chance to record its inference exception.
            cur.execute(
                """
                UPDATE detection_jobs
                SET status = 'failed',
                    error = COALESCE(error, 'worker lease expired after retry limit'),
                    lease_token = NULL,
                    lease_expires_at = NULL,
                    updated_at = now()
                WHERE attempt_count >= %s
                  AND (
                    status = 'pending'
                    OR (status = 'processing' AND
                        (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp()))
                  )
                """,
                (MAX_ATTEMPTS,),
            )
            cur.execute(
                """
                SELECT dj.id, dj.wall_image_id, wi.id, wi.wall_id, wi.storage_key,
                       wi.reset_kind, wi.parent_image_id
                FROM detection_jobs AS dj
                LEFT JOIN wall_images AS wi ON wi.id = dj.wall_image_id
                WHERE dj.attempt_count < %s
                  AND (
                    (dj.status = 'pending' AND dj.next_attempt_at <= clock_timestamp())
                    OR (dj.status = 'processing' AND
                        (dj.lease_expires_at IS NULL OR dj.lease_expires_at <= clock_timestamp()))
                  )
                ORDER BY dj.next_attempt_at, dj.created_at, dj.id
                LIMIT 1
                FOR UPDATE OF dj SKIP LOCKED
                """,
                (MAX_ATTEMPTS,),
            )
            row = cur.fetchone()
            if row is None:
                return None

            job_id, wall_image_id, image_row_id, wall_id, storage_key, reset_kind, parent_image_id = row
            if image_row_id is None:
                # The foreign key normally cascades this case. Keep the check
                # for legacy/corrupt databases so orphan jobs do not retry forever.
                cur.execute(
                    """
                    UPDATE detection_jobs
                    SET status = 'failed', error = 'wall image row is missing',
                        lease_token = NULL, lease_expires_at = NULL, updated_at = now()
                    WHERE id = %s
                    """,
                    (job_id,),
                )
                logger.error("Detection job %s references a missing wall image; marking failed", job_id)
                return None

            lease_token = str(uuid.uuid4())
            cur.execute(
                """
                UPDATE detection_jobs
                SET status = 'processing',
                    attempt_count = attempt_count + 1,
                    lease_token = %s,
                    lease_expires_at = clock_timestamp() + make_interval(secs => %s),
                    updated_at = now()
                WHERE id = %s
                RETURNING attempt_count
                """,
                (lease_token, LEASE_SECONDS, job_id),
            )
            attempt_count = cur.fetchone()[0]

    return DetectionJob(
        id=str(job_id),
        wall_image_id=str(wall_image_id),
        wall_id=str(wall_id),
        storage_key=storage_key,
        reset_kind=reset_kind,
        parent_image_id=str(parent_image_id) if parent_image_id else None,
        lease_token=lease_token,
        attempt_count=attempt_count,
    )


def renew_lease(conn, job: DetectionJob) -> bool:
    """Extend a still-live lease only while the caller remains its owner."""
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE detection_jobs
                SET lease_expires_at = clock_timestamp() + make_interval(secs => %s),
                    updated_at = now()
                WHERE id = %s AND status = 'processing' AND lease_token = %s
                  AND lease_expires_at > clock_timestamp()
                RETURNING id
                """,
                (LEASE_SECONDS, job.id, job.lease_token),
            )
            return cur.fetchone() is not None


class LeaseHeartbeat:
    """Renew a job lease from a dedicated connection while inference runs."""

    def __init__(self, job: DetectionJob, connection_factory=None):
        self.job = job
        self.connection_factory = connection_factory
        self.lost = threading.Event()
        self._stop = threading.Event()
        self._ready = threading.Event()
        self._thread = None

    def __enter__(self):
        self._thread = threading.Thread(target=self._run, name=f"lease-{self.job.id}", daemon=True)
        self._thread.start()
        if not self._ready.wait(timeout=10):
            self.lost.set()
            logger.error("Lease heartbeat startup timed out for job %s", self.job.id)
        return self

    def _run(self):
        conn = None
        try:
            connector = self.connection_factory or psycopg.connect
            conn = connector(DATABASE_URL, autocommit=True)
            if not renew_lease(conn, self.job):
                self.lost.set()
                logger.warning("Could not renew lease for job %s; ownership was lost", self.job.id)
                return
            self._ready.set()
            while not self._stop.wait(HEARTBEAT_SECONDS):
                if not renew_lease(conn, self.job):
                    self.lost.set()
                    logger.warning("Could not renew lease for job %s; ownership was lost", self.job.id)
                    return
        except Exception:
            self.lost.set()
            logger.exception("Lease heartbeat failed for job %s", self.job.id)
        finally:
            self._ready.set()
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    logger.exception("Could not close heartbeat connection for job %s", self.job.id)

    def assert_owned(self):
        if self.lost.is_set():
            raise LeaseLostError(f"lease ownership lost for job {self.job.id}")

    def __exit__(self, _exc_type, _exc, _traceback):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=max(5, HEARTBEAT_SECONDS + 1))
            if self._thread.is_alive():
                self.lost.set()
                logger.error("Lease heartbeat did not stop for job %s", self.job.id)
        return False


def _safe_unlink(path: str | None):
    if not path:
        return
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    except OSError:
        # A cleanup problem must not mask inference/commit results or turn a
        # committed job into a retry that could duplicate its holds.
        logger.exception("Could not remove temporary file %s", path)


def _load_partial_parent(conn, job: DetectionJob):
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("SELECT storage_key FROM wall_images WHERE id = %s", (job.parent_image_id,))
            parent_row = cur.fetchone()
            if not parent_row:
                return None, []
            cur.execute(
                "SELECT id, bbox, polygon FROM holds WHERE wall_image_id = %s",
                (job.parent_image_id,),
            )
            old_holds = [{"id": str(row[0]), "bbox": row[1], "polygon": row[2]} for row in cur.fetchall()]
    return parent_row[0], old_holds


def write_results(
    conn, job: DetectionJob, holds: list[dict], alignment: dict, old_holds: list[dict], matches: list[dict]
):
    """Fence all writes on the current live lease in one result transaction."""
    with conn.transaction():
        with conn.cursor() as cur:
            # Uploads and reset application lock wall -> image/job. Keep that
            # order here too, then lock/fence the job before any result writes.
            cur.execute("SELECT id FROM walls WHERE id = %s FOR UPDATE", (job.wall_id,))
            if cur.fetchone() is None:
                raise DiscardedJobError(f"wall {job.wall_id} no longer exists")

            cur.execute(
                """
                SELECT status, lease_token, lease_expires_at > clock_timestamp()
                FROM detection_jobs WHERE id = %s FOR UPDATE
                """,
                (job.id,),
            )
            row = cur.fetchone()
            if row is None:
                raise LeaseLostError(f"job {job.id} was deleted or reclaimed")
            status, lease_token, lease_is_live = row
            if status != "processing" or str(lease_token) != job.lease_token or not lease_is_live:
                raise LeaseLostError(f"job {job.id} is no longer owned by this worker")

            cur.execute("SELECT id FROM wall_images WHERE id = %s", (job.wall_image_id,))
            if cur.fetchone() is None:
                raise DiscardedJobError(f"image {job.wall_image_id} no longer exists")

            new_hold_ids = []
            for hold in holds:
                cur.execute(
                    """
                    INSERT INTO holds (wall_image_id, bbox, polygon, confidence)
                    VALUES (%s, %s, %s, %s) RETURNING id
                    """,
                    (
                        job.wall_image_id,
                        json.dumps(hold["bbox"]),
                        json.dumps(hold["polygon"]) if hold.get("polygon") else None,
                        hold["confidence"],
                    ),
                )
                new_hold_ids.append(str(cur.fetchone()[0]))

            if job.reset_kind == "partial":
                cur.execute(
                    "UPDATE wall_images SET alignment = %s WHERE id = %s",
                    (json.dumps(alignment), job.wall_image_id),
                )
                if cur.rowcount != 1:
                    raise DiscardedJobError(f"image {job.wall_image_id} no longer exists")
                for match in matches:
                    cur.execute(
                        """
                        INSERT INTO hold_matches (new_hold_id, old_hold_id, wall_image_id, source, iou)
                        VALUES (%s, %s, %s, 'auto', %s)
                        """,
                        (
                            new_hold_ids[match["new_index"]],
                            old_holds[match["old_index"]]["id"],
                            job.wall_image_id,
                            match["iou"],
                        ),
                    )

            cur.execute(
                """
                UPDATE detection_jobs
                SET status = 'done', error = NULL, lease_token = NULL,
                    lease_expires_at = NULL, next_attempt_at = clock_timestamp(), updated_at = now()
                WHERE id = %s AND status = 'processing' AND lease_token = %s
                  AND lease_expires_at > clock_timestamp()
                RETURNING id
                """,
                (job.id, job.lease_token),
            )
            if cur.fetchone() is None:
                raise LeaseLostError(f"job {job.id} lease expired before result commit")


def process_job(conn, job: DetectionJob, heartbeat: LeaseHeartbeat | None = None):
    """Run inference and atomically store holds/matches/status for an owned job."""
    logger.info("Processing job %s for image %s (attempt %d)", job.id, job.wall_image_id, job.attempt_count)

    local_path = None
    parent_path = None
    try:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM wall_images WHERE id = %s", (job.wall_image_id,))
                if cur.fetchone() is None:
                    raise DiscardedJobError(f"image {job.wall_image_id} was discarded before inference")

        local_path = download_image(job.storage_key)
        logger.info("Downloaded image to %s", local_path)
        holds = detect_holds(local_path)
        logger.info("Detected %d holds", len(holds))

        alignment = {"homography": [[1, 0, 0], [0, 1, 0], [0, 0, 1]], "inliers": 0, "ok": False}
        old_holds = []
        matches = []
        if job.reset_kind == "partial" and job.parent_image_id:
            try:
                parent_storage_key, old_holds = _load_partial_parent(conn, job)
                if parent_storage_key:
                    parent_path = download_image(parent_storage_key)
                    alignment = estimate_alignment(local_path, parent_path)
                    if not alignment["ok"]:
                        logger.warning(
                            "Alignment failed for partial image %s; attempting matches with identity alignment",
                            job.wall_image_id,
                        )
                    matches = match_holds(holds, old_holds, alignment["homography"])
            except Exception:
                logger.exception("Partial reset alignment/matching failed for image %s", job.wall_image_id)
                alignment = {"homography": [[1, 0, 0], [0, 1, 0], [0, 0, 1]], "inliers": 0, "ok": False}
                matches = []

        if heartbeat is not None:
            heartbeat.assert_owned()
        write_results(conn, job, holds, alignment, old_holds, matches)
        logger.info("Job %s completed: %d holds inserted", job.id, len(holds))
    finally:
        _safe_unlink(local_path)
        _safe_unlink(parent_path)


def record_failure(conn, job: DetectionJob, error: Exception) -> bool:
    """Retry with backoff while attempts remain, else mark terminal failure."""
    message = str(error)[:4000] or error.__class__.__name__
    should_retry = job.attempt_count < MAX_ATTEMPTS
    with conn.transaction():
        with conn.cursor() as cur:
            if should_retry:
                cur.execute(
                    """
                    UPDATE detection_jobs
                    SET status = 'pending', error = %s, lease_token = NULL,
                        lease_expires_at = NULL,
                        next_attempt_at = clock_timestamp() + make_interval(secs => %s),
                        updated_at = now()
                    WHERE id = %s AND status = 'processing' AND lease_token = %s
                      AND lease_expires_at > clock_timestamp()
                    RETURNING id
                    """,
                    (message, retry_backoff_seconds(job.attempt_count), job.id, job.lease_token),
                )
            else:
                cur.execute(
                    """
                    UPDATE detection_jobs
                    SET status = 'failed', error = %s, lease_token = NULL,
                        lease_expires_at = NULL, next_attempt_at = clock_timestamp(), updated_at = now()
                    WHERE id = %s AND status = 'processing' AND lease_token = %s
                      AND lease_expires_at > clock_timestamp()
                    RETURNING id
                    """,
                    (message, job.id, job.lease_token),
                )
            return cur.fetchone() is not None


def mark_discarded(conn, job: DetectionJob, error: Exception):
    """Make a still-present orphan job terminal; deleted reset jobs are a no-op."""
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE detection_jobs
                SET status = 'failed', error = %s, lease_token = NULL,
                    lease_expires_at = NULL, next_attempt_at = clock_timestamp(), updated_at = now()
                WHERE id = %s AND status = 'processing' AND lease_token = %s
                  AND lease_expires_at > clock_timestamp()
                """,
                (str(error)[:4000], job.id, job.lease_token),
            )


def poll_and_process(conn):
    """Claim a job and process it under a renewed, fenced lease."""
    job = claim_job(conn)
    if job is None:
        return False

    try:
        with LeaseHeartbeat(job) as heartbeat:
            process_job(conn, job, heartbeat)
    except DiscardedJobError as error:
        logger.info("Job %s was discarded while processing: %s", job.id, error)
        try:
            mark_discarded(conn, job, error)
        except Exception:
            logger.exception("Could not mark discarded job %s; lease expiry will recover it", job.id)
    except LeaseLostError as error:
        # A stale worker must not write results or alter the new owner's state.
        logger.warning("Job %s stopped without finalizing: %s", job.id, error)
    except Exception as error:
        logger.exception("Job %s failed on attempt %d", job.id, job.attempt_count)
        try:
            if record_failure(conn, job, error):
                state = "pending" if job.attempt_count < MAX_ATTEMPTS else "failed"
                logger.warning("Job %s recorded as %s after attempt %d", job.id, state, job.attempt_count)
            else:
                logger.info("Job %s is no longer owned; failure state was not changed", job.id)
        except Exception:
            # Leave the processing lease for expiry/reclaim if failure-state
            # persistence itself is unavailable.
            logger.exception("Could not record failure for job %s; lease expiry will recover it", job.id)
    return True


def main():
    if not DATABASE_URL:
        logger.error("DATABASE_URL is not set — exiting.")
        raise SystemExit(1)

    logger.info(
        "Worker starting (poll interval: %ds, backend: %s, attempts: %d, lease: %ds, heartbeat: %ds)",
        POLL_INTERVAL,
        INFERENCE_BACKEND,
        MAX_ATTEMPTS,
        LEASE_SECONDS,
        HEARTBEAT_SECONDS,
    )

    conn = None
    while True:
        try:
            if conn is None or conn.closed:
                logger.info("Connecting to database...")
                conn = psycopg.connect(DATABASE_URL)
                logger.info("Connected.")

            poll_and_process(conn)
        except psycopg.OperationalError:
            logger.warning("Database not available, retrying...", exc_info=True)
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    logger.exception("Could not close database connection")
            conn = None
        except Exception:
            logger.exception("Unexpected error in poll loop")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
