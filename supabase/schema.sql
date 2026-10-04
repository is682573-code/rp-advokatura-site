-- ══════════════════════════════════════════════════════════
--  RP АДВОКАТУРА — исправленная бесплатная схема
--  Без pgcrypto, без pg_trgm, без digest()
--  Вход по ключам, без настоящей почты
-- ══════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════
--  1. ПРОФИЛИ ПОЛЬЗОВАТЕЛЕЙ
-- ══════════════════════════════════════════════════════════

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  reg_number   text,
  role         text not null default 'lawyer'
               check (role in ('admin', 'lawyer', 'employee')),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is 'Профили пользователей системы';
comment on column public.profiles.display_name is 'Имя в формате: Пригожин Е. В.';
comment on column public.profiles.reg_number is 'Регистрационный номер адвоката';

create unique index if not exists profiles_reg_number_unique
  on public.profiles (lower(reg_number))
  where reg_number is not null;

create index if not exists profiles_display_name_idx
  on public.profiles (display_name);

create index if not exists profiles_reg_number_idx
  on public.profiles (reg_number);

-- ══════════════════════════════════════════════════════════
--  2. КЛЮЧИ ДОСТУПА
-- ══════════════════════════════════════════════════════════

create table if not exists public.access_keys (
  id            uuid primary key default gen_random_uuid(),
  key_hash      text unique not null,
  label         text,
  role          text not null
                check (role in ('admin', 'lawyer', 'employee')),
  display_name  text not null,
  reg_number    text,
  max_uses      int not null default 1 check (max_uses > 0),
  used_count    int not null default 0 check (used_count >= 0),
  expires_at    timestamptz,
  revoked_at    timestamptz,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  last_used_by  uuid references public.profiles(id) on delete set null,

  constraint access_keys_lawyer_requires_reg_number
    check (
      role <> 'lawyer'
      or (display_name is not null and reg_number is not null)
    )
);

comment on table public.access_keys is 'Ключи доступа вместо email/регистрации';
comment on column public.access_keys.key_hash is 'SHA-256 хеш секретного ключа';
comment on column public.access_keys.display_name is 'Имя, которое получит пользователь при активации ключа';
comment on column public.access_keys.reg_number is 'Регистрационный номер адвоката, если роль lawyer';

-- ══════════════════════════════════════════════════════════
--  3. ЛОГИ ВХОДОВ
-- ══════════════════════════════════════════════════════════

create table if not exists public.login_logs (
  id            bigserial primary key,
  user_id       uuid references public.profiles(id) on delete set null,
  display_name  text,
  role          text,
  key_label     text,
  login_at      timestamptz not null default now()
);

-- ══════════════════════════════════════════════════════════
--  4. ДЕЛА
-- ══════════════════════════════════════════════════════════

