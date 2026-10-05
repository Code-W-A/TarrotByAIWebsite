# Ebookuri: configurare și activare

Implementare: Sanity Studio separat, Next.js API, Firebase UID comun și Stripe pe site și în aplicație. Citirea este online; traducerile sunt manuale. Codul nu creează conturi sau abonamente externe și nu activează producția.

## Sanity

### Configurația creată la 3 octombrie 2026

- Proiect: **Cristina Zurba Ebookuri**, `rvz9v34h`; organizație `of0hkcpw2`.
- Dataset `production`: **privat**, verificat prin API autentificat; momentan fără cărți.
- Token server **Viewer**, doar citire, salvat în `.env.local` ignorat de Git. Nu este inclus în bundle-ul Studio.
- CORS cu credentials: `https://www.cristinazurba.com` și `http://localhost:3000`.
- Proiectul este pe **Growth Trial de 30 de zile**, fără abonament plătit activat. Continuitatea datasetului privat trebuie verificată înainte de expirarea trialului.
- Flagurile ebookurilor rămân dezactivate. Configurația Vercel va fi făcută manual de proprietar; webhookurile și activarea sunt încă în așteptare. Studio a fost construit și verificat în Chrome, autentificat cu contul Cristina Zurba, la `http://localhost:3000/ebook-studio/structure/cartiSiEditii`.

### Pașii de activare

