import { assertArticleSize } from "../lib/articleSize";
import {
  collection,
  doc,
  serverTimestamp,
  updateDoc,
  setDoc,
  arrayUnion,
  arrayRemove,
  getDoc,
  addDoc,
  getDocs,
  deleteDoc,
  writeBatch,
  where,
  query,
  collectionGroup,
  startAt,
  startAfter,
  getCountFromServer,
  orderBy,
  limit,
  onSnapshot,
} from "firebase/firestore";
import { authentication, db } from "../firebase";
import { handleDeleteAccount } from "./authUtils";
import { filterArticlesBeforeCurrentTime } from "./commonUtils";
import { getCurrentDateTime } from "../utils/timeUtils";
import { buildScheduledDate } from "../lib/articleSchedule";

const auth = authentication;
const firestoreCache = new Map();
const firestoreInFlight = new Map();

const getCacheEntry = (key, cacheMs) => {
  const cached = firestoreCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > cacheMs) {
    firestoreCache.delete(key);
    return null;
  }
  return cached;
};

const setCacheEntry = (key, payload) => {
  firestoreCache.set(key, { ...payload, timestamp: Date.now() });
};

/** Clears cached first page for a paginated Firestore list. */
export const clearFirestorePaginatedCache = (
  location,
  limitCount = 50,
  orderByField = "id",
  orderDirection = "asc"
) => {
  const cacheKey = `page1:${location}:${limitCount}:${orderByField}:${orderDirection}`;
  firestoreCache.delete(cacheKey);
  firestoreInFlight.delete(cacheKey);
};
export const userLocation = `Users/${
  auth.currentUser ? auth.currentUser.uid : ""
}`; // Calea către document

export const getFirestoreCollectionLength = async (location) => {
  const coll = collection(db, location);
  const snapshot = await getCountFromServer(coll);
  console.log("count: ", snapshot.data().count);

  return snapshot.data().count;
};

export const handleUpdateFirestore = async (location, updatedData) => {
  try {
    // Obține referința către document
    const ref = doc(db, location);

    // Verifică dacă documentul există
    const docSnapshot = await getDoc(ref);

    if (docSnapshot.exists()) {
      // Documentul există, fă update
      const dateTime = getCurrentDateTime();
      const newData = {
        ...updatedData,
        EditDate: dateTime.date,
        Edittime: dateTime.time,
      };
      if (location.startsWith("BlogArticole/")) assertArticleSize({ ...docSnapshot.data(), ...newData }, location);
      await updateDoc(ref, newData);
      return newData;
    } else {
      // Documentul nu există, creează-l folosind setDoc
      console.log(
        `Documentul nu există la locația: ${location}. Se va crea documentul.`
      );
      if (location.startsWith("BlogArticole/")) assertArticleSize(updatedData, location);
      await setDoc(ref, updatedData);
      return updatedData;
    }
  } catch (err) {
    console.error("Error on...handleUpdateFirestore...", err);
    if (location.startsWith("BlogArticole/")) throw err;
  }
};

