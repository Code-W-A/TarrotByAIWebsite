# Descrieri video Firebase / Sanity

Dashboardul are un singur selector Firebase / Sanity pentru descrierea generală și toate limbile. Videoclipurile vechi fără `descriptionStorage` folosesc Firebase; videoclipurile noi aleg Sanity implicit. Schimbarea selectorului păstrează toate textele în formular și se aplică numai la salvare. Backendul continuă să citească sursele mixte existente: editorul le încarcă integral și selectează Sanity dacă cel puțin o descriere folosește deja Sanity, apoi la salvare unifică toate sursele conform selectorului. Structura de stocare și răspunsurile API publice rămân compatibile.

Fiecare descriere nouă sau modificată are maximum 6.000 de caractere Unicode (code points), inclusiv spațiile. Editorul afișează contorul pentru descrierea generală și în dialogul fiecărei limbi; depășirea blochează aplicarea/salvarea, fără trunchiere. Backendul validează aceeași regulă înaintea scrierilor. Textele vechi peste limită pot rămâne neschimbate la editarea altor câmpuri sau la schimbarea sursei; dacă sunt modificate, trebuie reduse la limită. Generarea localizărilor cere o descriere generală de maximum 6.000 de caractere, inclusiv pentru textele vechi. Limitele totale în bytes pentru Firestore și Sanity rămân active.

## Configurare

- `SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_READ_TOKEN`: aceeași configurație de proiect/dataset privat folosită pentru ebookuri, fără dependență de `EBOOKS_ENABLED`.
- `SANITY_WRITE_TOKEN`: token exclusiv server, cu drepturi de creare/citire a documentelor `videoDescriptionVersion`. Nu folosi o variabilă `NEXT_PUBLIC_*` și nu expune tokenul browserului.
- Nu sunt necesare CORS Sanity noi: browserul comunică doar cu API-ul Next.js, autentificat prin sesiunea dashboardului.
- Backendul Cloud Functions al notificărilor necesită aceleași `SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_READ_TOKEN`, exclusiv pentru citire. Nu necesită token de scriere și nu schimbă aplicația mobilă.
- Tipul Sanity este înregistrat în Studio, read-only și ascuns din navigare/creare. Ebookurile își păstrează acțiunile existente.

## Persistență și contract

`POST /api/admin/videos` primește `{videoId?, input, mutationId, expectedRevision?}`. `GET /api/admin/videos?id=...` întoarce formularul complet, cu textele reconstruite și un token `editRevision`. `mutationId` rămâne același la reîncercarea aceluiași formular; o schimbare de conținut produce o cheie nouă.

Firestore păstrează `descriptionStorage: {version: 1, root, locales, sanityId}`. Valorile sursei sunt `firebase` sau `sanity`. Descrierile externe sunt eliminate din documentul principal; titlurile și linkurile rămân acolo.

Versiunile Sanity au ID determinist după videoclip și conținut. Se creează cu `createIfNotExists`, înainte de tranzacția Firebase. Tranzacția publică referința și cheia operației împreună. O scriere Sanity reușită urmată de eșec Firebase poate lăsa o versiune nereferențiată; aceasta nu devine vizibilă și se reutilizează la retry. Nu ștergem automat versiuni vechi.

Conflictele editorului compară conținutul editabil; contoarele de vizualizări și confirmările notificărilor sunt păstrate din ultima versiune Firebase. Limita de evidențiere și alocarea ordinii se verifică în tranzacție.

Resolverul este folosit la editare, detaliul public, citirea sursei fără cache, reconstruirea cache-ului v3 și scriptul de rebuild. API-ul public păstrează forma existentă, inclusiv regulile pentru limbă absentă versus descriere explicit goală. Metadatele sursei nu sunt incluse în DTO.

Backendul notificărilor din `expo-mobile-app/functions` reconstruiește descrierile pentru o pagină întreagă înainte de a genera mesajele. Copia resolverului se sincronizează local cu `node scripts/sync-video-description-resolver.cjs --write`; fără `--write`, scriptul verifică identitatea. Nu se interoghează Sanity separat pentru fiecare destinatar.

## Costuri și erori

- Nu există câte un document Firestore pe limbă. Citirea sursei rămâne un document/video; testele compară și citirile publice înainte/după.
- Salvarea adaugă un document mic de idempotency și citirile tranzacției. Acest cost este pe operație administrativă, nu pe vizitator sau limbă.
- Citirile Sanity sunt grupate, cu memorie limitată pe versiuni imuabile. Cache-ul Firestore v3 existent servește în continuare catalogul și căutarea integrală.
- Dacă reconstruirea eșuează, generația anterioară validă rămâne activă, inclusiv după pornirea unei instanțe noi. Un detaliu care cere o versiune Sanity indisponibilă întoarce eroare, nu un text Firebase învechit.
- Salvarea verifică limita Firestore de 1 MiB și limita unei cereri Sanity de 4 MB, fără trunchiere. Endpointul acceptă maximum 4 MiB per cerere.
- Cache-ul se reconstruiește integral după salvare, conform comportamentului existent. Un răspuns cu `cacheWarning` înseamnă că salvarea s-a făcut; se reîncearcă doar reconstruirea cache-ului.

## Activare

Schimbarea nu migrează și nu rescrie videoclipurile existente. Configurarea tokenului de scriere și deploy-ul backendului sunt pași separați. Configurează și publică mai întâi backendul notificărilor cu accesul Sanity de citire, apoi backendul Next.js, înainte de a salva descrieri externe. Înainte de utilizare reală, verifică pe un mediu de test drepturile tokenului și ciclul creare/editare/reîncărcare. Testele locale simulează Sanity și Firestore; ele nu reprezintă o probă de scriere în producție.
