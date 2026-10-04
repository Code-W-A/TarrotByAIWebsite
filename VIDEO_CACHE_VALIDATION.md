# Cache video — implementare și validare

Verificat la 4 octombrie 2026. Modificările sunt locale; nu am făcut deploy și nu am reconstruit cache-ul de producție.

## Comportament

- API-ul de listare citește toate bucățile catalogului materializat și reutilizează rândurile în memoria instanței. Verificarea manifestului rămâne la 30 de secunde implicit; verificarea sursei de rezervă rămâne la cinci minute. Nu se cache-uiesc răspunsurile HTTP personalizate.
- Salvările din dashboard reconstruiesc automat cache-ul. Generația nouă este verificată înainte de activare; eșecurile păstrează catalogul anterior, iar reconstruirile vechi nu suprascriu generațiile mai noi.
- Setări → Cache video: total publicat, ultima actualizare, rezultatul ultimei reconstruiri și buton de reconstruire. Statusul citește numai două documente de metadate și folosește autentificarea dashboard-ului.
- Dacă salvarea reușește și cache-ul eșuează, formularul se închide și dashboard-ul afișează avertismentul. Reîncercarea face numai reconstruirea cache-ului, fără să repete salvarea.
- La schimbarea generației verificăm din nou semnătura sursei: o semnătură veche din memoria altei instanțe nu declanșează inutil încă o reconstruire.

## Concordanța cu Firestore real

Testul opt-in importă și execută handlerul API local modificat, cu date și setări citite din Firestore configurat în proiect. Nu reprezintă un test HTTP al deploymentului. Adapterul permite numai citiri și blochează orice tranzacție de reconstruire; telemetria cu scrieri este dezactivată.

| Client / verificare | Firestore publicate | Cache | Eligibile | API | Lipsă / suplimentare / duplicate |
| --- | ---: | ---: | ---: | ---: | --- |
| Mobil, anonim, română | 353 | 353 | 353 | 353 | 0 / 0 / 0 |
| Web, anonim, română | 353 | 353 | 353 | 353 | 0 / 0 / 0 |

S-au comparat mulțimile exacte de ID-uri. Sursa și generația activă au fost verificate din nou după test și au rămas stabile; comparația a trecut la prima încercare stabilă. Drafturile și documentele interne nu fac parte din totalul publicat. Regulile de limbă și publicare pot produce legitim un total eligibil mai mic în alte contexte.

## Verificări locale

- 17 suite / 95 teste au trecut: catalog cu peste patru bucăți reale, toate ID-urile și toate paginile, cache în memorie, detectarea generației noi fără scanare completă, publicare programată în aceeași fereastră de cache, limbă și web/mobil, acces Premium, integritate, reconstruire concurentă/eșuată, păstrarea catalogului la eșecul citirii, endpointuri protejate, interfața Setărilor și reîncercări fără salvare dublă.
- Testul separat cu Firestore real a trecut.
- TypeScript: `npx tsc --noEmit --incremental false` a trecut.
- Interfața a fost verificată prin teste DOM; nu am efectuat verificare vizuală în browser sau build complet de producție.

Comenzi din `next-js`:

```sh
npx jest --runInBand --testPathPatterns='(videoLibrary|loadPremiumVideoLibrary|videoReleaseSchedule|video-cache-admin|video-library.test|videoCache|videoAdmin|videoValidation)' --testPathIgnorePatterns='live-smoke'
npx tsc --noEmit --incremental false
RUN_VIDEO_FIRESTORE_PARITY=1 npx jest --runInBand lib/__tests__/videoLibraryFirestoreParity.live-smoke.test.js
```

Testul real cere acces de rețea la Firestore. Prima încercare în sandbox a fost blocată de DNS; reluarea cu acces de rețea aprobat a trecut. Testul refuză reconstruirea producției dacă găsește un cache invalid sau învechit, în loc să îl repare prin scrieri.