create table if not exists public.cases (
  id                 uuid primary key default gen_random_uuid(),
  case_number        text not null unique,
  title              text not null,
  client_name        text,
  description        text,
  status             text not null default 'open'
                     check (status in ('open', 'in_work', 'closed', 'archived')),
  assigned_lawyer_id uuid references public.profiles(id) on delete set null,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists cases_assigned_lawyer_idx
  on public.cases (assigned_lawyer_id);

create index if not exists cases_created_by_idx
  on public.cases (created_by);

-- ══════════════════════════════════════════════════════════
--  5. ОРДЕРА
-- ══════════════════════════════════════════════════════════

create table if not exists public.orders (
  id           uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  case_id      uuid references public.cases(id) on delete set null,
  lawyer_id    uuid references public.profiles(id) on delete set null,
  order_type   text,
  issued_at    date,
  content      text,
  file_path    text,
  file_name    text,
  file_size    bigint,
  mime_type    text,
  status       text not null default 'draft'
               check (status in ('draft', 'active', 'closed', 'cancelled')),
  is_public    boolean not null default false,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists orders_lawyer_idx
  on public.orders (lawyer_id);

create index if not exists orders_case_idx
  on public.orders (case_id);

create index if not exists orders_created_by_idx
  on public.orders (created_by);

-- ══════════════════════════════════════════════════════════
--  6. ФОТО
-- ══════════════════════════════════════════════════════════

create table if not exists public.photos (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid references public.cases(id) on delete cascade,
  order_id   uuid references public.orders(id) on delete cascade,
  file_path  text not null,
  file_name  text,
  caption    text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists photos_case_idx
  on public.photos (case_id);

create index if not exists photos_order_idx
  on public.photos (order_id);

-- ══════════════════════════════════════════════════════════
--  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
-- ══════════════════════════════════════════════════════════

create or replace function public.normalize_name(p_name text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
$$;

create or replace function public.is_valid_display_name(p_name text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    p_name is not null
    and char_length(p_name) between 2 and 120
    and p_name ~ $rx$^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё .'’-]{1,119}$rx$;
$$;

create or replace function public.is_valid_reg_number(p_reg text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    p_reg is not null
    and p_reg ~ $rx$^[A-Za-zА-Яа-яЁё0-9/.\- ]{3,80}$rx$;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and is_active = true
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'lawyer', 'employee')
      and is_active = true
  );
$$;

create or replace function public.is_office()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'employee')
      and is_active = true
  );
$$;

grant execute on function public.normalize_name(text) to anon, authenticated;
grant execute on function public.is_valid_display_name(text) to anon, authenticated;
grant execute on function public.is_valid_reg_number(text) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.is_office() to anon, authenticated;

-- ══════════════════════════════════════════════════════════
--  RLS
-- ══════════════════════════════════════════════════════════

alter table public.profiles      enable row level security;
alter table public.access_keys   enable row level security;
alter table public.login_logs    enable row level security;
alter table public.cases         enable row level security;
alter table public.orders        enable row level security;
alter table public.photos        enable row level security;

-- ──────────────────────────────────────────────────────────
-- Профили
-- Публично видны только активные адвокаты.
-- Свой профиль видит владелец.
-- Админ видит всех.
-- ──────────────────────────────────────────────────────────

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select"
on public.profiles
for select
using (
  (role = 'lawyer' and is_active = true)
  or auth.uid() = id
  or public.is_admin()
);

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update"
on public.profiles
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- ──────────────────────────────────────────────────────────
-- Ключи доступа: только админ
-- ──────────────────────────────────────────────────────────

drop policy if exists "access_keys_admin_all" on public.access_keys;
create policy "access_keys_admin_all"
on public.access_keys
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- ──────────────────────────────────────────────────────────
-- Логи: читать может только админ
-- Вставка происходит через security definer функцию
-- ──────────────────────────────────────────────────────────

drop policy if exists "login_logs_admin_select" on public.login_logs;
create policy "login_logs_admin_select"
on public.login_logs
for select
to authenticated
using (public.is_admin());

-- ──────────────────────────────────────────────────────────
-- Дела
-- ──────────────────────────────────────────────────────────

drop policy if exists "cases_select" on public.cases;
create policy "cases_select"
on public.cases
for select
to authenticated
using (
  public.is_office()
  or assigned_lawyer_id = auth.uid()
  or created_by = auth.uid()
);

drop policy if exists "cases_insert" on public.cases;
create policy "cases_insert"
on public.cases
for insert
to authenticated
with check (
  public.is_staff()
);

drop policy if exists "cases_update" on public.cases;
create policy "cases_update"
on public.cases
for update
to authenticated
using (
  public.is_office()
  or assigned_lawyer_id = auth.uid()
  or created_by = auth.uid()
)
with check (
  public.is_office()
  or assigned_lawyer_id = auth.uid()
  or created_by = auth.uid()
);

drop policy if exists "cases_delete" on public.cases;
create policy "cases_delete"
on public.cases
for delete
to authenticated
using (
  public.is_office()
);

-- ──────────────────────────────────────────────────────────
-- Ордера
-- ──────────────────────────────────────────────────────────

drop policy if exists "orders_select" on public.orders;
create policy "orders_select"
on public.orders
for select
to authenticated
using (
  public.is_office()
  or lawyer_id = auth.uid()
  or created_by = auth.uid()
  or exists (
    select 1
    from public.cases c
    where c.id = orders.case_id
      and (
        c.assigned_lawyer_id = auth.uid()
        or c.created_by = auth.uid()
      )
  )
);

drop policy if exists "orders_insert" on public.orders;
create policy "orders_insert"
on public.orders
for insert
to authenticated
with check (
  public.is_staff()
);

drop policy if exists "orders_update" on public.orders;
create policy "orders_update"
on public.orders
for update
to authenticated
using (
  public.is_office()
  or lawyer_id = auth.uid()
  or created_by = auth.uid()
)
with check (
  public.is_office()
  or lawyer_id = auth.uid()
  or created_by = auth.uid()
);

drop policy if exists "orders_delete" on public.orders;
create policy "orders_delete"
on public.orders
for delete
to authenticated
using (
  public.is_office()
  or created_by = auth.uid()
);

-- ──────────────────────────────────────────────────────────
-- Фото
-- ──────────────────────────────────────────────────────────

drop policy if exists "photos_select" on public.photos;
create policy "photos_select"
on public.photos
for select
to authenticated
using (
  public.is_office()
  or created_by = auth.uid()
  or exists (
    select 1
    from public.cases c
    where c.id = photos.case_id
      and (
        c.assigned_lawyer_id = auth.uid()
        or c.created_by = auth.uid()
      )
  )
  or exists (
    select 1
    from public.orders o
    where o.id = photos.order_id
      and (
        o.lawyer_id = auth.uid()
        or o.created_by = auth.uid()
      )
  )
);

drop policy if exists "photos_insert" on public.photos;
create policy "photos_insert"
on public.photos
for insert
to authenticated
with check (
  public.is_staff()
);

drop policy if exists "photos_delete" on public.photos;
create policy "photos_delete"
on public.photos
for delete
to authenticated
using (
  public.is_office()
  or created_by = auth.uid()
);

-- ══════════════════════════════════════════════════════════
--  STORAGE BUCKETS
--  Если запрос не пройдет, создай buckets вручную в Dashboard:
--  orders private, photos private
-- ══════════════════════════════════════════════════════════

do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'orders',
    'orders',
    false,
    10485760,
    array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/webp'
    ]::text[]
  )
  on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'photos',
    'photos',
    false,
    10485760,
    array[
      'image/jpeg',
      'image/png',
      'image/webp'
    ]::text[]
  )
  on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

