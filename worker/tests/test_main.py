"""Worker lifecycle tests use an isolated schema in TEST_DATABASE_URL."""

import concurrent.futures
import os
import tempfile
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path

import psycopg
import pytest
from psycopg import sql

from main import (
    MAX_ATTEMPTS,
    LeaseHeartbeat,
    LeaseLostError,
    claim_job,
    clamp_heartbeat_seconds,
    mark_discarded,
    poll_and_process,
    record_failure,
    renew_lease,
    write_results,
)

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "server" / "db" / "migrations"


@dataclass
class WorkerDatabase:
    url: str
    schema: str

    def connect(self, _dsn=None, autocommit=False):
        return psycopg.connect(
            self.url,
            options=f"-c search_path={self.schema}",
            autocommit=autocommit,
        )


def migration_up(path: Path) -> str:
    text = path.read_text()
    if "-- +goose Up" in text:
        text = text.split("-- +goose Up", 1)[1]
    if "-- +goose Down" in text:
        text = text.split("-- +goose Down", 1)[0]
    return text.replace("-- +goose StatementBegin", "").replace("-- +goose StatementEnd", "")


@pytest.fixture
def db():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is required for worker lifecycle integration tests")

    schema = f"worker_test_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(url, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))

    database = WorkerDatabase(url, schema)
    try:
        with database.connect() as conn:
            for migration in sorted(MIGRATIONS.glob("*.sql")):
                with conn.transaction():
                    conn.execute(migration_up(migration))
        yield database
    finally:
        with psycopg.connect(url, autocommit=True) as admin:
            admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))


def create_job(db: WorkerDatabase, storage_key="test.jpg") -> str:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO users(email, password_hash, display_name) VALUES (%s, '', 'worker test') RETURNING id",
            (f"{uuid.uuid4()}@example.test",),
        )
        owner_id = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO gyms(name, slug, owner_id) VALUES ('Worker test gym', %s, %s) RETURNING id",
            (f"worker-{uuid.uuid4().hex[:8]}", owner_id),
        )
        gym_id = cur.fetchone()[0]
        cur.execute("INSERT INTO walls(gym_id, name) VALUES (%s, 'Test wall') RETURNING id", (gym_id,))
        wall_id = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO wall_images(wall_id, storage_key, is_active, reset_kind) "
            "VALUES (%s, %s, true, 'full') RETURNING id",
            (wall_id, storage_key),
        )
        image_id = cur.fetchone()[0]
        cur.execute("INSERT INTO detection_jobs(wall_image_id) VALUES (%s) RETURNING id", (image_id,))
        return str(cur.fetchone()[0])


def get_job(db: WorkerDatabase, job_id: str):
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT status, error, attempt_count, lease_token, lease_expires_at, next_attempt_at "
            "FROM detection_jobs WHERE id = %s",
            (job_id,),
        )
        return cur.fetchone()


def test_claim_competition_only_gives_job_to_one_worker(db):
    job_id = create_job(db)
    start = threading.Barrier(2)

    def claim():
        with db.connect() as conn:
            start.wait()
            return claim_job(conn)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        claimed = list(executor.map(lambda _index: claim(), range(2)))

    winners = [job for job in claimed if job is not None]
    assert len(winners) == 1
    assert winners[0].id == job_id
    assert winners[0].attempt_count == 1
    assert get_job(db, job_id)[0] == "processing"


def test_expired_processing_jobs_are_reclaimed_and_exhausted_crashes_fail(db):
    job_id = create_job(db)
    with db.connect() as conn:
        first = claim_job(conn)
    assert first is not None

    with db.connect() as conn:
        conn.execute(
            "UPDATE detection_jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = %s",
            (job_id,),
        )
    with db.connect() as conn:
        second = claim_job(conn)
    assert second is not None
    assert second.lease_token != first.lease_token
    assert second.attempt_count == 2

    with db.connect() as conn:
        conn.execute(
            "UPDATE detection_jobs SET attempt_count = %s, "
            "lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = %s",
            (MAX_ATTEMPTS, job_id),
        )
    with db.connect() as conn:
        assert claim_job(conn) is None

    status, error, attempts, token, expiry, _next_attempt = get_job(db, job_id)
    assert status == "failed"
    assert "lease expired" in error
    assert attempts == MAX_ATTEMPTS
    assert token is None
    assert expiry is None


def test_heartbeat_interval_is_clamped_below_lease_duration():
    assert clamp_heartbeat_seconds(900, 30) == 30
    assert clamp_heartbeat_seconds(90, 60) == 30
    assert clamp_heartbeat_seconds(10, 50) == 3
    assert clamp_heartbeat_seconds(2, 50) == 1
    assert clamp_heartbeat_seconds(900, 0) == 1


def test_heartbeat_renews_only_the_current_live_lease(db):
    job_id = create_job(db)
    with db.connect() as conn:
        job = claim_job(conn)
    assert job is not None
    before = get_job(db, job_id)[4]

    with db.connect() as conn:
        assert renew_lease(conn, job)
    assert get_job(db, job_id)[4] > before

    with db.connect() as conn:
        conn.execute("UPDATE detection_jobs SET lease_token = %s WHERE id = %s", (uuid.uuid4(), job_id))
    with db.connect() as conn:
        assert not renew_lease(conn, job)


def test_heartbeat_uses_a_separate_connection_and_renews_on_start(db):
    job_id = create_job(db)
    with db.connect() as conn:
        job = claim_job(conn)
    before = get_job(db, job_id)[4]

    with LeaseHeartbeat(job, connection_factory=db.connect) as heartbeat:
        assert not heartbeat.lost.is_set()
        assert get_job(db, job_id)[4] > before


