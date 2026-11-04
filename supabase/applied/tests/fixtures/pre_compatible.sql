-- Fixture: tablas PREEXISTENTES con la estructura correcta. La migración debe aceptarlas (no-op).
CREATE TABLE public.gsc_daily_metrics (
  property_domain text NOT NULL CHECK (property_domain IN ('astisl.es', '3av.events')),
  metric_date date NOT NULL,
  clicks integer NOT NULL CHECK (clicks >= 0),
  impressions integer NOT NULL CHECK (impressions >= 0),
  ctr numeric(9,8) CHECK (ctr IS NULL OR (ctr >= 0 AND ctr <= 1)),
  avg_position numeric(8,3) CHECK (avg_position IS NULL OR avg_position >= 0),
  data_state text NOT NULL CHECK (data_state IN ('final', 'provisional')),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_domain, metric_date)
);
CREATE TABLE public.gsc_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_domain text NOT NULL CHECK (property_domain IN ('astisl.es', '3av.events')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  rows_received integer NOT NULL DEFAULT 0 CHECK (rows_received >= 0),
  status text NOT NULL CHECK (status IN ('running', 'ok', 'error')),
  error_code text,
  CHECK (end_date >= start_date),
  CHECK (error_code IS NULL OR status = 'error')
);
-- Simula los privilegios por defecto de Supabase sobre tablas preexistentes: la migración debe retirarlos.
GRANT ALL ON public.gsc_daily_metrics, public.gsc_sync_runs TO anon, authenticated, service_role;