exception when others then
  raise notice 'Не удалось автоматически создать/обновить buckets. Создайте вручную в Supabase Storage: orders и photos, private, max 10MB.';
end $$;

-- ══════════════════════════════════════════════════════════
--  STORAGE POLICIES
-- ══════════════════════════════════════════════════════════

drop policy if exists "storage_orders_photos_select" on storage.objects;
create policy "storage_orders_photos_select"
on storage.objects
for select
to authenticated
using (
  bucket_id in ('orders', 'photos')
  and public.is_staff()
);

drop policy if exists "storage_orders_photos_insert" on storage.objects;
create policy "storage_orders_photos_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id in ('orders', 'photos')
  and public.is_staff()
);

drop policy if exists "storage_orders_photos_delete" on storage.objects;
create policy "storage_orders_photos_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id in ('orders', 'photos')
  and (
    public.is_office()
    or owner = auth.uid()
  )
);

-- ══════════════════════════════════════════════════════════
--  ХЕШИРОВАНИЕ КЛЮЧА БЕЗ pgcrypto
-- ══════════════════════════════════════════════════════════

create or replace function public.hash_access_key(p_key text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select encode(sha256(convert_to(p_key, 'UTF8'::name)), 'hex');
$$;

grant execute on function public.hash_access_key(text) to anon, authenticated;

-- ══════════════════════════════════════════════════════════
--  ГЕНЕРАЦИЯ КЛЮЧА БЕЗ gen_random_bytes
-- ══════════════════════════════════════════════════════════

create or replace function public.generate_access_key()
returns text
language sql
volatile
set search_path = public, pg_temp
as $$
  select
    replace(gen_random_uuid()::text, '-', '') ||
    replace(gen_random_uuid()::text, '-', '');
$$;

grant execute on function public.generate_access_key() to authenticated;

-- ══════════════════════════════════════════════════════════
--  ПРОВЕРКА НОВОГО КЛЮЧА ПЕРЕД СОЗДАНИЕМ AUTH-ПОЛЬЗОВАТЕЛЯ
-- ══════════════════════════════════════════════════════════

create or replace function public.validate_new_access_key(p_key text)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_hash text;
  v_exists boolean;
begin
  v_hash := public.hash_access_key(trim(coalesce(p_key, '')));

  select exists (
    select 1
    from public.access_keys
    where key_hash = v_hash
      and revoked_at is null
      and (expires_at is null or expires_at > now())
      and used_count < max_uses
  )
  into v_exists;

  if not v_exists then
    return json_build_object(
      'success', false,
      'error', 'Неверный, отозванный, истёкший или уже использованный ключ'
    );
  end if;

  return json_build_object('success', true);
end;
$$;

grant execute on function public.validate_new_access_key(text) to anon;

-- ══════════════════════════════════════════════════════════
--  ВЫДАЧА КЛЮЧА АДМИНИСТРАТОРОМ
-- ══════════════════════════════════════════════════════════

create or replace function public.issue_access_key(
  p_role text,
  p_display_name text,
  p_reg_number text default null,
  p_label text default null,
  p_expires_at timestamptz default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_key text;
  v_hash text;
  v_name text;
  v_reg text;
begin
  if not public.is_admin() then
    return json_build_object(
      'success', false,
      'error', 'Только администратор может выдавать ключи'
    );
  end if;

  if p_role not in ('admin', 'lawyer', 'employee') then
    return json_build_object('success', false, 'error', 'Недопустимая роль');
  end if;

  v_name := public.normalize_name(p_display_name);

  if not public.is_valid_display_name(v_name) then
    return json_build_object(
      'success', false,
      'error', 'Некорректное имя. Пример правильного формата: Пригожин Е. В.'
    );
  end if;

  if p_role = 'lawyer' then
    v_reg := trim(coalesce(p_reg_number, ''));

    if v_reg = '' then
      return json_build_object(
        'success', false,
        'error', 'Для адвоката обязателен регистрационный номер'
      );
    end if;

    if not public.is_valid_reg_number(v_reg) then
      return json_build_object('success', false, 'error', 'Некорректный регистрационный номер');
    end if;

    if exists (
      select 1
      from public.profiles
      where lower(reg_number) = lower(v_reg)
    ) then
      return json_build_object(
        'success', false,
        'error', 'Такой регистрационный номер уже занят в профилях'
      );
    end if;

    if exists (
      select 1
      from public.access_keys
      where role = 'lawyer'
        and lower(reg_number) = lower(v_reg)
        and revoked_at is null
    ) then
      return json_build_object(
        'success', false,
        'error', 'Такой регистрационный номер уже закреплен за активным ключом'
      );
    end if;
  else
    v_reg := null;
  end if;

  v_key := public.generate_access_key();
  v_hash := public.hash_access_key(v_key);

  while exists (
    select 1
    from public.access_keys
    where key_hash = v_hash
  ) loop
    v_key := public.generate_access_key();
    v_hash := public.hash_access_key(v_key);
  end loop;

  insert into public.access_keys (
    key_hash,
    label,
    role,
    display_name,
    reg_number,
    max_uses,
    expires_at,
    created_by
  )
  values (
    v_hash,
    p_label,
    p_role,
    v_name,
    v_reg,
    1,
    p_expires_at,
    auth.uid()
  );

  return json_build_object(
    'success', true,
    'key', v_key,
    'role', p_role,
    'display_name', v_name,
    'reg_number', v_reg,
    'label', p_label
  );
end;
$$;

grant execute on function public.issue_access_key(text, text, text, text, timestamptz)
to authenticated;

-- ══════════════════════════════════════════════════════════
--  АКТИВАЦИЯ / ПРОВЕРКА ПРОФИЛЯ ПО КЛЮЧУ
-- ══════════════════════════════════════════════════════════

create or replace function public.register_profile_with_key(p_key text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_uid uuid;
  v_hash text;
  v_key_rec public.access_keys%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
begin
  v_uid := auth.uid();

  if v_uid is null then
    return json_build_object(
      'success', false,
      'error', 'Нет активной сессии. Сначала выполните вход по ключу.'
    );
  end if;

  v_hash := public.hash_access_key(trim(coalesce(p_key, '')));

  select *
  into v_key_rec
  from public.access_keys
  where key_hash = v_hash
    and revoked_at is null
    and (expires_at is null or expires_at > now())
  limit 1
  for update;

  if not found then
    return json_build_object(
      'success', false,
      'error', 'Ключ неверный, отозван или истёк'
    );
  end if;

  -- Если профиль уже существует, проверяем активность и логируем вход.
  if exists (select 1 from public.profiles where id = v_uid) then
    select *
    into v_profile
    from public.profiles
    where id = v_uid;

    if not v_profile.is_active then
      return json_build_object(
        'success', false,
        'error', 'Профиль отключен администратором'
      );
    end if;

    update public.access_keys
    set
      last_used_by = v_uid,
      last_used_at = now()
    where id = v_key_rec.id;

    insert into public.login_logs (
      user_id,
      display_name,
      role,
      key_label
    )
    values (
      v_uid,
      v_profile.display_name,
      v_profile.role,
      v_key_rec.label
    );

    return json_build_object(
      'success', true,
      'already_registered', true,
      'profile', row_to_json(v_profile)
    );
  end if;

  -- Первая активация ключа.
  if v_key_rec.used_count >= v_key_rec.max_uses then
    return json_build_object(
      'success', false,
      'error', 'Ключ уже использован'
    );
  end if;

  if v_key_rec.role = 'lawyer' then
    if exists (
      select 1
      from public.profiles
      where lower(reg_number) = lower(v_key_rec.reg_number)
    ) then
      return json_build_object(
        'success', false,
        'error', 'Регистрационный номер уже занят другим адвокатом'
      );
    end if;
  end if;

  insert into public.profiles (
    id,
    display_name,
    reg_number,
    role
  )
  values (
    v_uid,
    v_key_rec.display_name,
    v_key_rec.reg_number,
    v_key_rec.role
  )
  returning *
  into v_profile;

  update public.access_keys
  set
    used_count = used_count + 1,
    last_used_by = v_uid,
    last_used_at = now()
  where id = v_key_rec.id;

  insert into public.login_logs (
    user_id,
    display_name,
    role,
    key_label
  )
  values (
    v_uid,
    v_profile.display_name,
    v_profile.role,
    v_key_rec.label
  );

  return json_build_object(
    'success', true,
    'already_registered', false,
    'profile', row_to_json(v_profile)
  );
end;
$$;

grant execute on function public.register_profile_with_key(text)
to authenticated;

-- ══════════════════════════════════════════════════════════
--  ПУБЛИЧНЫЙ ПОИСК АДВОКАТОВ
-- ══════════════════════════════════════════════════════════

create or replace function public.search_public_lawyers(
  p_query text default null,
  p_limit int default 50
)
returns table (
  lawyer_id uuid,
  display_name text,
  reg_number text,
  public_orders_count bigint,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_q text;
  v_limit int;
begin
  v_q := trim(coalesce(p_query, ''));
  v_limit := coalesce(p_limit, 50);

  if v_limit < 1 then
    v_limit := 50;
  end if;

  if v_limit > 200 then
    v_limit := 200;
  end if;

  return query
  select
    p.id,
    p.display_name,
    p.reg_number,
    (
      select count(*)
      from public.orders o
      where o.lawyer_id = p.id
        and o.is_public = true
    ) as public_orders_count,
    p.created_at
  from public.profiles p
  where p.role = 'lawyer'
    and p.is_active = true
    and (
      v_q = ''
      or p.reg_number ilike '%' || v_q || '%'
      or p.display_name ilike '%' || v_q || '%'
    )
  order by p.display_name
  limit v_limit;
end;
$$;

grant execute on function public.search_public_lawyers(text, int)
to anon, authenticated;

-- ══════════════════════════════════════════════════════════
--  ПОЛУЧЕНИЕ ОРДЕРОВ АДВОКАТА
--  Анониму и чужому адвокату показывает только публичные ордера.
--  Office/admin и самому адвокату показывает полные данные.
-- ══════════════════════════════════════════════════════════

create or replace function public.get_lawyer_orders(
  p_lawyer_id uuid,
  p_limit int default 100
)
returns table (
  order_id uuid,
  order_number text,
  case_id uuid,
  case_number text,
  order_type text,
  issued_at date,
  status text,
  file_name text,
  file_size bigint,
  mime_type text,
  file_path text,
  can_view_file boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_uid uuid;
  v_office boolean;
  v_limit int;
begin
  v_uid := auth.uid();
  v_office := public.is_office();
  v_limit := coalesce(p_limit, 100);

  if v_limit < 1 then
    v_limit := 100;
  end if;

  if v_limit > 500 then
    v_limit := 500;
  end if;

  -- Если это не office и не свой адвокат, показываем только публичные ордера.
  if not v_office and (v_uid is null or p_lawyer_id <> v_uid) then
    return query
    select
      o.id,
      o.order_number,
      o.case_id,
      c.case_number,
      o.order_type,
      o.issued_at,
      o.status,
      o.file_name,
      o.file_size,
      o.mime_type,
      null::text as file_path,
      false as can_view_file
    from public.orders o
    left join public.cases c on c.id = o.case_id
    where o.lawyer_id = p_lawyer_id
      and o.is_public = true
    order by o.created_at desc
    limit v_limit;
    return;
  end if;

  -- Office/admin или адвокат смотрит свои ордера — полные данные.
  return query
  select
    o.id,
    o.order_number,
    o.case_id,
    c.case_number,
    o.order_type,
    o.issued_at,
    o.status,
    o.file_name,
    o.file_size,
    o.mime_type,
    o.file_path,
    true as can_view_file
  from public.orders o
  left join public.cases c on c.id = o.case_id
  where o.lawyer_id = p_lawyer_id
  order by o.created_at desc
  limit v_limit;
end;
$$;

grant execute on function public.get_lawyer_orders(uuid, int)
to anon, authenticated;
