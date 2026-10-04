# Repararea catalogului video — 4 octombrie 2026

## Mod temporar fără cache pentru API-ul mobil

La solicitarea proprietarului, `/api/premium/video-library` citește acum toate documentele `isPublished == true` direct din `videosVideoModule`, o singură dată per cerere. Nu folosește memoria catalogului, manifestul sau bucățile materializate. Catalogul și metadatele/paginarea folosesc aceeași citire. Răspunsurile pentru conturi și vizitatori au `Cache-Control`, `CDN-Cache-Control` și `Vercel-CDN-Cache-Control` cu `no-store`; `cacheTtlSec` este 0.

Clinic Dashboard și ecranul videotecii folosesc acest endpoint prin `getPublishedVideos`; ecranul categoriei folosește același endpoint cu filtru și cursor. Paginarea, programările, drepturile Premium și formatul răspunsului se păstrează. Fiecare cerere citește întreaga sursă publicată, inclusiv cererile paginilor unei categorii; costul de reads crește pe durata diagnosticului. Cache-ul local al aplicației poate fi folosit în continuare dacă cererea de rețea eșuează.

Verificare locală: 26 teste trecute, inclusiv citire repetată din sursă fără acces la cache, catalog complet și headers `no-store` cu/fără autentificare. Activarea live necesită deploymentul acestei modificări pe Vercel.

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
- Codul vechi al catalogului general poate păstra răspunsul CDN 300 secunde și îl poate servi încă 600 secunde în timpul revalidării. Remedierea păstrează cele 300 secunde de cache partajat, dar elimină cele 600 secunde suplimentare de răspuns vechi. Aplicația mai poate folosi cache-ul local la o eroare de rețea.
- Remedierea permanentă din cod necesită deployment Next.js. Reconstruirea datelor nu actualizează codul Vercel; writerul vechi trebuie înlocuit prin deployment pentru a preveni repetarea.
- Sintaxa modulelor modificate a fost verificată. Nu s-au adăugat sau rulat teste automate, nu s-a făcut build/deployment și nu s-a verificat pe dispozitiv în această intervenție.

- Verificare live după reconstruire: catalogul general cerut cu URL necache-uit returnează 353 videoclipuri / 10 categorii. Categoria zodii: prima pagină 50 din 51; pagina următoare 1, fără alte pagini. URL-ul vechi poate servi încă răspunsul CDN anterior până la expirare/redeployment.

- Confirmare finală pe URL-ul exact folosit de aplicație (`locale=ro&appPlatform=android`, fără parametru de diagnostic): 353 videoclipuri, 10 categorii; CDN-ul servește acum răspunsul complet. Categoria zodii include 51. Generația finală verificată: `fa90b1ed-43ba-49d2-a38b-a2134e399910`, 27 bucăți, cu semnătura sursei.
