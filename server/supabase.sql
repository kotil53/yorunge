-- Yörünge dünya sıralaması (Supabase / PostgreSQL)
-- Kurulum: Supabase projesinde SQL Editor'e yapıştır ve bir kez çalıştır. Tekrar çalıştırmak güvenli.
--
-- Güvenlik modeli:
--   * Tabloya istemciden doğrudan erişim yok (RLS açık, politika yok, yetkiler geri alındı).
--   * İstemci yalnızca dört fonksiyonu çağırır: submit_score, top_scores, my_rank, around_me.
--   * Her cihaz rastgele bir kimlik (id) ve gizli anahtar (secret) üretir; sunucu yalnızca anahtarın
--     SHA-256 özetini saklar. Bir satırı yalnızca anahtarın sahibi güncelleyebilir.
--   * Yeni oyuncu kaydı IP başına saatte 5 ile sınırlı (new_player_log, IP'nin yalnız özeti, 1 saat).
--   * Supabase Auth üye kaydı kapalı (oyun Auth kullanmıyor); açılırsa anon anahtarla e-posta gönderilebilir.
--   * shortcut: puan istemcide hesaplandığı için hile tamamen engellenemez; makul sınır + hız sınırı var.
--     Sorun çıkarsa sunucu tarafı oyun doğrulaması ya da elle silme (delete from players where ...) gerekir.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.players (
  id          uuid primary key,
  secret_hash text not null,
  name        text not null,
  score       int  not null default 0 check (score >= 0),
  sector      int  not null default 0 check (sector >= 0),
  updated_at  timestamptz not null default now()
);
create unique index if not exists players_name_key on public.players (lower(name));
create index if not exists players_score_idx on public.players (score desc, updated_at asc);

alter table public.players enable row level security;
revoke all on public.players from anon, authenticated;

-- Spam / ad kapmayı sınırlar: IP başına saatte en çok 5 yeni oyuncu. IP'nin kendisi değil, SHA-256 özeti tutulur
-- ve 1 saatten eski satırlar her yeni kayıtta silinir.
create table if not exists public.new_player_log (
  ip_hash text not null,
  at      timestamptz not null default now()
);
create index if not exists new_player_log_idx on public.new_player_log (ip_hash, at);
alter table public.new_player_log enable row level security;
revoke all on public.new_player_log from anon, authenticated;

-- Küfür denetimi için sadeleştirme: küçük harf, sayı-harf oyunları (0→o 1→i 3→e 4→a 5→s 7→t 8→b), Türkçe harfler
-- düz Latin'e, harf dışı her şey (boşluk _ . -) atılır, tekrarlanan harf teke iner. "S.1.k  t1iiir" -> "siktir"
create or replace function public.yorunge_norm(p text) returns text
language sql immutable as $$
  select regexp_replace(
           regexp_replace(translate(lower(p), '0134578ışğüöç', 'oieastbisguoc'), '[^a-z]', '', 'g'),
           '(.)\1+', '\1', 'g');
$$;

-- Takma ad kuralı: 3–16 karakter; harf (Türkçe dahil), rakam, boşluk, _ . -; baş/son boşluk yok; küfür listesi.
-- Liste iki türlü (terimler sadeleştirilmiş biçimde, yani tekrarlı harfler tek yazılır):
--   * uzun / belirgin terimler adın HER YERİNDE aranır (birleşik ve sadeleştirilmiş hâlinde);
--   * kısa terimler yalnız ad (ya da adın bir parçası) tam olarak o kelimeyse engellenir, yoksa masum adları
--     keser ("amin" -> Benjamin, "got" -> Gotham, "nazi" -> Nazım, "rape" -> Grapefruit).
create or replace function public.yorunge_name_ok(p text) returns boolean
language sql immutable as $$
  with n as (select public.yorunge_norm(p) as j)
  select p ~ '^[A-Za-z0-9ÇĞİÖŞÜçğıöşü_. -]{3,16}$'
     and p = btrim(p)
     and p !~ '  '
     and not exists (
       select 1 from n, unnest(array[
         -- Türkçe
         'orospu', 'orosbu', 'orspu', 'siktir', 'sikerim', 'sikeyim', 'sikiyim', 'sikik', 'sikis', 'sikim',
         'amcik', 'amcig', 'aminako', 'aminiz', 'yarak', 'yarag', 'tasak', 'pezeven', 'kahpe', 'kaltak', 'surtuk',
         'fahise', 'yavsak', 'gavat', 'kerhane', 'ibne', 'pust', 'serefsiz', 'gotveren', 'gotlek', 'sapik', 'kancik',
         'dangalak', 'gerizekal', 'salak', 'aptal',
         -- İngilizce (tekrarlı harfler tek: pussy -> pusy, faggot -> fagot)
         'fuck', 'fck', 'shit', 'bitch', 'cunt', 'whore', 'slut', 'pusy', 'fagot', 'porn', 'hitler', 'niger',
         -- kimliğe bürünme
         'admin', 'moderat', 'kotiliy'   -- marka taklidi; "kotil" değil (Kotil / Kotiloğlu soyadlarını engellemesin)
       ]) w
       where n.j like '%' || w || '%'
     )
     and not exists (
       select 1 from n
         cross join lateral (select public.yorunge_norm(x) as t from regexp_split_to_table(p, '[ _.-]+') x
                             union all select n.j) tok
         cross join unnest(array['amk', 'aq', 'got', 'sik', 'pic', 'oc', 'mal', 'dick', 'cock', 'fag', 'sex', 'rape',
                      'nazi', 'niga', 'nigas', 'ass']) w
       where tok.t = w
     );
$$;

-- Puan gönder / adı güncelle. Dönüş: {"ok": true, "rank": n} ya da {"ok": false, "err": "name|taken|owner|rate|range|secret"}
create or replace function public.submit_score(p_id uuid, p_secret text, p_name text, p_score int, p_sector int)
returns json
language plpgsql security definer set search_path = public as $$
declare
  h   text := encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex');
  r   public.players;
  has boolean;
  ip  text;
begin
  if p_id is null or length(coalesce(p_secret, '')) < 32 then return json_build_object('ok', false, 'err', 'secret'); end if;
  p_name := btrim(coalesce(p_name, ''));
  if not public.yorunge_name_ok(p_name) then return json_build_object('ok', false, 'err', 'name'); end if;
  if p_score is null or p_score < 0 or p_score > 100000 or p_sector is null or p_sector < 0 or p_sector > 1000 then
    return json_build_object('ok', false, 'err', 'range');
  end if;

  select * into r from public.players where id = p_id for update;
  has := found;
  if has then
    if r.secret_hash <> h then return json_build_object('ok', false, 'err', 'owner'); end if;
    if r.updated_at > now() - interval '3 seconds' then return json_build_object('ok', false, 'err', 'rate'); end if;
  end if;
  if exists (select 1 from public.players where lower(name) = lower(p_name) and id <> p_id) then
    return json_build_object('ok', false, 'err', 'taken');
  end if;

  if not has then
    -- PostgREST istek başlıkları; ilk adres istemcinin IP'si
    ip := btrim(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1));
    if ip <> '' then
      ip := encode(extensions.digest(ip, 'sha256'), 'hex');
      delete from public.new_player_log where at < now() - interval '1 hour';
      if (select count(*) from public.new_player_log where ip_hash = ip) >= 5 then
        return json_build_object('ok', false, 'err', 'rate');
      end if;
      insert into public.new_player_log (ip_hash) values (ip);
    end if;
  end if;

  begin
    if has then
      update public.players
         set name = p_name,
             sector = case when p_score > score then p_sector else sector end,
             score = greatest(score, p_score),
             updated_at = now()
       where id = p_id;
    else
      insert into public.players (id, secret_hash, name, score, sector) values (p_id, h, p_name, p_score, p_sector);
    end if;
  exception when unique_violation then
    return json_build_object('ok', false, 'err', 'taken');
  end;

  return json_build_object('ok', true, 'rank',
    (select count(*) + 1 from public.players q where q.score > (select score from public.players where id = p_id)));
