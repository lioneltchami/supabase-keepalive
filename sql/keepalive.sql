-- Minimal read-only table for scheduled Supabase Free activity checks.
CREATE TABLE IF NOT EXISTS public.keepalive (
  id smallint PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT keepalive_single_row CHECK (id = 1)
);

INSERT INTO public.keepalive (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.keepalive ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.keepalive FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.keepalive TO anon;

DROP POLICY IF EXISTS "Allow anon keepalive read" ON public.keepalive;
CREATE POLICY "Allow anon keepalive read"
  ON public.keepalive
  FOR SELECT
  TO anon
  USING (true);
