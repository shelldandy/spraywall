-- +goose Up
-- Deploy after stopping legacy workers: processing rows without a lease are
-- treated as expired and can be reclaimed by the lease-aware worker.
ALTER TABLE detection_jobs
    ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    ADD COLUMN lease_token UUID,
    ADD COLUMN lease_expires_at TIMESTAMPTZ,
    ADD COLUMN next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX detection_jobs_eligible_idx
    ON detection_jobs (status, next_attempt_at, created_at);

-- +goose Down
DROP INDEX detection_jobs_eligible_idx;
ALTER TABLE detection_jobs
    DROP COLUMN next_attempt_at,
    DROP COLUMN lease_expires_at,
    DROP COLUMN lease_token,
    DROP COLUMN attempt_count;