export const handleUploadFirestoreGeneral = async (
  data,
  location,
  actionText
) => {
  try {
    console.log("test.infor in handle upload firestore...");
    console.log(location);
    console.log(data);

    // Crează un nou document în colecție cu un ID generat automat

    const docRef = doc(collection(db, location));

    // preia length of location collection

    const collectionLength = await getFirestoreCollectionLength(location);
    let id = collectionLength + 1;

    //current date
    const dateTime = getCurrentDateTime();
    let documentId = docRef.id;
    // Adaugă ID-ul generat în obiectul data
    const newData = {
      ...data,
      documentId,
      id,
      firstUploadDate: dateTime.date,
      firstUploadTime: dateTime.time,
    };
    // Face upload cu noul obiect de date care include ID-ul documentului
    await setDoc(docRef, newData);

    console.log(`Documentul cu ID-ul ${docRef.id} a fost adăugat cu succes.`);

    // // UPLOAD ACTION OF USER
    // // UPLOAD ACTION OF USER
    // if (actionText) {
    //   const currentUser = authentication.currentUser;
    //   let actionData = {
    //     actionText,
    //   };

    //   await handleUploadFirestoreSubcollection(
    //     actionData,
    //     `UsersJobs/${currentUser?.uid}/ActiuniJobs`,
    //     currentUser?.uid
    //   );
    // }
    return newData;
  } catch (err) {
    console.log("Eroare la handleUploadFirestore...", err);
  }
};
export const handleUploadFirestore = async (data, location) => {
  const isBlogArticole = location === "BlogArticole";
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();

  try {
    if (isBlogArticole) {
      console.info("[BlogArticoleUpload] firestore:create:start", {
        categorie: data?.categorie || null,
        hasImage: Boolean(data?.image?.finalUri),
        dataProgramata: data?.dataProgramata || "",
        timpProgramat: data?.timpProgramat || "",
      });
    } else {
      console.log("test.infor in handle upload firestore...", data);
      console.log(location);
      console.log(data);
    }

    // Crează un nou document în colecție cu un ID generat automat
    const docRef = doc(collection(db, location));

    // preia length of location collection

    const collectionLength = await getFirestoreCollectionLength(location);
    let id = collectionLength + 1;

    if (isBlogArticole) {
      console.info("[BlogArticoleUpload] firestore:collection-count", {
        collectionLength,
        nextId: id,
      });
    }

    //current date
    const dateTime = getCurrentDateTime();
    const date = buildScheduledDate({
      dataProgramata: data?.dataProgramata || "",
      timpProgramat: data?.timpProgramat || "",
      fallbackDate: new Date(),
    });

    // Adaugă ID-ul generat în obiectul data
    const newData = {
      ...data,
      documentId: docRef.id,
      id,
      firstUploadtime:
        (data?.timpProgramat || "").length > 0 ? data.timpProgramat : dateTime.time,
      firstUploadDate:
        (data?.dataProgramata || "").length > 0 ? data.dataProgramata : dateTime.date,
      firstUploadTimestamp: date,
      ...(location === "BlogArticole"
        ? {
            scheduledAtTs: date,
            notificationState: "pending",
          }
        : {}),
    };

    if (isBlogArticole) {
      console.info("[BlogArticoleUpload] firestore:setDoc:start", {
        documentId: docRef.id,
        id,
        firstUploadDate: newData.firstUploadDate,
        firstUploadtime: newData.firstUploadtime,
        scheduledAtTs: date,
      });
    }

    // Face upload cu noul obiect de date care include ID-ul documentului
    if (isBlogArticole) assertArticleSize(newData, docRef.path);
    await setDoc(docRef, newData);

    if (isBlogArticole) {
      console.info("[BlogArticoleUpload] firestore:setDoc:success", {
        documentId: docRef.id,
        id,
        elapsedMs: Math.round(
          (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt
        ),
      });
    } else {
      console.log(`Documentul cu ID-ul ${docRef.id} a fost adăugat cu succes în ${location}.`);
    }
    return newData;
  } catch (err) {
    if (isBlogArticole) {
      console.error("[BlogArticoleUpload] firestore:setDoc:failed", {
        message: err?.message || String(err),
        code: err?.code,
        elapsedMs: Math.round(
          (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt
        ),
      });
      throw err;
    } else {
      console.log("Eroare la handleUploadFirestore...", err);
    }
  }
};

//ADD A DOCUMENT IN THE SUBCOLLECTION
export const handleUploadFirestoreSubcollection = async (data, location) => {
  console.log("create subcollection history...", data);
  try {
    const collectionLength = await getFirestoreCollectionLength(location);
    let id = collectionLength + 1;
    // Adăugarea documentului în subcolecție

    const docRef = doc(collection(db, location));

    // Actualizarea datelor cu ID-ul documentului generat
    const newData = { ...data, documentId: docRef.id, id };
    await setDoc(docRef, newData); // Actualizează documentul cu noul set de date, dacă este necesar

    console.log(`Document adăugat în subcolecție cu ID-ul: ${docRef.id}`);
  } catch (err) {
    console.log("Error on...handleUploadFirestoreSubcollection...", err);
  }
};

export const handleDeleteFirestoreAccount = async (
  location,
  currentPassword
) => {
  try {
    const ref = doc(db, location);

    await deleteDoc(ref).then(() => {
      handleDeleteAccount(currentPassword);
    });
  } catch (err) {
    console.log("Error on...handleDeleteFirestore...", err);
  }
};

//get firestore docs from a collection
export const handleGetFirestore = async (location) => {
  console.log("star....");
  let arr = []; // Specificați tipul de obiecte pe care îl conține matricea
  const querySnapshot = await getDocs(collection(db, location));
  querySnapshot.forEach((doc) => {
    // doc.data() is never undefined for query doc snapshots

    arr.push(doc.data());
  });

  return arr;
};

// Cached full collection read (use only when you must keep full dataset)
export const handleGetFirestoreCached = async (location, cacheMs = 60000) => {
  const cacheKey = `full:${location}`;
  const cached = getCacheEntry(cacheKey, cacheMs);
  if (cached) {
    console.log(`✅ [CACHE HIT] ${cacheKey}`);
    return cached.data;
  }
  const inFlight = firestoreInFlight.get(cacheKey);
  if (inFlight) {
    console.log(`🧩 [INFLIGHT HIT] ${cacheKey}`);
    return await inFlight;
  }
  console.log(`📥 [CACHE MISS] ${cacheKey}`);
  const promise = (async () => {
    try {
      const data = await handleGetFirestore(location);
      setCacheEntry(cacheKey, { data });
      return data;
    } finally {
      firestoreInFlight.delete(cacheKey);
    }
  })();
  firestoreInFlight.set(cacheKey, promise);
  return await promise;
};

// 🚀 OPTIMIZED VERSIONS - Versiuni cu limite pentru reducerea read-urilor
// PĂSTREAZĂ FUNCȚIA ORIGINALĂ NESCHIMBATĂ PENTRU COMPATIBILITATE

//get firestore docs from a collection WITH LIMIT - versiune optimizată
export const handleGetFirestoreWithLimit = async (location, limitCount = 50, orderByField = null, orderDirection = 'desc') => {
  console.log(`🔥 [OPTIMIZED] Fetching from ${location} with limit ${limitCount}`);
  
  try {
    let arr = [];
    let q = collection(db, location);
    
    // Adaugă ordering dacă e specificat
    if (orderByField) {
      q = query(q, orderBy(orderByField, orderDirection), limit(limitCount));
    } else {
      q = query(q, limit(limitCount));
    }
    
    const querySnapshot = await getDocs(q);
    querySnapshot.forEach((doc) => {
      arr.push({
        documentId: doc.id, // Adaugă documentId pentru referință
        ...doc.data()
      });
    });

    console.log(`✅ [OPTIMIZED] Fetched ${arr.length} docs from ${location} (limit: ${limitCount})`);
    return arr;
    
  } catch (error) {
    console.error(`❌ [OPTIMIZED] Error fetching ${location}:`, error);
    return [];
  }
};

// Cached version for first page (safe for admin lists). Cache is in-memory for 60s by default.
export const handleGetFirestoreWithLimitCached = async (
  location,
  limitCount = 50,
  orderByField = null,
  orderDirection = "desc",
  cacheMs = 60000
) => {
  const cacheKey = `limit:${location}:${limitCount}:${orderByField || "none"}:${orderDirection}`;
  const cached = getCacheEntry(cacheKey, cacheMs);
  if (cached) {
    console.log(`✅ [CACHE HIT] ${cacheKey}`);
    return cached.data;
  }
  const inFlight = firestoreInFlight.get(cacheKey);
  if (inFlight) {
    console.log(`🧩 [INFLIGHT HIT] ${cacheKey}`);
    return await inFlight;
  }
  console.log(`📥 [CACHE MISS] ${cacheKey}`);
  const promise = (async () => {
    try {
      const data = await handleGetFirestoreWithLimit(location, limitCount, orderByField, orderDirection);
      setCacheEntry(cacheKey, { data });
      return data;
    } finally {
      firestoreInFlight.delete(cacheKey);
    }
  })();
  firestoreInFlight.set(cacheKey, promise);
  return await promise;
};

//get firestore docs with pagination - versiune pentru încărcare progresivă
export const handleGetFirestorePaginated = async (location, limitCount = 20, lastVisible = null, orderByField = 'createdAt', orderDirection = 'desc') => {
  console.log(`📄 [PAGINATED] Fetching from ${location} - page size: ${limitCount}`);
  
  try {
    let arr = [];
    let q = collection(db, location);
    
    if (lastVisible) {
      q = query(q, orderBy(orderByField, orderDirection), startAfter(lastVisible), limit(limitCount));
    } else {
      q = query(q, orderBy(orderByField, orderDirection), limit(limitCount));
    }
    
    const querySnapshot = await getDocs(q);
    querySnapshot.forEach((doc) => {
      arr.push({
        documentId: doc.id,
        ...doc.data()
      });
    });

    const newLastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];
    const hasMore = querySnapshot.docs.length === limitCount;

    console.log(`✅ [PAGINATED] Fetched ${arr.length} docs from ${location}, hasMore: ${hasMore}`);
    
    return {
      data: arr,
      lastVisible: newLastVisible,
      hasMore: hasMore
    };
    
  } catch (error) {
    console.error(`❌ [PAGINATED] Error fetching ${location}:`, error);
    return {
      data: [],
      lastVisible: null,
      hasMore: false
    };
  }
};

// Cached first page for paginated lists (lastVisible must be null).
export const handleGetFirestorePaginatedCached = async (
  location,
  limitCount = 20,
  lastVisible = null,
  orderByField = "createdAt",
  orderDirection = "desc",
  cacheMs = 60000
) => {
  if (lastVisible) {
    console.log(`📄 [PAGINATED] skip cache (page>1) for ${location}`);
    return await handleGetFirestorePaginated(
      location,
      limitCount,
      lastVisible,
      orderByField,
      orderDirection
    );
  }
  const cacheKey = `page1:${location}:${limitCount}:${orderByField}:${orderDirection}`;
  const cached = getCacheEntry(cacheKey, cacheMs);
  if (cached) {
    console.log(`✅ [CACHE HIT] ${cacheKey}`);
    return cached.data;
  }
  const inFlight = firestoreInFlight.get(cacheKey);
  if (inFlight) {
    console.log(`🧩 [INFLIGHT HIT] ${cacheKey}`);
    return await inFlight;
  }
  console.log(`📥 [CACHE MISS] ${cacheKey}`);
  const promise = (async () => {
    try {
      const data = await handleGetFirestorePaginated(
        location,
        limitCount,
        null,
        orderByField,
        orderDirection
      );
      setCacheEntry(cacheKey, { data });
      return data;
    } finally {
      firestoreInFlight.delete(cacheKey);
    }
  })();
  firestoreInFlight.set(cacheKey, promise);
  return await promise;
};

//get active conferences with limit and ordering - versiune îmbunătățită
export const handleGetConferinteActiveOptimized = async (limitCount = 100) => {
  console.log(`🎪 [CONFERENCES OPTIMIZED] Fetching active conferences with limit ${limitCount}`);
  
  try {
    let arr = [];
    
    const q = query(
      collection(db, "ConferinteGrup"),
      where("status", "==", "activa"),
      orderBy("dataInceput", "asc"),
      limit(limitCount)
    );
    
    const querySnapshot = await getDocs(q);
    querySnapshot.forEach((doc) => {
      arr.push({
        documentId: doc.id,
        ...doc.data()
      });
    });

    console.log(`✅ [CONFERENCES OPTIMIZED] Fetched ${arr.length} active conferences`);
    return arr;
    
  } catch (error) {
    console.error(`❌ [CONFERENCES OPTIMIZED] Error fetching active conferences:`, error);
    return [];
  }
};

//DELETE FROM FIRESTORE DATA

export const handleDeleteFirestoreData = async (
  locationToDelete,
  getNewData,
  locationToGet = null
) => {
  try {
    const ref = doc(db, locationToDelete);
    await deleteDoc(ref);

    // Dacă getNewData este true, procedează la obținerea și actualizarea datelor
    if (getNewData) {
      const data = await handleGetFirestore(locationToGet); // Presupunem că returnează un array de obiecte

      // Sortează datele în ordinea crescătoare a ID-urilor
      data.sort((a, b) => a.id - b.id);

      let updatedData = []; // Inițializează un array gol pentru a stoca datele actualizate

      // Actualizează ID-urile documentelor rămase pentru a fi consecutive
      for (let i = 0; i < data.length; i++) {
        const newId = i + 1; // Calculul noului ID
        const docRef = doc(db, locationToGet, data[i].documentId); // Presupunem că fiecare document are un `docId` unic
        await updateDoc(docRef, {
          id: newId, // Actualizează ID-ul pentru a fi consecutiv
        });

        // Adaugă documentul actualizat în array-ul updatedData cu noul ID
        updatedData.push({
          ...data[i],
          id: newId,
        });
      }

      return updatedData; // Returnează datele actualizate dacă getNewData este true
    }
    // Dacă getNewData este false, nu returna nimic sau returnează o valoare specifică
    return null; // Sau orice altă valoare semnificativă pentru cazul tău
  } catch (err) {
    console.log("Error on...handleDeleteFirestore...", err);
    // Returnează null sau o valoare de eroare specifică în caz de eroare
    return null;
  }
};

//get all subcolletion from a collection
export const handleGetSubcollections = async (subcollection) => {
  try {
    // Creează o interogare pentru grupul de colecții "Localitati"
    const q = query(collectionGroup(db, subcollection));

    // Execută interogarea și preia documentele
    const querySnapshot = await getDocs(q);

    // Crează un array pentru a stoca rezultatele
    const docs = [];

    // Iterează prin rezultatele interogării
    querySnapshot.forEach((doc) => {
      // Adaugă documentul la array
      docs.push({ ...doc.data() });
    });

    // Returnează array-ul de localități
    return docs;
  } catch (err) {
    console.error("Eroare la preluarea subcolectiilor..... ", err);
    throw err; // Repropagă eroarea
  }
};

export const handleGetFirestoreSingleArrayData = async (location) => {
  console.log("Start...take from firestore array single", location);
  try {
    let arr = []; // Specificați tipul de obiecte pe care îl conține matricea
    const querySnapshot = await getDocs(collection(db, location));
    querySnapshot.forEach((doc) => {
      // doc.data() is never undefined for query doc snapshots
      console.log(doc.id, ` ${location} => `, doc.data());
      arr = doc.data();
    });
    return arr;
  } catch (err) {
    console.log("Error at handleGetFirestoreSingleArrayData...", err);
    return [];
  }
};

export const handleQueryFirestore = async (
  location,
  queryParamOne,
  elementOne = null,
  queryParamTwo = null,
  elementTwo = null
) => {
  console.log("start query firestore pentru elementOne...", elementOne);
  console.log("start query firestore pentru elementTwo...", elementTwo);
  let arr = []; // Specificați tipul de obiecte pe care îl conține matricea, de exemplu: let arr = [{}];
  let conditions = [];

  conditions.push(collection(db, location));

  if (elementOne) {
    conditions.push(where(queryParamOne, "==", elementOne));
  }

  if (elementTwo) {
    conditions.push(where(queryParamTwo, "==", elementTwo));
  }

  const q = query(...conditions);

  const querySnapshot = await getDocs(q);
  querySnapshot.forEach((doc) => {
    // doc.data() is never undefined for query doc snapshots
    console.log(doc.id, " => ", doc.data());
    arr.push(doc.data()); // Dacă dorești să adaugi un anumit câmp, specifică, de exemplu: doc.data().numeCamp
  });
  return arr;
};

export const handleQueryRandom = async (location, id) => {
  console.log("start query firestore location...", location);
  console.log("start query firestore id...", id);
  let obj = {}; // Specificați tipul de obiecte pe care îl conține matricea
  const q = query(collection(db, location), where("id", "==", id));

  const querySnapshot = await getDocs(q);
  querySnapshot.forEach((doc) => {
    // doc.data() is never undefined for query doc snapshots
    console.log(doc.id, " => ", doc.data());
    // arr.push(doc.data().data);
    obj = { ...doc.data() };
  });
  return obj;
};

export const handlePaginateFirestore = (location) => {
  const auth = authentication;
  const citiesRef = collection(db, "Users", auth.currentUser.uid, location);
  const q = query(citiesRef, startAt(1000000));
};

export const fetchArticlesPage = async (
  refresh = false,
  lastVisible = null
) => {
  try {
    let PAGE_SIZE = 4;
    let articles = [];

    let articlesRef = collection(db, "BlogArticole");
    let q = query(
      articlesRef,
      orderBy("firstUploadDate", "desc"),
      orderBy("firstUploadtime", "desc"),
      limit(PAGE_SIZE)
    );

    if (!refresh && lastVisible) {
      q = query(
        articlesRef,
        orderBy("firstUploadDate", "desc"),
        orderBy("firstUploadtime", "desc"),
        startAfter(lastVisible),
        limit(PAGE_SIZE)
      );
    }

    const documentSnapshots = await getDocs(q);
    let moreArticles = documentSnapshots.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    moreArticles = filterArticlesBeforeCurrentTime(moreArticles);
    articles = refresh ? moreArticles : [...articles, ...moreArticles];
    console.log("Start fetch...", articles);
    lastVisible = documentSnapshots.docs[documentSnapshots.docs.length - 1];
    return { articles, lastVisible };
  } catch (err) {
    console.error("Error fetching articles:", err);
    return { articles: [], lastVisible: null }; // Returnează o valoare implicită pentru a evita erorile
  }
};

export const getFirestoreQueryLength = async (
  location,
  queryParam,
  element
) => {
  const coll = collection(db, location);
  const q = query(coll, where(queryParam, "==", element));
  const snapshot = await getCountFromServer(q);
  return snapshot.data().count;
};

export const getFirestoreSubcollectionLength = async (
  subcollection,
  queryParam,
  element
) => {
  const q = query(
    collectionGroup(db, subcollection),
    where(queryParam, "==", element)
  );

  const snapshot = await getCountFromServer(q);
  return snapshot.data().count;
};

//FUNCTIE DE QUERY DIN SUBCOLLECTI CU NR NELIMITAT DE PARAMETRI
export const handleQueryFirestoreSubcollectionVariableParams = async (
  location,
  ...queryPairs
) => {
  let results = [];
  let constraints = [];

  // Construiește constrângerile interogării din perechile de parametri
  for (let i = 0; i < queryPairs.length; i += 2) {
    const queryParam = queryPairs[i];
    const element = queryPairs[i + 1];
    if (queryParam && element !== undefined) {
      constraints.push(where(queryParam, "==", element));
    }
  }

  // Dacă nu există constrângeri valide, returnează un array gol
  if (constraints.length === 0) {
    console.warn("No valid query constraints provided.");
    return results;
  }
  console.log("constraints...", constraints);
  // Interoghează subcolecția Localitati folosind constrângerile create
  let localitatiRef = query(collectionGroup(db, location), ...constraints);
  const querySnapshot = await getDocs(localitatiRef);

  // Adaugă fiecare document găsit în rezultate
  querySnapshot.forEach((doc) => {
    results.push(doc.data());
  });

  return results;
};

//UPDATE A DOCUMENT IN THE SUBCOLLECTION
export const handleUpdateFirestoreSubcollection = async (
  updatedData,
  location,
  actionText
) => {
  console.log("create subcollection history...", updatedData);
  try {
    //current date
    const dateTime = getCurrentDateTime();

    const ref = doc(db, location);

    const newData = {
      ...updatedData,
      EditDate: dateTime.date,
      Edittime: dateTime.time,
    };

    // UPLOAD ACTION OF USER
    if (actionText) {
      const currentUser = authentication.currentUser;
      let actionData = {
        actionText,
      };

      await handleUploadFirestoreSubcollection(
        actionData,
        `UsersJobs/${currentUser?.uid}/ActiuniJobs`,
        currentUser?.uid
      );
    }

    await updateDoc(ref, newData);
  } catch (err) {
    console.log("Error on...handleUploadFirestoreSubcollection...", err);
  }
};

//DELETE FROM FIRESTORE DATA

//DELETE FROM FIRESTORE SUBCOLLECTION DATA

export const handleDeleteFirestoreSubcollectionData = async (
  locationToDelete,
  getNewData,
  locationToGet = null,
  itemToDelete
) => {
  try {
    console.log("STart....delete...");
    const ref = doc(db, locationToDelete);
    await deleteDoc(ref);

    // Dacă getNewData este true, procedează la obținerea și actualizarea datelor
    if (getNewData) {
      const data = await handleGetFirestore(locationToGet); // Presupunem că returnează un array de obiecte

      // Sortează datele în ordinea crescătoare a ID-urilor
      data.sort((a, b) => a.id - b.id);

      console.log("test...", data);

      let updatedData = []; // Inițializează un array gol pentru a stoca datele actualizate

      // Actualizează ID-urile documentelor rămase pentru a fi consecutive
      for (let i = 0; i < data.length; i++) {
        const newId = i + 1; // Calculul noului ID

        const ref = doc(
          db,
          `UsersJobs/${data[i].collectionId}/Oferte/${data[i].documentId}`
        );

        const newData = {
          id: newId, // Actualizează ID-ul pentru a fi consecutiv
        };

        await updateDoc(ref, newData);

        // Adaugă documentul actualizat în array-ul updatedData cu noul ID
        updatedData.push({
          ...data[i],
          id: newId,
        });
      }

      return updatedData; // Returnează datele actualizate dacă getNewData este true
    }
    // Dacă getNewData este false, nu returna nimic sau returnează o valoare specifică
    return null; // Sau orice altă valoare semnificativă pentru cazul tău
  } catch (err) {
    console.log("Error on...handleDeleteFirestore...", err);
    // Returnează null sau o valoare de eroare specifică în caz de eroare
    return null;
  }
};

export const handleQueryFirestoreSubcollection = async (
  location,
  queryParamOne,
  elementOne = null,
  queryParamTwo = null,
  elementTwo = null
) => {
  let arr = [];
  let localitatiRef;
  // Pasul 1: Interoghează subcolecția Localitati
  if (queryParamTwo) {
    localitatiRef = query(
      collectionGroup(db, location),
      where(queryParamOne, "==", elementOne),
      where(queryParamTwo, "==", elementTwo)
    );
  } else {
    localitatiRef = query(
      collectionGroup(db, location),
      where(queryParamOne, "==", elementOne)
    );
  }

  const querySnapshot = await getDocs(localitatiRef);
  querySnapshot.forEach((doc) => {
    arr.push(doc.data());
  });
  return arr;
};

export const handleQueryDoubleParam = async (
  location,
  paramOne,
  elementOne,
  paramTwo,
  elementTwo
) => {
  let arr = []; // Specificați tipul de obiecte pe care îl conține matricea
  const q = query(
    collection(db, location),
    where(paramOne, "==", elementOne),
    where(paramTwo, "==", elementTwo)
  );

  const querySnapshot = await getDocs(q);
  querySnapshot.forEach((doc) => {
    // doc.data() is never undefined for query doc snapshots
    console.log(doc.id, " => ", doc.data());
    // arr.push(doc.data().data);
    arr.push(doc.data());
  });
  return arr;
};
export const handleQueryTripleParam = async (
  location,
  paramOne,
  elementOne,
  paramTwo,
  elementTwo,
  paramThree,
  elementThree,
  maxQuery = null
) => {
  let arr = []; // Specificați tipul de obiecte pe care îl conține matricea
  const q = query(
    collection(db, location),
    where(paramOne, "==", elementOne),
    where(paramTwo, "==", elementTwo),
    where(paramThree, "==", elementThree)
  );

  const querySnapshot = await getDocs(q);
  querySnapshot.forEach((doc) => {
    // doc.data() is never undefined for query doc snapshots
    console.log(doc.id, " => ", doc.data());
    // arr.push(doc.data().data);
    arr.push(doc.data());
  });
  return arr;
};
export const handleQueryPatruParam = async (
  location,
  paramOne,
  elementOne,
  paramTwo,
  elementTwo,
  paramThree,
  elementThree,
  paramPatru,
  elementPatru
) => {
  let arr = []; // Specificați tipul de obiecte pe care îl conține matricea
  const q = query(
    collection(db, location),
    where(paramOne, "==", elementOne),
    where(paramTwo, "==", elementTwo),
    where(paramThree, "==", elementThree),
    where(paramPatru, "==", elementPatru)
  );

  const querySnapshot = await getDocs(q);
  querySnapshot.forEach((doc) => {
    // doc.data() is never undefined for query doc snapshots
    console.log(doc.id, " => ", doc.data());
    // arr.push(doc.data().data);
    arr.push(doc.data());
  });
  return arr;
};

export const uploadJudete = async (jd) => {
  console.log("Start upload judete...");
  for (let i = 0; i < jd.length; i++) {
    const judetDoc = doc(collection(db, "Judete"));
    const judetData = {
      id: i + 1, // Numărul județului
      judet: jd[i].judet,
      documentId: judetDoc.id, // Adăugăm ID-ul documentului
    };
    await setDoc(judetDoc, judetData);

    for (let j = 0; j < jd[i].localitati.length; j++) {
      const localitateDoc = doc(collection(judetDoc, "Localitati"));
      const localitateData = {
        id: j + 1, // Numărul localității în cadrul județului
        localitate: jd[i].localitati[j],
        judet: jd[i].judet,
        documentId: localitateDoc.id, // Adăugăm ID-ul documentului
      };
      await setDoc(localitateDoc, localitateData);
    }
  }
};

export const handleQueryFirestoreSubcollectionTripleParam = async (
  location,
  queryParamOne,
  elementOne = null,
  queryParamTwo = null,
  elementTwo = null,
  queryParamThree = null,
  elementThree = null
) => {
  let arr = [];
  let localitatiRef;
  // Pasul 1: Interoghează subcolecția Localitati

  localitatiRef = query(
    collectionGroup(db, location),
    where(queryParamOne, "==", elementOne),
    where(queryParamTwo, "==", elementTwo),
    where(queryParamThree, "==", elementThree)
  );

  const querySnapshot = await getDocs(localitatiRef);
  querySnapshot.forEach((doc) => {
    arr.push(doc.data());
  });
  return arr;
};
export const handleQueryFirestoreSubcollectionPatruParam = async (
  location,
  queryParamOne,
  elementOne = null,
  queryParamTwo = null,
  elementTwo = null,
  queryParamThree = null,
  elementThree = null,
  queryParamPatru = null,
  elementPatru = null
) => {
  let arr = [];
  let localitatiRef;
  // Pasul 1: Interoghează subcolecția Localitati

  localitatiRef = query(
    collectionGroup(db, location),
    where(queryParamOne, "==", elementOne),
    where(queryParamTwo, "==", elementTwo),
    where(queryParamThree, "==", elementThree),
    where(queryParamPatru, "==", elementPatru)
  );

  const querySnapshot = await getDocs(localitatiRef);
  querySnapshot.forEach((doc) => {
    arr.push(doc.data());
  });
  return arr;
};
export const handleQueryFirestoreSubcollectionCinciParam = async (
  location,
  queryParamOne,
  elementOne = null,
  queryParamTwo = null,
  elementTwo = null,
  queryParamThree = null,
  elementThree = null,
  queryParamPatru = null,
  elementPatru = null,
  queryParamCinici = null,
  elementCinci = null
) => {
  let arr = [];
  let localitatiRef;
  // Pasul 1: Interoghează subcolecția Localitati

  localitatiRef = query(
    collectionGroup(db, location),
    where(queryParamOne, "==", elementOne),
    where(queryParamTwo, "==", elementTwo),
    where(queryParamThree, "==", elementThree),
    where(queryParamPatru, "==", elementPatru),
    where(queryParamCinici, "==", elementCinci)
  );

  const querySnapshot = await getDocs(localitatiRef);
  querySnapshot.forEach((doc) => {
    arr.push(doc.data());
  });
  return arr;
};
export const handleQueryFirestoreSubcollectionSaseParam = async (
  location,
  queryParamOne,
  elementOne = null,
  queryParamTwo = null,
  elementTwo = null,
  queryParamThree = null,
  elementThree = null,
  queryParamPatru = null,
  elementPatru = null,
  queryParamCinici = null,
  elementCinci = null,
  queryParamSase = null,
  elementSase = null
) => {
  let arr = [];
  let localitatiRef;
  // Pasul 1: Interoghează subcolecția Localitati
  console.log("....start....");
  localitatiRef = query(
    collectionGroup(db, location),
    where(queryParamOne, "==", elementOne),
    where(queryParamTwo, "==", elementTwo),
    where(queryParamThree, "==", elementThree),
    where(queryParamPatru, "==", elementPatru),
    where(queryParamCinici, "==", elementCinci),
    where(queryParamSase, "==", elementSase)
  );
  console.log("....start....2");

  const querySnapshot = await getDocs(localitatiRef);
  querySnapshot.forEach((doc) => {
    arr.push(doc.data());
  });
  return arr;
};

export async function getLocalitatiWithUserCounts() {
  // const countyCapitals = [
  //   "Alba Iulia",
  //   "Arad",
  //   "Pitesti",
  //   "Bacau",
  //   "Oradea",
  //   "Bistrita",
  //   "Botosani",
  //   "Braila",
  //   "Brasov",
  //   "Bucuresti",
  //   "Buzau",
  //   "Calarasi",
  //   "Resita",
  //   "Cluj-Napoca",
  //   "Constanta",
  //   "Sfantu Gheorghe",
  //   "Targoviste",
  //   "Craiova",
  //   "Galati",
  //   "Giurgiu",
  //   "Targu Jiu",
  //   "Miercurea Ciuc",
  //   "Deva",
  //   "Slobozia",
  //   "Iasi",
  //   "Baia Mare",
  //   "Drobeta-Turnu Severin",
  //   "Targu Mures",
  //   "Piatra Neamt",
  //   "Slatina",
  //   "Ploiesti",
  //   "Satu Mare",
  //   "Zalau",
  //   "Sibiu",
  //   "Suceava",
  //   "Alexandria",
  //   "Timisoara",
  //   "Tulcea",
  //   "Ramnicu Valcea",
  //   "Vaslui",
  //   "Focsani",
  //   "Afumati",
  //   "Popesti-Leordeni",
  //   "Voluntari",
  //   "Otopeni",
  //   "Chitila",
  //   "Magurele",
  //   "Corbeanca",
  //   "Buftea",
  //   "Bragadiru",
  //   "Pantelimon",
  // ];
  const counties = [
    "Alba",
    "Arad",
    "Arges",
    "Bacau",
    "Bihor",
    "Bistrita-Nasaud",
    "Botosani",
    "Braila",
    "Brasov",
    "Bucuresti",
    "Buzau",
    "Calarasi",
    "Caras-Severin",
    "Cluj",
    "Constanta",
    "Covasna",
    "Dambovita",
    "Dolj",
    "Galati",
    "Giurgiu",
    "Gorj",
    "Harghita",
    "Hunedoara",
    "Ialomita",
    "Iasi",
    "Ilfov",
    "Maramures",
    "Mehedinti",
    "Mures",
    "Neamt",
    "Olt",
    "Prahova",
    "Salaj",
    "Satu Mare",
    "Sibiu",
    "Suceava",
    "Teleorman",
    "Timis",
    "Tulcea",
    "Valcea",
    "Vaslui",
    "Vrancea",
  ];

  try {
    const counts = [];

    for (const judet of counties) {
      console.log(judet);
      const q = query(
        collection(db, "UsersJobs"),
        where("judet", "==", judet),
        where("statusCont", "==", "Activ"),
        where("userType", "==", "Partener")
      );
      const querySnapshot = await getDocs(q);
      const count = querySnapshot.size;
      if (count > 0) {
        counts.push({ localitate: judet, count });
      }
    }

    // Sortează rezultatele descrescător după count
    counts.sort((a, b) => b.count - a.count);

    return counts;
  } catch (error) {
    console.error("Error during data retrieval and processing: ", error);
    throw error; // Aruncă eroarea mai departe dacă dorești să o gestionezi și în alte părți ale aplicației
  }
}

//-------- PAGINATION -----

// Funcție pentru paginația conferințelor de grup
export const handleGetConferintePaginated = async (pageSize = 8, lastVisible = null) => {
  try {
    const ref = collection(db, "ConferinteGrup");
    let pageQuery;

    if (lastVisible) {
      // Pentru paginile următoare
      pageQuery = query(
        ref, 
        orderBy("firstUploadDate", "desc"), 
        startAfter(lastVisible),
        limit(pageSize)
      );
    } else {
      // Pentru prima pagină
      pageQuery = query(
        ref, 
        orderBy("firstUploadDate", "desc"), 
        limit(pageSize)
      );
    }

    const querySnapshot = await getDocs(pageQuery);
    const conferinte = [];
    let newLastVisible = null;

    querySnapshot.forEach((doc) => {
      conferinte.push(doc.data());
    });

    // Setează ultimul document vizibil pentru următoarea pagină
    if (querySnapshot.docs.length > 0) {
      newLastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];
    }

    return {
      conferinte,
      lastVisible: newLastVisible,
      hasMore: querySnapshot.docs.length === pageSize
    };
  } catch (error) {
    console.error("Error fetching paginated conferences:", error);
    throw error;
  }
};

