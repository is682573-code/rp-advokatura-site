-- ══════════════════════════════════════════════════════════
--  Создать первого администратора
--  Выполнять после schema.sql
-- ══════════════════════════════════════════════════════════

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

  v_key :=
    replace(gen_random_uuid()::text, '-', '') ||
    replace(gen_random_uuid()::text, '-', '');

  v_hash := encode(sha256(convert_to(v_key, 'UTF8'::name)), 'hex');

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
