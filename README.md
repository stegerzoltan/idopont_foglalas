# Idopontfoglalas

Egyszeru csoportos edzes idopontfoglalas Node/Express alapon. Publikus ora lista, bejelentkezes nev+email alapjan, admin bejelentkezes, ora kezeles es admin ertesitesi jelzesek.

## Inditas

1. Masold le a kornyezeti valtozok fajlt:

```
cp .env.example .env
```

2. Telepitsd a fuggosegeket:

```
npm install
```

3. Inditsd a szervert:

```
npm start
```

Alapbol a szerver a http://localhost:3000 cimen fut.

## Admin belepes

Az admin belepeshez a `.env` fajlban add meg az `ADMIN_EMAIL` es `ADMIN_PASSWORD` erteket.

## Google Naptar automatikus szinkron

Automatikus naptar-hozzaadas/torles Google Naptarral OAuth kapcsolaton keresztul mukodik.

Szukseges `.env` valtozok:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` (pl. `http://localhost:3000/api/calendar/google/callback`)

Google Cloudban az OAuth kliensnel ezt a redirect URI-t engedelyezni kell.

Ha a felhasznalo nem koti ossze a Google Naptarat, iPhone/Apple eszkozokon a feliratkozasoknal elerheto `iPhone/Apple naptarba` gombbal `.ics` fajlkent hozzaadhato az ora.

## Funkciok

- Publikus ora lista (mobilbarat)
- Felhasznalo bejelentkezes nev + email alapjan
- Feliratkozas jovahagyassal (alapbol pending)
- Admin felulet ora letrehozas, modositas, torles
- Feliratkozasok listazasa admin feluleten (jovahagyas / elutasitas)
- Regisztralt tagok admin szerkesztese (nev, email, szuletesi datum, telefon)
- Regisztralt tag torlese admin feluletrol
- Admin feliratkoztathat orara regisztralt tagot is (nem csak vendeget)
- Admin ertesitesek lista feliratkozas / lemondas / jovahagyas / elutasitas eseten

## Supabase security hardening

Ha Supabase-et hasznalsz `DATABASE_URL`-lal, futtasd le az alabbi SQL scriptet a Supabase SQL Editorben:

```
sql/supabase-security-hardening.sql
```

Vagy futtasd lokalisan egy paranccsal:

```
npm run harden:supabase
```

Render production deploy eseten erosen ajanlott a `DATABASE_URL` beallitasa, hogy a szolgaltatas biztosan PostgreSQL/Supabase adatbazist hasznaljon.

A script:

- bekapcsolja az RLS-t az alkalmazas tablaira,
- visszavonja az `anon` es `authenticated` szerepkorok teljes jogosultsagait,
- es a jovobeni objektumokra is alapbol tiltja ezeket a jogosultsagokat.