// Funcție pentru paginația conferințelor ACTIVE pentru calendar public
export const handleGetConferinteActivePaginated = async (pageSize = 10, lastVisible = null) => {
  try {
    const ref = collection(db, "ConferinteGrup");
    let pageQuery;

    if (lastVisible) {
      // Pentru paginile următoare
      pageQuery = query(
        ref, 
        where("status", "==", "activa"),
        orderBy("dataInceput", "asc"), // Sortare după data începerii
        startAfter(lastVisible),
        limit(pageSize)
      );
    } else {
      // Pentru prima pagină
      pageQuery = query(
        ref, 
        where("status", "==", "activa"),
        orderBy("dataInceput", "asc"), // Sortare după data începerii
        limit(pageSize)
      );
    }

    const querySnapshot = await getDocs(pageQuery);
    const conferinte = [];
    let newLastVisible = null;

    querySnapshot.forEach((doc) => {
      conferinte.push(doc.data());
    });

    // Setează ultimul document vizibil pentru următoarea pagină
    if (querySnapshot.docs.length > 0) {
      newLastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];
    }

    return {
      conferinte,
      lastVisible: newLastVisible,
      hasMore: querySnapshot.docs.length === pageSize
    };
  } catch (error) {
    console.error("Error fetching paginated active conferences:", error);
    throw error;
  }
};

