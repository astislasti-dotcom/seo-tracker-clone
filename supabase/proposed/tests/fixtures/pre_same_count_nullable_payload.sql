-- Fixture negativa: 15 columnas correctas, pero payload admite NULL.
CREATE TABLE public.gsc_dimension_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  property_domain text NOT NULL, dimension text NOT NULL, period_days smallint NOT NULL,
  requested_at timestamptz NOT NULL, completed_at timestamptz NOT NULL DEFAULT now(),
  window_start date NOT NULL, window_end date NOT NULL, data_state text NOT NULL,
  aggregation_type text NOT NULL, response_aggregation_type text,
  row_limit integer NOT NULL, row_count integer NOT NULL, truncated boolean NOT NULL,
  payload jsonb
);