1. Creați proiectul, alegeți Growth și creați un dataset **privat**. Planul Free permite doar dataseturi publice; Growth permite dataseturi private ([planurile Sanity](https://www.sanity.io/pricing)). Configurați membrii Studio; dashboardul și Studio au autentificări separate.
2. Setați `SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_READ_TOKEN` numai în mediul serverului. Tokenul trebuie să poată lista dataseturile pentru verificarea `aclMode` și să citească documentele/preview. Nu folosiți `NEXT_PUBLIC_` pentru token.
3. Instalați separat Studio: `npm ci --prefix ebook-studio`. `npm run build` construiește Studio în `public/ebook-studio`, apoi site-ul. React-ul site-ului rămâne la versiunea existentă. Fără configurație, buildul creează o pagină informativă.
4. Adăugați originile site-ului în Sanity CORS pentru Studio și permiteți credentials. Fișierele Studio sunt servite din `/ebook-studio/`; editorul se deschide la `/dashboard/ebooks`.
5. Configurați webhook Sanity POST `/api/ebooks/sanity-webhook`, la creare/modificare/ștergere, filtrul `_type in ["ebook", "ebookEdition"]`, proiecția `{_id,_type}`, secretul `SANITY_EBOOK_WEBHOOK_SECRET`. Backendul verifică semnătura și recitește metadata publicată; nu persistă manuscrisele în Firestore.
6. Creați cartea și publicați metadata, apoi ediția RO. Publicați celelalte limbi când sunt gata. Folosiți „Previzualizează în site” pentru drafturi și „Sincronizează catalogul” dacă webhookul nu a fost instalat încă.

Capitolele păstrează `_key` generat de Studio la editare/reordonare; nu ștergeți și recreați capitole doar pentru corecturi. Pentru traduceri puteți copia structura capitolelor și înlocui textul. Progresul este separat pe limbă. Arhivarea cărții păstrează lectura pentru cumpărători; ștergerea și unpublish sunt dezactivate în Studio pentru aceste tipuri. Validatorul împiedică eliminarea capitolelor deja publicate.

**Imaginile standard Sanity sunt publice prin URL, inclusiv într-un dataset privat.** Alegerea acceptată este text privat + imagini CDN. Protecția nu împiedică fotografierea sau extragerea textului de pe dispozitivul unui cumpărător.

## Stripe și facturare
- Folosește `STRIPE_SECRET_KEY`, `STRIPE_FIXED_VAT_TAX_RATE_ID`, `NEXT_PUBLIC_SITE_URL` și setarea TVA existente. Prețul din Studio este net, ca la cursuri; catalogul și checkoutul afișează/adaugă TVA conform setărilor existente.
- Checkoutul folosește formularul de facturare existent și normalizarea server. Factura Oblio folosește aceleași utilitare fiscale și politica e-Factura ca la cursuri. Dacă serviciul lipsește sau răspunsul este ambiguu, plata rămâne validă și factura este marcată `pending_manual` în `payments`, fără retry extern care poate dubla factura.
- Configurați un endpoint **separat** `/api/ebooks/stripe-webhook` pentru `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, cu `STRIPE_EBOOK_WEBHOOK_SECRET`.
- `EBOOKS_STRIPE_ENABLED=true` activează checkoutul. Confirmarea succesului din URL nu acordă acces. Doar webhookul semnat acordă acces.

## Stripe în aplicația mobilă

- Prețul și moneda vin din metadata publicată în Sanity, identic cu site-ul. Prețul afișat include TVA; serverul recitește prețul net publicat înainte de fiecare checkout. O modificare se aplică sesiunilor noi, fără să schimbe suma unei sesiuni deja create.
- Aplicația folosește `CourseCheckoutBillingForm` și Stripe Checkout într-un WebView, ca la cursuri. Cererea `POST /api/ebooks/{id}/checkout` include `billingDetails` și `platform: "ios" | "android"`; headerul `x-app-platform` identifică de asemenea platforma.
- Răspunsul este `{url, returnUrlBase}`. URL-urile de succes/anulare sunt generate exclusiv de server, pe domeniul site-ului, pentru cartea curentă. Aplicația recunoaște doar revenirea la acel URL și verifică accesul prin API. Revenirea cu `checkout=success` nu acordă acces.
- `GET /api/ebooks/config` expune `websiteBilling` și `mobileBilling: {web, android, ios}`. Butonul de plată este dezactivat când checkoutul nu este configurat.
- Plata ebookurilor pe iOS are setarea proprie `settings/global.iosEbooksStripeEnabled`, implicit `false`. Se activează separat din `/administrare/setari` → „Plăți ebookuri pe iOS”. Nu depinde de `iosCoursesHidden`. Dacă setările nu pot fi citite, plata iOS este blocată. Backendul verifică atât platforma din corp, cât și headerul; citirea cărților deja cumpărate rămâne disponibilă. Cache-ul setărilor poate întârzia propagarea până la 5 minute.
- Ebookurile nu au produse Apple/Google, confirmare RevenueCat sau restaurare prin magazine. După reinstalare, autentificarea în același cont încarcă automat „Cărțile mele”. Fluxurile RevenueCat existente pentru alte produse rămân separate.

## Firebase, UI și rollout
- Noile colecții `ebookRegistry`, `ebookTransactions`, `ebookPaymentEvents`, `ebookCheckouts`, `ebookStripePayments`, `users/{uid}/ebookAccess`, `users/{uid}/ebookProgress` sunt server-only. Fragmentele sunt în `expo-mobile-app/firestore.rules`: **integrați** regulile în regulile reale, nu înlocuiți producția cu acel fișier fragment. Verificați că regulile wildcard existente nu permit scrieri în colecțiile noi.
- Activați `EBOOKS_ENABLED=true` numai cu dataset privat și configurație server. UI: `NEXT_PUBLIC_EBOOKS_ENABLED=true` pe site și `EXPO_PUBLIC_EBOOKS_ENABLED=true` în aplicație.
- API: catalog `/api/ebooks`, detalii `/{id}`, proprietate `/purchased`, capitol `/{id}/chapters/{chapterId}`, progres GET/PUT `/{id}/progress`, checkout `/{id}/checkout`. `locale` selectează ediția publicată sau RO. Metadatele nu conțin textul capitolelor.
- Pages: `/ebooks`, `/ebooks/mine`, `/ebooks/{id}`, `/ebooks/{id}/read`. Ecranul principal mobil oferă intrare în catalog.
- Înainte de activare: testați o cumpărare Stripe test → lectură mobilă cu același cont; o cumpărare Stripe din aplicație → lectură web; reinstalare/autentificare; refund; duplicate/out-of-order webhook; cont diferit; capitole și imagini; RTL și traducere lipsă; progres între dispozitive.
- Urmăriți erorile `[ebooks]`, webhookurile retry și tranzacțiile în așteptare. Nu confundați buildul/testele locale cu dovada unei cumpărări reale.

Nu s-au făcut deployment, abonare Sanity, scrieri Firebase de producție, creare produse sau submit în magazine prin implementarea locală.

## Verificare locală și activare

Testele acoperă prețul calculat pe server, TVA, prețuri distincte și modificate în Sanity, izolarea conturilor, accesul după webhook, plăți în așteptare, webhookuri duplicate, refunduri, facturare și revenirea WebView pe URL-ul corect. Se verifică separat regresiile cursurilor, Premium, analizelor și RevenueCat existent.

Buildul Studio și exporturile Expo verifică integrarea locală; nu validează o tranzacție reală, un binar nativ sau aprobarea din magazine. Verificarea TypeScript completă a aplicației mobile are erori existente în alte module; erorile modulului ebookurilor sunt verificate separat.

Înainte de activare, configurați Sanity privat, Stripe și webhookul dedicat, apoi testați Stripe în mediul de test, facturarea și accesul între dispozitive/platforme. Configurările externe, deploymentul și lansarea în magazine rămân pași expliciți de activare.

## Lista pentru Vercel (configurare manuală)

În proiectul care servește `www.cristinazurba.com`, Settings → Environment Variables → Production:

| Variabilă | Valoare / sursă |
| --- | --- |
| `SANITY_PROJECT_ID` | `rvz9v34h` |
| `SANITY_DATASET` | `production` |
| `SANITY_READ_TOKEN` | Din fișierul local `.env.local`; marcat Sensitive, exclusiv server |
| `SANITY_EBOOK_WEBHOOK_SECRET` | Aceeași cheie ca în webhookul Sanity; exclusiv server |
| `STRIPE_EBOOK_WEBHOOK_SECRET` | Cheia endpointului dedicat ebookurilor din Stripe, din același mod test/live ca `STRIPE_SECRET_KEY` |
| `EBOOKS_ENABLED` | `true` la activarea API-ului |
| `NEXT_PUBLIC_EBOOKS_ENABLED` | `true` la activarea catalogului web |
| `EBOOKS_STRIPE_ENABLED` | Inițial `false`; `true` după configurarea și verificarea plății |

Păstrați variabilele Stripe, Firebase și Oblio existente. Cheia Stripe locală este de **test**; nu o copiați peste cheia de producție. `NEXT_PUBLIC_SITE_URL` trebuie să fie `https://www.cristinazurba.com`.

1. Adăugați variabilele și faceți deploymentul versiunii care include ebookurile; modificarea variabilelor singură nu actualizează deploymentul existent. Verificați `/api/ebooks/config` și `/dashboard/ebooks`.
2. Activați webhookul Sanity numai după ce endpointul este publicat și API-ul ebookurilor este activ.
3. În Stripe configurați endpointul dedicat `https://www.cristinazurba.com/api/ebooks/stripe-webhook`, pentru `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`. Adăugați secretul în Vercel și redeployați.
4. Verificați fluxul în mod Stripe test într-un mediu separat; activați checkoutul în producție după validare. Preview deployments necesită propriile variabile, URL-uri și CORS dacă se verifică editorul acolo.
5. Pentru aplicație, setați `EXPO_PUBLIC_EBOOKS_ENABLED=true` în mediul buildului mobil, apoi publicați separat versiunea aplicației. Această variabilă nu se activează prin Vercel.

### Webhook Stripe creat la 4 octombrie 2026

- Cont: `SPIRIT SOARE ȘI LUNĂ S.R.L.`, `acct_1QA6KbFfPQUdD5PA`; mod **live**.
- Destinație: **Ebookuri Stripe**, `we_1UMomRFfPQUdD5PAUvsdKJBJ`.
- URL: `https://www.cristinazurba.com/api/ebooks/stripe-webhook`.
- Evenimente snapshot: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`; API `2024-09-30.acacia`.
- Status verificat în Stripe la 4 octombrie 2026: **Active**, după verificarea secretului în endpointul de producție.
- `STRIPE_EBOOK_WEBHOOK_SECRET` este salvat în `.env.local`, ignorat de Git. Acesta este secretul endpointului **live**; cheia API Stripe locală este de test, deci combinația locală nu trebuie folosită pentru procesarea webhookurilor live.
- Secretul din Vercel a fost verificat printr-un eveniment de diagnostic fără plată: semnătură validă → HTTP 200 `{"skipped":true}`; semnătură invalidă → HTTP 401. Nu au fost create plăți sau drepturi de acces. Aceasta verifică handlerul și secretul, nu livrarea unui eveniment real din Stripe sau o cumpărare.

### Verificare live la 4 octombrie 2026

- `/api/ebooks/config`: HTTP 200, `enabled:false`, `websiteBilling:true`, `mobileBilling:{web:true,android:true,ios:false}`. Activarea ebookurilor necesită flagurile Production și redeploy; plata iOS respectă în continuare configurația cursurilor.
- `/api/ebooks`: catalog dezactivat, fără cărți. Rutele cumpărătorilor și preview răspund HTTP 503 până la activare; verificarea autentificării trebuie repetată după activare.
- Datasetul Sanity `production` este privat și conține 0 documente ebook/ebookEdition, verificat prin API autentificat. Pentru verificarea lecturii este necesară o carte cu ediție RO publicată.
- `/ebooks` și `/dashboard/ebooks` răspund HTTP 200. `/ebook-studio/` răspunde HTTP 200, dar conține pagina „Sanity nu este încă configurat”: la build a lipsit `SANITY_PROJECT_ID` sau `SANITY_DATASET`. Verificați ambele variabile în Production și redeployați înainte de verificarea editorului.
- Răspunsurile API au `Cache-Control: private, no-store, max-age=0`.
- Webhookul Sanity „Ebookuri - sincronizare catalog”, ID `XlZUlq7Y6KdXNTQO`, a fost salvat și verificat **Enabled** după confirmarea proprietarului: `production`, POST către endpointul site-ului, creare/update/delete, filtrul ebook/ebookEdition, proiecția `{_id,_type}`, fără drafturi sau versions. Folosește secretul `SANITY_EBOOK_WEBHOOK_SECRET` din `.env.local`.
- Rămân de verificat: webhookul Sanity și sincronizarea, catalogul activ, conturile și lectura/progresul, checkoutul și accesul după plată, refundurile, livrarea Stripe și aplicația mobilă. Nu s-a făcut o tranzacție reală.

### După redeployul cu configurația completă

Deployment Production `7AbYa6zrQKKjfSxpS34GcqeXAiFx` a ajuns la Ready. Verificări directe pe `www.cristinazurba.com`:

- API: `enabled:true`, checkout configurat web/Android, iOS blocat conform setării cursurilor. Catalog HTTP 200, `books:[]`; în browser „Nu există cărți disponibile”.
- Studio live a fost verificat autentificat în contul Cristina Zurba: `/ebook-studio/structure/cartiSiEditii` deschide lista „Cărți”. În profilul neautentificat afișează alegerea providerului de login. Bundle-ul principal și bridge-ul au HTTP 200; nu conțin tokenul Viewer sau secretele webhookurilor locale.
- Fără autentificare: Cărțile mele, capitolele, progresul, checkoutul și preview admin răspund HTTP 401. Token Firebase invalid → HTTP 401.
- Sanity webhook: diagnostic semnat corect → HTTP 200 `{"synced":0}`; semnătură greșită → HTTP 401. A fost recitit datasetul gol; nu au fost create cărți sau drepturi de acces. Aceasta nu înlocuiește verificarea unei livrări declanșate de publicarea reală în Studio.
- Aplicația locală: `EXPO_PUBLIC_EBOOKS_ENABLED=true` în `.env.local` ignorat. Nu s-a distribuit build sau OTA mobil.
- Nu există încă un ebook publicat; lectura, traducerile, progresul dintre dispozitive, plata, facturarea și refundurile nu sunt confirmate cap-coadă în producție.

### Separarea setării iOS pentru ebookuri

Codul local folosește acum `iosEbooksStripeEnabled`, cu comutator în `/administrare/setari` și salvare prin API-ul autentificat de setări. Înregistrările live de mai sus descriu deploymentul anterior, care folosea politica cursurilor. Separarea necesită un nou deployment; nu a fost activată în Firestore sau publicată prin această modificare. Nu s-au rulat teste pentru această modificare.

## Reorganizarea interfeței — 4 octombrie 2026

Pagina `/dashboard/ebooks` păstrează sidebarul dashboardului, cu Ebookuri selectat, și afișează editorul Sanity într-un panou adaptat la desktop și mobil. „Deschide editorul separat” deschide `/ebook-studio/` într-o filă nouă; autentificarea Sanity rămâne proprie editorului. Sincronizarea manuală blochează apăsările repetate și afișează succesul sau eroarea.

Comutatorul „Plăți ebookuri pe iOS” este acum exclusiv în `/administrare/setari`, lângă cursurile iOS. Folosește aceeași valoare Firestore existentă și solicită confirmare înainte de salvare. Mutarea interfeței nu activează/dezactivează plata și nu necesită migrare.

Verificări locale: paginile compilate în serverul de dezvoltare; verificare vizuală la 1440 și 390 px; scenarii simulate în browser pentru sincronizare, anulare, salvare, apăsări repetate și erori; 4 teste existente ale API-ului de setări trecute. Verificările simulate nu au scris configurații live. Studio pe originea locală de test `127.0.0.1:3101` cere înregistrarea hostului; nu am schimbat configurația Sanity pentru acest test. Publicarea interfeței necesită deployment Next.js.

## Acces promoțional pe cont

Pagina cărții permite activarea fără plată, prin cod, pentru un cont Firebase real (nu anonim). Accesul este permanent pentru carte și toate traducerile, pe web și mobil cu același UID; promoția nu generează facturi și nu afectează achizițiile Stripe.

Variabile **doar pe server**, de copiat din `.env.local` în Vercel Production:
- `EBOOK_PROMO_ENABLED=true`
- `EBOOK_PROMO_CODE_HASH` — hash SHA-256 hex de 64 caractere, pregătit local.

Nu folosi prefixul `NEXT_PUBLIC_` sau `EXPO_PUBLIC_` pentru hash/cod. Codul nu se include în bundle. Configurarea Vercel și redeployul se fac separat; aplicația necesită publicarea unei versiuni noi pentru formularul promoțional. Setarea `false` oprește activările noi, păstrând accesul acordat anterior.

API: `POST /api/ebooks/:ebookId/redeem`, Bearer Firebase, `{ code }`. Codul este sensibil la majuscule; spațiile exterioare sunt eliminate. Sunt permise 5 încercări per UID în 15 minute, inclusiv între platforme și cărți. Activarea este tranzacțională și idempotentă. Sursele `promo/granted` și Stripe rămân independente în `users/{uid}/ebookAccess/{ebookId}`.

În regulile Firestore de producție trebuie păstrat accesul exclusiv prin Admin SDK pentru `ebookAccess`, `ebookProgress` și `ebookPromoAttempts`. Fișierul local `expo-mobile-app/firestore.rules` include regula pentru noul contor. Verifică să nu existe alte reguli generale care permit scrierea acestor căi; regulile Firestore se cumulează. Nu se face deployment automat al regulilor.

Validarea locală cu API-uri simulate nu dovedește sincronizarea live. După redeploy și publicarea aplicației, verifică același cont real în ambele direcții (web → mobil, mobil → web), traducerile și progresul.

## Ștergerea unei cărți

În editorul cărții, deschide acțiunea **„Șterge cartea”** din bara de acțiuni de lângă Publish și confirmă ștergerea definitivă. Acțiunea elimină documentul cărții și toate edițiile publicate și draft asociate. Cumpărătorii nu vor mai putea citi conținutul șters, de aceea arhivează cartea dacă dorești doar să o scoți din catalog. Înregistrările de plată și acces din Firebase, precum și fișierele din biblioteca media Sanity, rămân păstrate.
