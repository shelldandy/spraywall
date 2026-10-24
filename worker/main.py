"""Spraywall detection worker - polls for pending jobs and runs inference."""
import json
import logging
import os
import time

import psycopg

from detection.align import estimate_alignment
from detection.match import match_holds
from detection.storage import download_image

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL_SECONDS", "5"))
DATABASE_URL = os.environ.get("DATABASE_URL", "")
INFERENCE_BACKEND = os.environ.get("INFERENCE_BACKEND", "local").lower()

if INFERENCE_BACKEND == "modal":
    from detection.remote import detect_holds_remote as detect_holds
elif INFERENCE_BACKEND == "local":
    from detection.infer import detect_holds
else:
    raise SystemExit(f"Unknown INFERENCE_BACKEND: {INFERENCE_BACKEND!r} (expected 'local' or 'modal')")


def process_job(conn, job_id: str, wall_image_id: str, storage_key: str,
                reset_kind: str = None, parent_image_id: str = None):
    """Process a single detection job."""
    logger.info("Processing job %s for image %s", job_id, wall_image_id)

    # Download image from MinIO
    local_path = download_image(storage_key)
    logger.info("Downloaded image to %s", local_path)

    parent_path = None
    try:
        holds = detect_holds(local_path)
        logger.info("Detected %d holds", len(holds))
        alignment = {"homography": [[1, 0, 0], [0, 1, 0], [0, 0, 1]], "inliers": 0, "ok": False}
        old_holds = []
        matches = []
        if reset_kind == "partial" and parent_image_id:
            try:
                with conn.transaction():
                    with conn.cursor() as cur:
                        cur.execute("SELECT storage_key FROM wall_images WHERE id = %s", (parent_image_id,))
                        parent_row = cur.fetchone()
                        if parent_row:
                            cur.execute(
                                "SELECT id, bbox, polygon FROM holds WHERE wall_image_id = %s",
                                (parent_image_id,),
                            )
                            old_holds = [
                                {"id": str(row[0]), "bbox": row[1], "polygon": row[2]}
                                for row in cur.fetchall()
                            ]
                if parent_row:
                    parent_path = download_image(parent_row[0])
                    alignment = estimate_alignment(local_path, parent_path)
                    if not alignment["ok"]:
                        logger.warning(
                            "Alignment failed for partial image %s; attempting matches with identity alignment",
                            wall_image_id,
                        )
                    matches = match_holds(holds, old_holds, alignment["homography"])
            except Exception:
                logger.exception("Partial reset alignment/matching failed for image %s", wall_image_id)
                alignment = {"homography": [[1, 0, 0], [0, 1, 0], [0, 0, 1]], "inliers": 0, "ok": False}
                matches = []

        with conn.transaction():
            with conn.cursor() as cur:
                new_hold_ids = []
                for hold in holds:
                    cur.execute(
                        """
                        INSERT INTO holds (wall_image_id, bbox, polygon, confidence)
                        VALUES (%s, %s, %s, %s) RETURNING id
                        """,
                        (
                            wall_image_id,
                            json.dumps(hold["bbox"]),
                            json.dumps(hold["polygon"]) if hold["polygon"] else None,
                            hold["confidence"],
                        ),
                    )
                    new_hold_ids.append(str(cur.fetchone()[0]))

                if reset_kind == "partial":
                    cur.execute("UPDATE wall_images SET alignment = %s WHERE id = %s",
                                (json.dumps(alignment), wall_image_id))
                    for match in matches:
                        cur.execute(
                            """
                            INSERT INTO hold_matches (new_hold_id, old_hold_id, wall_image_id, source, iou)
                            VALUES (%s, %s, %s, 'auto', %s)
                            """,
                            (new_hold_ids[match["new_index"]], old_holds[match["old_index"]]["id"],
                             wall_image_id, match["iou"]),
                        )

                cur.execute(
                    """
                    UPDATE detection_jobs
                    SET status = 'done', updated_at = now()
                    WHERE id = %s
                    """,
                    (job_id,),
                )

        logger.info("Job %s completed: %d holds inserted", job_id, len(holds))
    finally:
        os.unlink(local_path)
        if parent_path:
            os.unlink(parent_path)


def poll_and_process(conn):
    """Poll for a pending job and process it."""
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT dj.id, dj.wall_image_id, wi.storage_key, wi.reset_kind, wi.parent_image_id
                FROM detection_jobs dj
                JOIN wall_images wi ON dj.wall_image_id = wi.id
                WHERE dj.status = 'pending'
                ORDER BY dj.created_at
                LIMIT 1
                FOR UPDATE OF dj SKIP LOCKED
                """
            )
            row = cur.fetchone()

            if not row:
                logger.debug("No pending jobs.")
                return

            job_id, wall_image_id, storage_key = str(row[0]), str(row[1]), row[2]
            reset_kind, parent_image_id = row[3], str(row[4]) if row[4] else None

            # Mark as processing
            cur.execute(
                "UPDATE detection_jobs SET status = 'processing', updated_at = now() WHERE id = %s",
                (job_id,),
            )

    try:
        process_job(conn, job_id, wall_image_id, storage_key, reset_kind, parent_image_id)
    except Exception as e:
        logger.exception("Job %s failed", job_id)
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE detection_jobs SET status = 'failed', error = %s, updated_at = now() WHERE id = %s",
                (str(e), job_id),
            )
        conn.commit()


def main():
    if not DATABASE_URL:
        logger.error("DATABASE_URL is not set — exiting.")
        raise SystemExit(1)

    logger.info("Worker starting (poll interval: %ds, backend: %s)", POLL_INTERVAL, INFERENCE_BACKEND)

    conn = None
    while True:
        try:
            if conn is None or conn.closed:
                logger.info("Connecting to database...")
                conn = psycopg.connect(DATABASE_URL)
                logger.info("Connected.")

            poll_and_process(conn)
        except psycopg.OperationalError:
            logger.warning("Database not available, retrying...")
            conn = None
        except Exception:
            logger.exception("Unexpected error in poll loop")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
