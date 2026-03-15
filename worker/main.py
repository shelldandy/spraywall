import os
import time
import logging

import psycopg

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL_SECONDS", "5"))
DATABASE_URL = os.environ.get("DATABASE_URL", "")


_table_warned = False


def poll_jobs(conn):
    """Check for pending detection jobs."""
    global _table_warned
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM detection_jobs WHERE status = 'pending' LIMIT 1"
            )
            row = cur.fetchone()
            if row:
                logger.info("Found pending job: %s", row[0])
            else:
                logger.debug("No pending jobs.")
            _table_warned = False
    except psycopg.errors.UndefinedTable:
        if not _table_warned:
            logger.warning("detection_jobs table does not exist yet — skipping poll.")
            _table_warned = True


def main():
    logger.info("Worker starting (poll interval: %ds)", POLL_INTERVAL)

    conn = None
    while True:
        try:
            if conn is None or conn.closed:
                logger.info("Connecting to database...")
                conn = psycopg.connect(DATABASE_URL, autocommit=True)
                logger.info("Connected.")

            poll_jobs(conn)
        except psycopg.OperationalError:
            logger.warning("Database not available, retrying...")
            conn = None
        except Exception:
            logger.exception("Unexpected error in poll loop")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
