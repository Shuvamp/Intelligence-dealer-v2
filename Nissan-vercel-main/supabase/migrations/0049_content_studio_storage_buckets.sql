insert into storage.buckets (id, name, public)
values ('posters', 'posters', true), ('videos', 'videos', true)
on conflict (id) do nothing;
