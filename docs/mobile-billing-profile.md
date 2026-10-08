# Facturare simplificată în Expo

La prima cumpărare de curs sau pachet, aplicația completează numele și emailul din cont, colectează adresa și salvează datele validate. Telefonul și rândul suplimentar al adresei sunt opționale. La următoarea cumpărare afișează rezumatul, cu „Modifică” și „Continuă la plată”. Salvarea are loc înainte de checkout; datele rămân disponibile și dacă plata este anulată.

`GET/PUT /api/billing-profile` solicită token Firebase pentru un cont neanonim. PUT primește `{ billingDetails }`; răspunsul este `{ billingDetails, valid }`. UID-ul este luat exclusiv din token. Profilul se păstrează în `billingProfiles/{uid}`, separat de exemplarul datelor păstrat pentru fiecare checkout.

Pentru plățile mobile, clienții Stripe sunt reutilizați prin `billingStripeCustomers/{uid}_{test|live}`, separat de clientul Premium. Stripe primește datele din aplicație; colectarea adresei este `auto`, telefonul nu se mai solicită explicit, iar datele sunt precompletate. O metodă de plată poate solicita propriile date obligatorii. Cardurile nu sunt salvate prin acest flux. Checkoutul web nu se schimbă.

Oblio folosește exemplarul datelor păstrat la checkout după confirmarea plății. Un profil modificat ulterior nu modifică facturile anterioare. Erorile de emitere și protecția împotriva duplicatelor păstrează comportamentul existent.

## Activare

- Publică backendul Next.js înainte de distribuirea aplicației actualizate. Nu sunt necesare variabile de mediu noi sau o migrare a utilizatorilor.
- Păstrează colecțiile de profil și mapare Stripe inaccesibile SDK-urilor client; regulile pregătite în proiectul Expo le interzic accesul direct. Deployul regulilor este separat.
- Creează un preview Android/iOS și verifică prima cumpărare, rezumatul, modificarea datelor și plata anulată.
- Într-un mediu de test configurat verifică explicit plata Stripe, webhookul și factura Oblio: numele, adresa, suma, TVA și emailul. Testele locale cu servicii simulate nu demonstrează emiterea unei facturi reale.
- Premium și checkoutul web păstrează configurarea existentă.

## Diagnosticarea salvării înainte de plată

La reproducere, caută `[BillingProfile] request_failed` și `[BillingProfileCheckout] save_failed_alert` în logurile aplicației. Ambele includ același `requestId`; caută acel ID în logurile Next.js pentru `/api/billing-profile`. Aplicația trimite ID-ul prin `X-Request-ID`, iar serverul îl întoarce în același header, fără să schimbe răspunsul JSON.

`stage`, `reason`, `status` și `durationMs` disting erorile de token, rețea, timeout, HTTP și răspuns non-JSON. Pe server, `validation_result` raportează numai prezența câmpurilor și codurile problemelor; `request_failed` în etapa `firestore_write` include codul Firestore. Alegerile din alertă produc `save_failure_back` sau `continue_without_save`.

Eșecurile și alegerile din alertă se loghează la nivel warn, inclusiv în release. Etapele reușite din aplicație folosesc nivelul info al loggerului existent, vizibil în development; serverul loghează și etapele reușite. Nu se loghează date personale, UID-uri, tokenuri, corpuri HTTP sau mesajele brute ale excepțiilor. Pentru corelarea dintr-o aplicație instalată trebuie distribuit codul mobil actualizat și publicat endpointul actualizat; nu sunt necesare variabile de mediu noi.

Cărțile digitale folosesc acum achiziții native RevenueCat pe mobil și nu mai afișează acest formular. Pe web, cumpărarea cărților păstrează Stripe și Oblio. Vezi `EBOOKS_SETUP.md`.
