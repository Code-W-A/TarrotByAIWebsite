# Ebookuri: configurare și activare

Implementare: Sanity Studio separat, Next.js API, Firebase UID comun și Stripe/Oblio pe site și achiziții permanente RevenueCat pe mobil. Citirea este online; traducerile sunt manuale. Codul nu creează conturi sau abonamente externe și nu activează producția.

## Sanity

### Istoric: configurația creată la 3 octombrie 2026

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
6. Creați cartea, completați coperta, apoi textul în RO și traducerile dorite. În „Copertă, preț și publicare”, panoul de deasupra formularului afișează câmpurile lipsă și starea fiecărei limbi. Apăsați **„Publică cartea”**: se publică informațiile cărții și toate edițiile complete și valide. RO este obligatorie; traducerile incomplete rămân drafturi. După prima publicare, butonul devine **„Actualizează cartea”**. Folosiți **„Previzualizează”** pentru drafturi și „Sincronizează catalogul” dacă webhookul nu a fost instalat încă.

Capitolele păstrează `_key` generat de Studio la editare/reordonare; nu ștergeți și recreați capitole doar pentru corecturi. Pentru traduceri puteți copia structura capitolelor și înlocui textul. Progresul este separat pe limbă. **„Arhivează cartea”** ascunde cartea din catalog și păstrează lectura cumpărătorilor. **„Șterge cartea”** elimină definitiv cartea și edițiile, după confirmare. Validatorul împiedică eliminarea capitolelor deja publicate.

Panoul gestionează automat câmpul `status`, care nu mai este editat manual. Operațiile verifică reviziile Sanity pentru a evita suprascrierea modificărilor făcute de alt editor. Dacă publicarea se oprește, mesajul indică edițiile confirmate și limbile de reîncercat; edițiile deja publicate sunt păstrate. Înlocuirea editorului live necesită un build și deployment Next.js; modificarea locală nu publică automat cărțile.

**Imaginile standard Sanity sunt publice prin URL, inclusiv într-un dataset privat.** Alegerea acceptată este text privat + imagini CDN. Protecția nu împiedică fotografierea sau extragerea textului de pe dispozitivul unui cumpărător.

