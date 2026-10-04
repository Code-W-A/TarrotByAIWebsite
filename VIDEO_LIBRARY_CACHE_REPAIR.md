# Repararea catalogului video — 4 octombrie 2026

## Ce se schimbă

Doar backendul Next.js și instrumentul administrativ de reconstruire. Aplicația mobilă, URL-urile, câmpurile DTO și paginarea rămân compatibile. Drepturile Premium, programările și regulile pentru sursele video continuă să fie aplicate la fiecare răspuns.

- Fiecare reconstruire citește toate documentele publicate și scrie bucăți cu identificatori unici de generație. Nu suprascrie catalogul activ.
- Verifică bucățile salvate: număr, identificatori unici, hash-ul identificatorilor, indici, generație, videoclipuri featured și `isPublished`.
- Manifestul este activat într-o tranzacție după verificare. O reconstruire mai veche nu poate suprascrie una mai nouă deja publicată.
- Cititorul verifică aceleași condiții și reconstruiește un catalog inconsistent. Un eșec nu înlocuiește catalogul complet din memoria serverului cu rezultate parțiale.
- Manifestul rămâne verificat la 30 secunde implicit. Bucățile se recitesc doar când versiunea se schimbă / instanța pornește.
- O verificare de siguranță la 5 minute folosește numărul documentelor publicate și ultima modificare `updatedAt`, fără citirea întregii colecții. Detectează și modificările pentru care callbackul dashboardului nu a reconstruit cache-ul. Editările administrative trebuie să continue să seteze `updatedAt`.
- Rebuildul explicit nu golește memoria înainte de succes. Manifestul păstrează descriptorul generației anterioare.

## Comenzi

Din `next-js`, cu configurația Firebase Admin locală (nu imprimați cheile):

```sh
node scripts/rebuild-video-library-cache.cjs          # inventar, numai citire
node scripts/rebuild-video-library-cache.cjs --apply  # reconstruire + verificare + activare
node scripts/rebuild-video-library-cache.cjs --prune  # întreținere: generații vechi >24h
```

Cleanup-ul păstrează generația activă și precedenta și verifică manifestul în tranzacție înainte de ștergere. Nu atinge documentele video sursă sau cache-urile altor funcționalități. Nu este executat la fiecare cerere sau editare; se poate rula periodic pentru a evita acumularea versiunilor și costul de stocare. Nu a fost rulat în producție în această intervenție.

## Dovezi și activare

- Înainte: categoria „TAROT HOROSCOP 2026 PE ZODII” avea 51 documente publicate în sursă, API-ul returna 1. Manifestul declara 340 rânduri, bucățile erau incomplete.
- Inventarul sursei la reconstruire: 353 videoclipuri publicate, în 10 categorii cu conținut. Categoriile fără videoclipuri eligibile nu primesc conținut inventat.
- Prima reconstruire live a publicat o generație verificată cu 353 videoclipuri / 27 bucăți. API-ul categoriei a returnat 50 din 51, cu cursor și `hasMore:true`.
- Catalogul general poate păstra răspunsul vechi până la expirarea cache-ului CDN (300 secunde). Aplicația mai poate folosi cache-ul local la o eroare de rețea.
- Remedierea permanentă din cod necesită deployment Next.js. Reconstruirea datelor nu actualizează codul Vercel; writerul vechi trebuie înlocuit prin deployment pentru a preveni repetarea.
- Sintaxa modulelor modificate a fost verificată. Nu s-au adăugat sau rulat teste automate, nu s-a făcut build/deployment și nu s-a verificat pe dispozitiv în această intervenție.