end $$;

-- İlk N oyuncu (en çok 100). Eşit puanda önce ulaşan üstte; sıra numarası eşitlerde aynı.
create or replace function public.top_scores(p_limit int default 50)
returns table (rank bigint, name text, score int, sector int)
language sql stable security definer set search_path = public as $$
  select rank() over (order by p.score desc), p.name, p.score, p.sector
    from public.players p
   where p.score > 0
   order by p.score desc, p.updated_at asc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- Bu cihazın satırı ve sırası (listede görünmese de)
create or replace function public.my_rank(p_id uuid)
returns table (rank bigint, name text, score int, sector int)
language sql stable security definer set search_path = public as $$
  select (select count(*) + 1 from public.players q where q.score > p.score), p.name, p.score, p.sector
    from public.players p where p.id = p_id;
$$;

-- Oyuncunun çevresi: 3 üstü + kendisi + 2 altı (ör. 53. ise 50–55). Kimlik dönmez, yalnız "me" bayrağı.
-- shortcut: her çağrıda tüm tabloyu sıralar; oyuncu sayısı on binleri geçerse önbellekli sıra tablosuna geç.
create or replace function public.around_me(p_id uuid)
returns table (rank bigint, name text, score int, sector int, me boolean)
language sql stable security definer set search_path = public as $$
  with r as (
    select p.id, p.name, p.score, p.sector,
           rank() over (order by p.score desc) as rk,
           row_number() over (order by p.score desc, p.updated_at asc) as rn
      from public.players p where p.score > 0),
  m as (select rn from r where id = p_id)
  select r.rk, r.name, r.score, r.sector, r.id = p_id
    from r, m where r.rn between m.rn - 3 and m.rn + 2
   order by r.rn;
$$;

revoke all on function public.submit_score(uuid, text, text, int, int) from public;
revoke all on function public.top_scores(int) from public;
revoke all on function public.my_rank(uuid) from public;
revoke all on function public.around_me(uuid) from public;
grant execute on function public.submit_score(uuid, text, text, int, int) to anon, authenticated;
grant execute on function public.top_scores(int) to anon, authenticated;
grant execute on function public.my_rank(uuid) to anon, authenticated;
grant execute on function public.around_me(uuid) to anon, authenticated;
