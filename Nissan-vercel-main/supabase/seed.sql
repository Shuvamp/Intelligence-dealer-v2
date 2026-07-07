-- seed.sql — two demo dealers for isolation testing and the demo.
-- Fixed UUIDs so tests can reference them.

insert into public.tenants (id, name, brand, subscription_plan, status, branding) values
  ('11111111-1111-1111-1111-111111111111', 'ABC Nissan',  'Nissan', 'intelligence', 'active',
     '{"primary_color":"#C3002F","logo_url":null,"theme":"light"}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'XYZ Nissan',  'Nissan', 'growth', 'active',
     '{"primary_color":"#003366","logo_url":null,"theme":"light"}'::jsonb);

insert into public.locations (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ABC Nissan — Velachery'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'ABC Nissan — OMR'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'XYZ Nissan — Anna Nagar');

insert into public.customers (tenant_id, location_id, full_name, phone, email, preferred_vehicle, source_channel) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Ravi Kumar',     '+91-90000-00001', null,                  'Magnite', 'instagram'),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'Priya S',        '+91-90000-00002', 'priya.s@example.in',  'X-Trail', 'website'),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Karthik Raja',   '+91-90000-00004', null,                  'Kicks',   'facebook'),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Deepa Nair',     '+91-90000-00005', 'deepa.n@example.in',  'Magnite', 'walk-in'),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'Suresh Babu',    '+91-90000-00006', null,                  'Terrano', 'oem'),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'Anjali Menon',   '+91-90000-00007', 'anjali.m@example.in', 'X-Trail', 'phone'),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Vimal Chandran', '+91-90000-00008', null,                  'Magnite', 'instagram'),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'Fatima Khan',    '+91-90000-00009', 'fatima.k@example.in', 'Kicks',   'website'),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Gopal Iyer',     '+91-90000-00010', null,                  'Sunny',   'referral'),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'Lakshmi Rao',    '+91-90000-00011', 'lakshmi.r@example.in','X-Trail', 'event'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000001', 'Arun Mehta',     '+91-90000-00003', null,                  'Magnite', 'walkin'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000001', 'Sneha Pillai',   '+91-90000-00012', 'sneha.p@example.in',  'Kicks',   'facebook');

-- Market Intelligence signals feed (tenant-only; AI agents append more later).
insert into public.market_signals (tenant_id, kind, title, detail, metric_label, metric_value, severity, source_module) values
  ('11111111-1111-1111-1111-111111111111', 'demand',      'SUV demand rising in Villupuram',     'Enquiries for compact SUVs are climbing week over week in the Villupuram region.', 'SUV enquiries', '+23% WoW', 'high',   'leads'),
  ('11111111-1111-1111-1111-111111111111', 'opportunity', '5 hot leads pending follow-up',       'Five hot-scored leads have had no contact in over 48 hours — at risk of going cold.', 'Hot leads idle', '5 leads', 'high',   'leads'),
  ('11111111-1111-1111-1111-111111111111', 'trend',       'Magnite is your lead engine',          'The Magnite accounts for the largest share of leads this period.', 'Lead share', '42%', 'medium', 'leads'),
  ('11111111-1111-1111-1111-111111111111', 'intent',      'Instagram shows strongest buying intent', 'Instagram-sourced leads progress to test drive faster than other channels.', 'Best channel', 'Instagram', 'medium', 'marketing'),
  ('11111111-1111-1111-1111-111111111111', 'risk',        'Quotations going stale',               'A couple of quotations have been idle for 5+ days without movement.', 'Idle quotations', '2', 'medium', 'leads'),
  ('11111111-1111-1111-1111-111111111111', 'demand',      'X-Trail premium interest steady',      'Steady high-value enquiries for the X-Trail premium SUV.', 'Avg budget', '₹32L', 'low', 'leads'),
  ('22222222-2222-2222-2222-222222222222', 'demand',      'Kicks launch buzz building',           'Pre-launch interest in the Kicks is trending up at XYZ Nissan.', 'Teaser reach', '21K', 'medium', 'marketing');