def test_stale_owner_cannot_write_holds_or_complete_job(db):
    job_id = create_job(db)
    with db.connect() as conn:
        stale = claim_job(conn)
    with db.connect() as conn:
        conn.execute(
            "UPDATE detection_jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = %s",
            (job_id,),
        )
    with db.connect() as conn:
        current = claim_job(conn)

    hold = {"bbox": {"x": 0.1, "y": 0.2, "w": 0.1, "h": 0.1}, "polygon": None, "confidence": 0.9}
    with db.connect() as conn, pytest.raises(LeaseLostError):
        write_results(conn, stale, [hold], {}, [], [])

    status, _error, _attempts, token, _expiry, _next = get_job(db, job_id)
    assert status == "processing"
    assert str(token) == current.lease_token
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM holds")
        assert cur.fetchone()[0] == 0


def test_discarded_job_update_requires_a_live_lease(db):
    job_id = create_job(db)
    with db.connect() as conn:
        job = claim_job(conn)
    with db.connect() as conn:
        conn.execute(
            "UPDATE detection_jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = %s",
            (job_id,),
        )
        mark_discarded(conn, job, RuntimeError("image was removed"))

    status, _error, _attempts, token, _expiry, _next = get_job(db, job_id)
    assert status == "processing"
    assert str(token) == job.lease_token


def test_transient_failure_requeues_with_backoff(db):
    job_id = create_job(db)
    with db.connect() as conn:
        job = claim_job(conn)
    with db.connect() as conn:
        assert record_failure(conn, job, RuntimeError("temporary inference failure"))

    status, error, attempts, token, expiry, _next_attempt = get_job(db, job_id)
    assert status == "pending"
    assert error == "temporary inference failure"
    assert attempts == 1
    assert token is None
    assert expiry is None
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT next_attempt_at > clock_timestamp() FROM detection_jobs WHERE id = %s", (job_id,))
        assert cur.fetchone()[0]
        assert claim_job(conn) is None
        cur.execute(
            "UPDATE detection_jobs SET next_attempt_at = clock_timestamp() - interval '1 second' WHERE id = %s",
            (job_id,),
        )
    with db.connect() as conn:
        second = claim_job(conn)
    assert second.attempt_count == 2


def test_failure_on_last_attempt_is_terminal(db):
    job_id = create_job(db)
    with db.connect() as conn:
        conn.execute(
            "UPDATE detection_jobs SET attempt_count = %s WHERE id = %s",
            (MAX_ATTEMPTS - 1, job_id),
        )
    with db.connect() as conn:
        job = claim_job(conn)
    assert job.attempt_count == MAX_ATTEMPTS
    with db.connect() as conn:
        assert record_failure(conn, job, RuntimeError("permanent inference failure"))

    status, error, attempts, token, expiry, _next_attempt = get_job(db, job_id)
    assert status == "failed"
    assert error == "permanent inference failure"
    assert attempts == MAX_ATTEMPTS
    assert token is None
    assert expiry is None
    with db.connect() as conn:
        assert claim_job(conn) is None


def test_missing_image_row_is_marked_failed_without_claiming(db):
    job_id = create_job(db)
    with db.connect() as conn:
        conn.execute("ALTER TABLE detection_jobs DROP CONSTRAINT detection_jobs_wall_image_id_fkey")
        conn.execute(
            "DELETE FROM wall_images WHERE id = (SELECT wall_image_id FROM detection_jobs WHERE id = %s)",
            (job_id,),
        )
        assert claim_job(conn) is None

    status, error, attempts, token, expiry, _next_attempt = get_job(db, job_id)
    assert status == "failed"
    assert error == "wall image row is missing"
    assert attempts == 0
    assert token is None
    assert expiry is None


def test_poll_failure_records_retry_and_cleanup_error_does_not_undo_commit(db, monkeypatch):
    job_id = create_job(db)
    monkeypatch.setattr("main.LeaseHeartbeat", lambda _job: _NoHeartbeat())
    with db.connect() as conn:
        monkeypatch.setattr("main.download_image", lambda _key: (_ for _ in ()).throw(OSError("S3 unavailable")))
        assert poll_and_process(conn) is True
    status, error, attempts, _token, _expiry, _next = get_job(db, job_id)
    assert status == "pending"
    assert "S3 unavailable" in error
    assert attempts == 1

    with db.connect() as conn:
        conn.execute(
            "UPDATE detection_jobs SET next_attempt_at = clock_timestamp() - interval '1 second' WHERE id = %s",
            (job_id,),
        )
    with tempfile.NamedTemporaryFile(delete=False) as temporary:
        path = temporary.name
    monkeypatch.setattr("main.download_image", lambda _key: path)
    monkeypatch.setattr(
        "main.detect_holds",
        lambda _path: [{"bbox": {"x": 0.1, "y": 0.2, "w": 0.1, "h": 0.1}, "polygon": None, "confidence": 0.9}],
    )
    original_unlink = os.unlink
    with monkeypatch.context() as context:
        context.setattr("main.os.unlink", lambda _path: (_ for _ in ()).throw(OSError("file busy")))
        with db.connect() as conn:
            assert poll_and_process(conn) is True

    status, error, attempts, token, expiry, _next = get_job(db, job_id)
    assert status == "done"
    assert error is None
    assert attempts == 2
    assert token is None
    assert expiry is None
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM holds WHERE wall_image_id = (SELECT wall_image_id FROM detection_jobs WHERE id = %s)",
            (job_id,),
        )
        assert cur.fetchone()[0] == 1
    original_unlink(path)


class _NoHeartbeat:
    def __init__(self):
        self.lost = threading.Event()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def assert_owned(self):
        if self.lost.is_set():
            raise LeaseLostError("test heartbeat lost")
