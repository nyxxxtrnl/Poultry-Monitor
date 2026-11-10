create table if not exists public.sensor_readings (
  id bigint generated always as identity primary key,
  temperature real,
  humidity real,
  sensor_ok boolean not null,
  warning text,
  recorded_at timestamptz not null default now(),
  constraint sensor_readings_measurements_check check (
    (sensor_ok and temperature between -40 and 80 and humidity between 0 and 100)
    or (not sensor_ok and temperature is null and humidity is null)
  )
);

create index if not exists sensor_readings_recorded_at_idx
  on public.sensor_readings (recorded_at desc);

alter table public.sensor_readings enable row level security;
revoke all on public.sensor_readings from anon, authenticated;
revoke all on sequence public.sensor_readings_id_seq from anon, authenticated;
grant all on public.sensor_readings to service_role;
grant usage, select on sequence public.sensor_readings_id_seq to service_role;
