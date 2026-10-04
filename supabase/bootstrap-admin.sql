do $$
declare
  v_key text;
  v_hash text;
begin
  if exists (
    select 1
    from public.profiles
    where role = 'admin'
  ) or exists (
    select 1
    from public.access_keys
    where role = 'admin'
      and revoked_at is null
  ) then
    raise exception 'Администратор или админский ключ уже существует. Не запускай этот скрипт повторно без необходимости.';
  end if;

  v_key := encode(gen_random_bytes(24), 'hex');
  v_hash := encode(digest(v_key, 'sha256'), 'hex');

  insert into public.access_keys (
    key_hash,
    role,
    display_name,
    reg_number,
    label,
    max_uses
  )
  values (
    v_hash,
    'admin',
    'Администратор RP',
    null,
    'Первый администратор',
    1
  );

  raise notice 'ADMIN_KEY: %', v_key;
end $$;