// Funcție optimizată pentru preluarea doar a conferințelor active (cu query Firestore)
export const handleGetConferinteActive = async () => {
  try {
    const ref = collection(db, "ConferinteGrup");
    const activeQuery = query(
      ref, 
      where("status", "==", "activa")
    );

    const querySnapshot = await getDocs(activeQuery);
    const conferinte = [];

    querySnapshot.forEach((doc) => {
      conferinte.push(doc.data());
    });

    return conferinte;
  } catch (error) {
    console.error("Error fetching active conferences:", error);
    throw error;
  }
};

// LISTEN TO CHANGE FOR VIDEO AUDIO CALL

// Stochează mesajul de offer sau answer în documentul rezervării consultatiei
// Stochează mesajul de offer sau answer în documentul rezervării consultatiei
export const setOfferAnswer = async (meetingId, offerAnswer, type) => {
  console.log("activat....setOfferAnswer....");
  console.log("meeting...id...", meetingId);
  console.log("offerAnswer...id...", offerAnswer);
  console.log("type...id...", type);

  const docRef = doc(db, "RezervariConsultatii", meetingId);

  // Pregătește obiectul de actualizare pentru Firestore în funcție de tipul primit
  const updateData = {};
  if (type === "offer") updateData.offer = offerAnswer;
  // Dacă tipul este 'offer', actualizează proprietatea `offer`
  else if (type === "answer") updateData.answer = offerAnswer; // Dacă tipul este 'answer', actualizează proprietatea `answer`

  await updateDoc(docRef, updateData);
};

// Setează ICE Candidates în documentul rezervării consultatiei
export const setICECandidate = async (meetingId, candidate) => {
  console.log("activat....setICECandidate....", candidate);
  const docRef = doc(db, "RezervariConsultatii", meetingId);
  await updateDoc(docRef, { candidate });
};

// Ascultă schimbările din documentul rezervării consultatiei
export const listenToFirestoreDocument = (meetingId, callback) => {
  console.log("activat....listenToFirestoreDocument....");
  const docRef = doc(db, "RezervariConsultatii", meetingId);
  return onSnapshot(docRef, (docSnapshot) => {
    callback(docSnapshot.data());
  });
};
