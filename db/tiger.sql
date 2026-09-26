-- Tiger Data (TimescaleDB) warehouse. Owner: Labib (ticket L7).
--
-- This database holds no patient. One row per access event: which practice,
-- when, what happened, and how long a fill took. Nothing joins back to a
-- person, a submission or a photo.
--
-- Check the current Tiger Data docs for the create_hypertable signature before
-- running this; the argument style has changed between Timescale versions.

CREATE TABLE IF NOT EXISTS access_events (
    time          TIMESTAMPTZ NOT NULL,
    practice_id   UUID        NOT NULL,
    event         TEXT        NOT NULL,  -- verified, filled, missed, rejected
    days_to_fill  INT,
    CONSTRAINT access_events_event_check
        CHECK (event IN ('verified', 'filled', 'missed', 'rejected'))
);

SELECT create_hypertable('access_events', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS access_events_practice_time_idx
    ON access_events (practice_id, time DESC);

-- Weekly rollup behind the drug-maker dashboard.
CREATE MATERIALIZED VIEW IF NOT EXISTS weekly_access
WITH (timescaledb.continuous) AS
SELECT time_bucket('7 days', time) AS week,
       event,
       count(*)            AS n,
       avg(days_to_fill)   AS avg_days_to_fill
FROM access_events
GROUP BY week, event;

-- Keep the aggregate close to live during the demo.
SELECT add_continuous_aggregate_policy('weekly_access',
    start_offset => INTERVAL '90 days',
    end_offset   => INTERVAL '1 hour',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists => TRUE);

-- The dashboard also hides any row where n < 5 in application code
-- (SMALL_COUNT_FLOOR in lib/analytics/tiger.ts). Belt and braces.