## Stripe și facturare
- Folosește `STRIPE_SECRET_KEY`, `STRIPE_FIXED_VAT_TAX_RATE_ID`, `NEXT_PUBLIC_SITE_URL` și setarea TVA existente. Prețul tuturor cărților este fix: **11 EUR net**. Prețurile/monedele vechi Sanity sunt ignorate; catalogul calculează totalul cu TVA configurat, iar Stripe adaugă rata fiscală existentă. La TVA de 21%, totalul este 13,31 EUR. Verificați concordanța dintre rata Stripe și setarea TVA.
- Checkoutul folosește formularul de facturare existent și normalizarea server. Factura Oblio folosește aceleași utilitare fiscale și politica e-Factura ca la cursuri. Dacă serviciul lipsește sau răspunsul este ambiguu, plata rămâne validă și factura este marcată `pending_manual` în `payments`, fără retry extern care poate dubla factura.
- Configurați un endpoint **separat** `/api/ebooks/stripe-webhook` pentru `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, cu `STRIPE_EBOOK_WEBHOOK_SECRET`.
- `EBOOKS_STRIPE_ENABLED=true` activează checkoutul. Confirmarea succesului din URL nu acordă acces. Doar webhookul semnat acordă acces.

## Achiziții native pe mobil — configurația curentă

1. Configurați o singură dată `ebook_credit_1` pe fiecare platformă: **Consumable** în Apple și produs cu plată unică în Google, consumat prin SDK. Denumirea publică este **Digital book**; descrierea explică deblocarea permanentă a unei singure cărți alese, cu toate traducerile. În aplicație folosim „Cumpără cartea”. Creditul este mecanism intern, fără expirare.
2. Importați cele două produse în RevenueCat, într-un offering `ebooks`, cu un pachet personalizat. **Nu atașați un entitlement care deblochează toate cărțile** și nu activați un al doilea sold RevenueCat Virtual Currencies. Firestore este registrul unic.
3. Prețul de bază rămâne **11 EUR fără TVA**. În magazine verificați prețul final cu TVA și conversiile regionale; aplicația afișează `priceString` fără să adauge TVA din nou. Verificați separatorul zecimal din consola localizată înainte de salvare. Site-ul calculează TVA prin configurația Stripe existentă.
4. Pe server setați `REVENUECAT_IOS_EBOOK_CREDIT_PRODUCT_ID=ebook_credit_1` și `REVENUECAT_ANDROID_EBOOK_CREDIT_PRODUCT_ID=ebook_credit_1`. Păstrați cheile secrete și webhookul existent `/api/revenuecat/webhook`, cu evenimentele `NON_RENEWING_PURCHASE` și `CANCELLATION`. Nu modificați politica globală de restaurare pentru Premium. Câmpurile vechi de produs ale cărților sunt ascunse, iar identificatorii existenți sunt păstrați pentru procesarea achizițiilor istorice.
5. Expo păstrează cheile SDK existente. UID-ul Firebase real este identitatea RevenueCat. După validarea sandbox, activați separat `IOS_BILLING_EBOOKS_ENABLED=true` și `ANDROID_BILLING_EBOOKS_ENABLED=true`; funcționalitatea generală necesită `EBOOKS_ENABLED=true`. Pentru sandbox folosiți `REVENUECAT_EBOOKS_ALLOW_SANDBOX=true` pe serverul de test. Expo Go nu validează achizițiile native.

API-urile autentificate sunt `POST /api/ebooks/{id}/native-intent`, `POST /api/ebooks/{id}/native-confirm`, `GET /api/ebooks/credits`, `POST /api/ebooks/{id}/use-credit` și `POST /api/ebooks/native-restore`. Intenția fixează cartea înaintea plății; confirmarea trimite intenția și tranzacția verificată. Webhookul înregistrează creditul, fără să ghicească ce carte a selectat utilizatorul. Confirmarea sau acțiunea „Finalizează deblocarea” consumă creditul și acordă acces în aceeași tranzacție Firestore.

O întrerupere după plată lasă creditul disponibil pe cont. Recuperarea după reinstalare folosește registrul serverului, inclusiv când magazinul nu restaurează consumabilele. Tranzacțiile sunt idempotente și legate definitiv de UID; verificarea REST acceptă proprietarul original, iar situațiile de alias așteaptă webhookul autentificat. Refundul invalidează numai creditul și accesul acordat de acesta; sursele Stripe și promoție rămân valide. O plată concurentă pentru o carte deja deținută lasă creditul disponibil.

`GET /api/ebooks/config` expune `mobileProvider: "revenuecat"`, `mobileBilling: {ios, android}` și disponibilitatea Stripe web. Checkoutul ebookurilor respinge cererile mobile. Achizițiile native nu colectează formularul de facturare și nu apelează Oblio; cumpărările web păstrează factura și copia datelor de facturare ale sesiunii.

Referințe: [evenimente RevenueCat](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields), [prețurile Apple](https://developer.apple.com/help/app-store-connect/manage-in-app-purchases/set-a-price-for-an-in-app-purchase).

## Firebase, UI și rollout
- Noile colecții `ebookRegistry`, `ebookTransactions`, `ebookPaymentEvents`, `ebookCheckouts`, `ebookStripePayments`, `ebookCredits`, `ebookPurchaseIntents`, `users/{uid}/ebookAccess`, `users/{uid}/ebookProgress` sunt server-only. Fragmentele sunt în `expo-mobile-app/firestore.rules`: **integrați** regulile în regulile reale, nu înlocuiți producția cu acel fișier fragment. Verificați că regulile wildcard existente nu permit scrieri în colecțiile noi.
- Activați `EBOOKS_ENABLED=true` numai cu dataset privat și configurație server. UI: `NEXT_PUBLIC_EBOOKS_ENABLED=true` pe site și `EXPO_PUBLIC_EBOOKS_ENABLED=true` în aplicație.
- API: catalog `/api/ebooks`, detalii `/{id}`, proprietate `/purchased`, capitol `/{id}/chapters/{chapterId}`, progres GET/PUT `/{id}/progress`, checkout `/{id}/checkout`. `locale` selectează ediția publicată sau RO. Metadatele nu conțin textul capitolelor.
- Pages: `/ebooks`, `/ebooks/mine`, `/ebooks/{id}`, `/ebooks/{id}/read`. Ecranul principal mobil oferă intrare în catalog.
- Înainte de activare: testați o cumpărare Stripe test → lectură mobilă cu același cont; o cumpărare nativă din aplicație → lectură web; reinstalare/autentificare; refund; duplicate/out-of-order webhook; cont diferit; capitole și imagini; RTL și traducere lipsă; progres între dispozitive.
- Urmăriți erorile `[ebooks]`, webhookurile retry și tranzacțiile în așteptare. Nu confundați buildul/testele locale cu dovada unei cumpărări reale.

Nu s-au făcut deployment, abonare Sanity, scrieri Firebase de producție, creare produse sau submit în magazine prin implementarea locală.

## Verificare locală și activare

Testele acoperă prețul calculat pe server, TVA, prețul fix de 11 EUR și ignorarea prețurilor vechi din Sanity, izolarea conturilor, accesul după webhook, plăți în așteptare, webhookuri duplicate, refunduri, facturare și confirmarea și restaurarea achizițiilor native. Se verifică separat regresiile cursurilor, Premium, analizelor și RevenueCat existent.

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

### Istoric: verificare live la 4 octombrie 2026

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

### Istoric: separarea setării iOS pentru ebookuri

Codul local folosește acum `iosEbooksStripeEnabled`, cu comutator în `/administrare/setari` și salvare prin API-ul autentificat de setări. Înregistrările live de mai sus descriu deploymentul anterior, care folosea politica cursurilor. Separarea necesită un nou deployment; nu a fost activată în Firestore sau publicată prin această modificare. Nu s-au rulat teste pentru această modificare.

## Istoric: reorganizarea interfeței — 4 octombrie 2026

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

În „Copertă, preț și publicare”, apasă butonul vizibil **„Șterge cartea”** din panoul de deasupra formularului și confirmă ștergerea definitivă. Acțiunea elimină documentul cărții și toate edițiile publicate și draft asociate. Cumpărătorii nu vor mai putea citi conținutul șters, de aceea arhivează cartea dacă dorești doar să o scoți din catalog. Înregistrările de plată și acces din Firebase, precum și fișierele din biblioteca media Sanity, rămân păstrate.

## Verificarea implementării native — 8 octombrie 2026

- 101 teste backend/Studio trecute: preț fix, TVA, acces, promoție, confirmare, restaurare, webhookuri duplicate, refunduri și izolarea conturilor, plus regresii RevenueCat/billing.
- 79 teste Expo trecute: ebookuri și serviciile RevenueCat; testul existent al cititorului identifică acum explicit butonul „Capitolul anterior”, pentru a nu-l confunda cu revenirea din antet.
- Build Studio și typecheck Studio: reușite. Build Next.js: reușit. Exporturi Metro/Hermes Android și iOS: reușite; acestea nu sunt binare instalate și nu verifică magazinele.
- Typecheckul global Expo eșuează cu erori în afara fișierelor de producție ebook/RevenueCat modificate (inclusiv App.tsx, navigations.tsx și tipuri Jest). Nu declarăm proiectul Expo complet verificat prin TypeScript.
- Nu s-au configurat produse, schimbat variabile live, publicat aplicații sau efectuat plăți reale. Rămân configurarea produselor/RevenueCat, activarea flagurilor serverului, deploymentul și testele sandbox pe dispozitive reale.

## Configurare universală efectuată — 8 octombrie 2026

- Google Play: `ebook_credit_1`, denumire **Digital book**, opțiune `standard`, activă în 174 regiuni. Categoria „Carte electronică unică fără ISBN”. Prețurile au fost generate din baza **11 EUR** cu taxele categoriei și rotunjirile Google; România **69,99 RON**. Adminul nu mai configurează produse pentru fiecare carte.
- Apple: consumabil `ebook_credit_1`, Apple ID `6820575415`, referință **Digital book**. Localizări English US și Romanian („Carte digitală”). Disponibilitate 175 regiuni; categoria Books / Does not have ISBN, ISSN, or ECN. Bază France EUR **13,49 EUR**, cel mai apropiat nivel disponibil de ținta 13,31 EUR; România **69,99 RON**. Prețurile regionale Apple sunt conversii, nu o garanție de 11 EUR net în fiecare țară. Configurație salvată, **Prepare for Submission**, fără trimitere la review; captura reală a noului flux rămâne de adăugat după testul sandbox. Categoria fără ISBN presupune conținut fără un asemenea identificator; reevaluați dacă se schimbă tipul cărților comercializate.
- RevenueCat: proiect `478417fe`, produs Android `prod31e2fef70c`, produs iOS `prod592a541bf1`, ambele Consumable, fără entitlements asociate. Offering `ebooks` (`ofrngd82f552b0e`), package personalizat `ebook_credit_1`, cu cele două produse. Offeringul Premium existent nu a fost înlocuit.
- Webhookul existent `whintgref2b5edf49` a fost redenumit **Cristina Zurba Mobile Billing**, către aceeași adresă `/api/revenuecat/webhook`; după confirmarea utilizatorului filtrează **All apps / All events / Both Production and Sandbox**. Autentificarea existentă a fost păstrată. Politica globală de restaurare nu a fost modificată.

### Vercel — configurare și activare separate

Adăugați în mediul care rulează noul backend:

```env
REVENUECAT_IOS_EBOOK_CREDIT_PRODUCT_ID=ebook_credit_1
REVENUECAT_ANDROID_EBOOK_CREDIT_PRODUCT_ID=ebook_credit_1
```

Păstrați cheile existente `REVENUECAT_SECRET_API_KEY`, `REVENUECAT_WEBHOOK_AUTH_TOKEN`, Stripe și Sanity. Variabilele SKU sunt pregătite și în `.env.local`. Nu introduceți chei secrete RevenueCat în Expo.

Pentru serverul dedicat testelor sandbox: `REVENUECAT_EBOOKS_ALLOW_SANDBOX=true`. Flagurile `IOS_BILLING_EBOOKS_ENABLED` și `ANDROID_BILLING_EBOOKS_ENABLED` se activează în mediul testat; în producție numai după validare. Păstrați `EBOOKS_ENABLED`, `NEXT_PUBLIC_EBOOKS_ENABLED` și `EBOOKS_STRIPE_ENABLED` conform activării existente. Faceți redeploy cu noul cod; simpla creare a produselor nu actualizează API-ul live.

Verificați integrarea regulilor server-only pentru `ebookCredits` și `ebookPurchaseIntents` în regulile Firebase reale, inclusiv orice wildcard permisiv. Fișierul Expo cu reguli este un fragment și nu trebuie publicat ca înlocuitor al regulilor proiectului.

### Dovezi și limite

Buildurile Next.js și Sanity Studio și exporturile JavaScript Android/iOS au trecut local. Testele API folosesc date și servicii simulate: verifică accesul comun Stripe → mobil și credit nativ → web, nu reprezintă cumpărări efectuate în magazine. Typecheckul global Expo are erori preexistente, inclusiv în teste; fișierele de producție ale modulului ebooks nu apar în erorile raportate.

Nu există în această verificare dispozitiv Android/iOS conectat sau pornit cu un build sandbox al noului flux. Nu s-au executat plăți sandbox, review Apple, deployment Vercel sau publicare a aplicației. Testarea concurenței reale Firestore și verificarea regulilor live rămân condiții de activare, alături de cumpărarea, întreruperea, recuperarea și refundul sandbox.

Verificarea finală a acestei modificări: **93 teste backend** (inclusiv regresii RevenueCat și configurarea domeniilor) și **63 teste Expo** au trecut. A fost corectat și cazul în care identificatorii unor cursuri dezactivate ajungeau la rezolvarea produselor ebook; aceștia sunt ignorați de domeniul cărților.
