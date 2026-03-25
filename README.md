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

## Funkciok

- Publikus ora lista (mobilbarat)
- Felhasznalo bejelentkezes nev + email alapjan
- Feliratkozas jovahagyassal (alapbol pending)
- Admin felulet ora letrehozas, modositas, torles
- Feliratkozasok listazasa admin feluleten (jovahagyas / elutasitas)
- Regisztralt tagok admin szerkesztese (nev, email, szuletesi datum, telefon, jelszo)
- Regisztralt tag torlese admin feluletrol
- Admin feliratkoztathat orara regisztralt tagot is (nem csak vendeget)
- Admin ertesitesek lista feliratkozas / lemondas / jovahagyas / elutasitas eseten
