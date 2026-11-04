-- Fixture NEGATIVA: mismas columnas pero sin clave primaria. Debe abortar la preflight.
CREATE TABLE public.gsc_daily_metrics (
  property_domain text NOT NULL, metric_date date NOT NULL,
  clicks integer NOT NULL, impressions integer NOT NULL, ctr numeric(9,8), avg_position numeric(8,3),
  data_state text NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now()
);
