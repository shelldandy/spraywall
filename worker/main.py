"""Spraywall detection worker - polls for pending jobs and runs inference."""
import json
import os
import time
import logging
import traceback

import psycopg

from detection.infer import detect_holds
from detection.storage import download_image

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL_SECONDS", "5"))
DATABASE_URL = os.environ.get("DATABASE_URL", "")


def process_job(conn, job_id: str, wall_image_id: str, storage_key: str):
    """Process a single detection job."""
    logger.info("Processing job %s for image %s", job_id, wall_image_id)

    # Download image from MinIO
    local_path = download_image(storage_key)
    logger.info("Downloaded image to %s", local_path)

    try:
        # Run inference
        holds = detect_holds(local_path)
        logger.info("Detected %d holds", len(holds))

        # Insert holds and update job status in a transaction
        with conn.transaction():
            with conn.cursor() as cur:
                for hold in holds:
                    cur.execute(
                        """
                        INSERT INTO holds (wall_image_id, bbox, polygon, confidence)
                        VALUES (%s, %s, %s, %s)
                        """,
                        (
                            wall_image_id,
                            json.dumps(hold["bbox"]),
                            json.dumps(hold["polygon"]) if hold["polygon"] else None,
                            hold["confidence"],
                        ),
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


def poll_and_process(conn):
    """Poll for a pending job and process it."""
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT dj.id, dj.wall_image_id, wi.storage_key
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

            # Mark as processing
            cur.execute(
                "UPDATE detection_jobs SET status = 'processing', updated_at = now() WHERE id = %s",
                (job_id,),
            )

    try:
        process_job(conn, job_id, wall_image_id, storage_key)
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

    logger.info("Worker starting (poll interval: %ds)", POLL_INTERVAL)

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
