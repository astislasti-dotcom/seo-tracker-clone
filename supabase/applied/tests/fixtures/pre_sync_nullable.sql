-- Fixture NEGATIVA: gsc_sync_runs.status admite NULL (la migración lo exige NOT NULL). Debe abortar.
CREATE TABLE public.gsc_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_domain text NOT NULL,
  start_date date NOT NULL, end_date date NOT NULL, started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz, rows_received integer NOT NULL DEFAULT 0, status text, error_code text
);
