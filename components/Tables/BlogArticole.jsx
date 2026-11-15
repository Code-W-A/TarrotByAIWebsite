import { assertArticleSize } from "../../lib/articleSize";
import React, { useState, useEffect } from "react";
import { Box, CircularProgress, Stack, Typography } from "@mui/material";
import TableToolbar from "../ProcessTable/TableToolbar";

import IconInSelect from "../ProcessTable/IconInSelect";

import CustomTableContainer from "../ProcessTable/CustomTableContainer";
import { useStyles } from "../../styles/ProcessTableStyles";
import { editData, getData, writeData } from "../../utils/realtimeUtils";
import { getCurrentDateTime } from "../../utils/timeUtils";
import { uploadImage } from "../../utils/storageUtils";
import { authentication, db as firestoreDb, storage } from "../../firebase";
import { deleteDoc, doc } from "firebase/firestore";
import { getDatabase, ref, remove, child, set } from "firebase/database";
import { deleteObject, ref as storageRef } from "firebase/storage";

import CartiViitorFields from "../Dashboard/CartiViitorFields";
import DeleteDialog from "../DialogBox/DeleteDialog";
import BlogArticoleFields from "../Dashboard/BlogArticoleFields";
import {
  clearFirestorePaginatedCache,
  handleUpdateFirestore,
  handleUploadFirestore,
} from "../../utils/firestoreUtils";
import { handleYotubeLinksToArray } from "../../utils/youtubeLinkUtils";
import { buildScheduledDate, shouldQueueArticlePushNotification } from "../../lib/articleSchedule";
import { sortBlogArticlesDesc } from "../../lib/blogArticleSort";
import {
  logBlogArticoleUpload,
  logBlogArticoleUploadError,
  logBlogArticoleUploadWarn,
  summarizeArticleInfo,
} from "../../utils/blogArticoleUploadLogger";

export default function BlogArticole({
  articles,
  onArticleCreated,
  onArticleUpdated,
  onArticleDeleted,
}) {
  // const { db } = useMockup();
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [isEdit, setIsEdit] = useState(false);

  const [db, setDb] = useState([...articles]);

  useEffect(() => {
    setDb(sortBlogArticlesDesc(articles));
  }, [articles]);

  const [dialogData, setDialogData] = useState({});
  const [openDeleteDialog, setOpenDeleteDialog] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);
  const [showAddContract, setShowAddContract] = React.useState(false);
  const [openSoloPopup, setOpenSoloPopup] = React.useState(false);
  const settingsRef = React.useRef(null);
  const classes = useStyles();

  const [searchedDb, setSearchedDb] = useState([]);
  const [searchValue, setSearchValue] = useState("");

  const rebuildPublicArticlesCacheBestEffort = async (reason) => {
    logBlogArticoleUpload("cache-rebuild:start", { reason });
    try {
      const response = await fetch("/api/admin/articles-cache/rebuild", {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      });
      const payload = await response.json().catch(() => ({}));
      logBlogArticoleUpload("cache-rebuild:done", {
        reason,
        ok: response.ok,
        status: response.status,
        rowCount: payload?.rowCount ?? null,
      });
    } catch (error) {
      logBlogArticoleUploadError("cache-rebuild:failed", error, { reason });
    }
  };

  const handleSearchFilter = (value) => {
    const lowerCaseValue = value.toLowerCase();
    const filteredDb = db.filter((item) =>
      item.info.ro.nume.toLowerCase().includes(lowerCaseValue)
    );

    console.log(filteredDb);
    console.log(value);
    setSearchValue(value);
    setSearchedDb(filteredDb);
  };

  // Starea inițială setată pentru fiecare coloană Sortare
  const [sortConfig, setSortConfig] = useState({
    id: { direction: "ascending" },
    nume: { direction: "ascending" },
    descriere: { direction: "ascending" },
  });

  const handleSort = (key) => {
    console.log(db[0].info.ro[key]);
    console.log(db[0]);
    console.log(key);
    const direction =
      sortConfig[key].direction === "ascending" ? "descending" : "ascending";
    setSortConfig({ ...sortConfig, [key]: { direction } });

    const sortArray = (array) => {
      return array.sort((a, b) => {
        if (key === "id") {
          if (a[key] < b[key]) {
            return direction === "ascending" ? -1 : 1;
          }
          if (a[key] > b[key]) {
            return direction === "ascending" ? 1 : -1;
          }
        } else {
          if (a.info.ro[key] < b.info.ro[key]) {
            return direction === "ascending" ? -1 : 1;
          }
          if (a.info.ro[key] > b.info.ro[key]) {
            return direction === "ascending" ? 1 : -1;
          }
        }
        return 0;
      });
    };

    let sortedData;
    if (searchValue.length > 0) {
      sortedData = sortArray([...searchedDb]);
      setSearchedDb(sortedData);
    } else {
      sortedData = sortArray([...db]);
      setDb(sortedData);
    }
  };

  // ELIMINAT SI INLOCUIT CU GETSERVERSIDEPROPS
  // const handleGetData = async () => {
  //   console.log("Start......")
  //   setIsLoading(true);
  //   const data = await handleGetFirestore("BlogArticole");

  //   let rawData = [...data];
  //   const sortedArr = rawData.sort((a, b) => a.id - b.id);

  //   if (data) {
  //     setDb([...sortedArr]);
  //     setIsLoading(false);
  //   } else {
  //     setIsLoading(false);
  //     // Handle the case where servicesDB is undefined
  //     // For example, display an error message or take appropriate action
  //   }
  // };

  const handleShowDialog = (item) => {
    console.log(item);
    if (showSettings) {
      setDialogData({});
      setIsEdit(false);
      handleShowSettings();
    } else {
      setIsEdit(true);
      setDialogData(item);
      handleShowSettings();
    }
  };

  const handleShowSettings = () => {
    setShowSettings(!showSettings);
    if (dialogData.id) {
      setDialogData({});
      setIsEdit(false);
    }
  };

  const handleShowAddContract = () => {
    setShowAddContract(!showAddContract);
  };

  const handleDelete = () => {
    console.log("Start");
    setOpenDeleteDialog(!openDeleteDialog);
  };

  const confirmDelete = async () => {
    const startedAt = performance.now();
    const documentId = dialogData?.documentId;
    const legacyId = dialogData?.id;

    logBlogArticoleUpload("delete:start", {
      documentId: documentId || null,
      legacyId: legacyId ?? null,
      dbCountBefore: db.length,
      hasImage: Boolean(dialogData?.image?.fileName),
    });

    if (!documentId) {
      logBlogArticoleUploadError(
        "delete:failed",
        new Error("Lipseste documentId pentru articolul selectat."),
        { legacyId }
      );
      window.alert("Nu pot sterge articolul: lipseste ID-ul documentului.");
      return;
    }

    try {
      await deleteDoc(doc(firestoreDb, "BlogArticole", documentId));
      logBlogArticoleUpload("delete:firestore:success", { documentId });

      const currentUser = authentication.currentUser;
      const imageFileName = dialogData?.image?.fileName;

      if (imageFileName && currentUser?.uid) {
        try {
          await deleteObject(
            storageRef(storage, `images/Blog/${currentUser.uid}/${imageFileName}`)
          );
          logBlogArticoleUpload("delete:storage:success", { imageFileName });
        } catch (error) {
          logBlogArticoleUploadWarn("delete:storage:failed", {
            imageFileName,
            message: error?.message || String(error),
          });
        }
      }

      clearFirestorePaginatedCache("BlogArticole", 50, "firstUploadTimestamp", "desc");

      const nextDb = sortBlogArticlesDesc(
        db.filter(
          (item) => item.documentId !== documentId && item.id !== legacyId
        )
      );

      logBlogArticoleUpload("delete:ui-update", {
        documentId,
        dbCountAfter: nextDb.length,
        elapsedMs: Math.round(performance.now() - startedAt),
      });

      setDb(nextDb);
      setCurrentPage(1);
      setSearchValue("");
      setSearchedDb([]);
      onArticleDeleted?.(documentId);
      setShowSettings(false);
      setDialogData({});
      setIsEdit(false);
      setOpenDeleteDialog(false);
      void rebuildPublicArticlesCacheBestEffort("delete");

      logBlogArticoleUpload("delete:success", {
        documentId,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      logBlogArticoleUploadError("delete:failed", error, {
        documentId,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
      window.alert(
        error?.message ||
          "Nu am putut sterge articolul. Verifica autentificarea Firebase si consola browserului."
      );
    }
  };

  const handleEdit = async (
    info,
    image,
    initialImage,
    oldFileName,
    categorie,
    youtubeLink,
    timpProgramat,
    dataProgramata
  ) => {
    console.log("[BlogArticole] handleEdit start");
    console.log("youtubeLink....");
    console.log(youtubeLink);

    try {
      if (!db.some(item => item.id === dialogData.id)) throw new Error("Articolul nu mai este disponibil pentru editare. Reîncarcă lista.");
      const updateData = db.map(async (item) => {
        if (item.id === dialogData.id) {
          console.log("is found");
          assertArticleSize({ ...item, info, categorie, youtubeLinks: handleYotubeLinksToArray(youtubeLink), timpProgramat, dataProgramata });
          let data;
          const fallbackDate = item?.firstUploadTimestamp || new Date();
          if (image.length === 0) {
            let youtubeLinks = handleYotubeLinksToArray(youtubeLink);
            const date = buildScheduledDate({
              dataProgramata,
              timpProgramat,
              fallbackDate,
            });
            const queueNotification = shouldQueueArticlePushNotification(item, date);
            data = {
              ...item,
              firstUploadtime:
                timpProgramat.length > 0 ? timpProgramat : item.firstUploadTime,
              firstUploadDate:
                dataProgramata.length > 0
                  ? dataProgramata
                  : item.firstUploadDate,
              firstUploadTimestamp: date,
              info,
              image: initialImage,
              categorie,
              youtubeLinks,

              timpProgramat,
              dataProgramata,
              scheduledAtTs: date,
              notificationState: queueNotification ? "pending" : "sent",
            };
            console.log("if.....", data);
          } else {
            console.log("else.....", data);
            const newImage = await uploadImage(
              image,
              initialImage,
              true,
              "Blog",
              "Articole",
              oldFileName
            );
            let youtubeLinks = handleYotubeLinksToArray(youtubeLink);
            const date = buildScheduledDate({
              dataProgramata,
              timpProgramat,
              fallbackDate,
            });
            const queueNotification = shouldQueueArticlePushNotification(item, date);

            data = {
              ...item,
              firstUploadtime:
                timpProgramat.length > 0 ? timpProgramat : item.firstUploadTime,
              firstUploadDate:
                dataProgramata.length > 0
                  ? dataProgramata
                  : item.firstUploadDate,
              firstUploadTimestamp: date,
              info,
              image: newImage,
              categorie,
              youtubeLinks,
              timpProgramat,
              dataProgramata,
              scheduledAtTs: date,
              notificationState: queueNotification ? "pending" : "sent",
            };
          }
          await handleUpdateFirestore(`BlogArticole/${data.documentId}`, data);
          return data;
        } else {
          console.log("is not found");
          return item;
        }
      });
      // Use Promise.all to wait for all promises in the map to resolve
      const updatedData = await Promise.all(updateData);
      console.log("[BlogArticole] handleEdit updatedData length:", updatedData.length);
      const sorted = sortBlogArticlesDesc(updatedData);
      setDb(sorted);
      setCurrentPage(1);
      setSearchValue("");
      setSearchedDb([]);
      onArticleUpdated?.(
        sorted.find(
          (item) =>
            item.documentId === dialogData.documentId || item.id === dialogData.id
        )
      );
      handleShowDialog();
      void rebuildPublicArticlesCacheBestEffort("edit");
    } catch (err) {
      console.log("[BlogArticole] Error handleEdit...", err);
      throw err;
    }
  };

  const handleUpload = async (
    info,
    selectedImages,
    categorie,
    youtubeLink,
    timpProgramat,
    dataProgramata
  ) => {
    const startedAt = performance.now();
    const authUser = authentication.currentUser;

    logBlogArticoleUpload("handleUpload:start", {
      uid: authUser?.uid || null,
      email: authUser?.email || null,
      imageCount: selectedImages?.length || 0,
      categorie,
      dataProgramata,
      timpProgramat,
      article: summarizeArticleInfo(info),
      dbCountBefore: db.length,
    });

    if (!authUser?.uid) {
      logBlogArticoleUploadWarn("handleUpload:no-auth-user", {
        hint: "Firebase Storage foloseste currentUser.uid pentru calea imaginii.",
      });
    }

    if (!selectedImages?.length) {
      logBlogArticoleUploadWarn("handleUpload:no-image-selected", {
        hint: "Selectati cel putin o imagine inainte de salvare.",
      });
    }

    try {
      assertArticleSize({ info, categorie, youtubeLinks: handleYotubeLinksToArray(youtubeLink), timpProgramat, dataProgramata });
      logBlogArticoleUpload("handleUpload:image-upload:start");
      const image = await uploadImage(
        selectedImages,
        [],
        false,
        "Blog",
        "Articole"
      );
      logBlogArticoleUpload("handleUpload:image-upload:done", {
        hasImage: Boolean(image?.finalUri),
        fileName: image?.fileName || null,
      });

      if (!image?.finalUri) {
        throw new Error(
          "Imaginea nu a putut fi incarcata. Selectati o imagine si verificati autentificarea Firebase."
        );
      }

      let youtubeLinks = handleYotubeLinksToArray(youtubeLink);

      const data = {
        info,
        image,
        categorie,
        youtubeLinks,
        timpProgramat,
        dataProgramata,
      };

      logBlogArticoleUpload("handleUpload:firestore:start", {
        categorie,
        youtubeLinksCount: youtubeLinks?.length || 0,
        article: summarizeArticleInfo(info),
      });

      const dataReturned = await handleUploadFirestore(data, "BlogArticole");

      logBlogArticoleUpload("handleUpload:firestore:done", {
        documentId: dataReturned?.documentId || null,
        id: dataReturned?.id ?? null,
        scheduledAtTs: dataReturned?.scheduledAtTs || null,
      });

      if (!dataReturned) {
        throw new Error("Articolul nu a putut fi salvat in Firestore.");
      }

      const sorted = sortBlogArticlesDesc([...db, dataReturned]);

      logBlogArticoleUpload("handleUpload:ui-update", {
        dbCountAfter: sorted.length,
        topDocumentId: sorted[0]?.documentId || null,
        elapsedMs: Math.round(performance.now() - startedAt),
      });

      setDb(sorted);
      setCurrentPage(1);
      setSearchValue("");
      setSearchedDb([]);
      onArticleCreated?.(dataReturned);
      setShowSettings(!showSettings);
      void rebuildPublicArticlesCacheBestEffort("upload");

      logBlogArticoleUpload("handleUpload:success", {
        documentId: dataReturned.documentId,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    } catch (err) {
      logBlogArticoleUploadError("handleUpload:failed", err, {
        elapsedMs: Math.round(performance.now() - startedAt),
      });
      throw err;
    }
  };

  const handleShowSoloPopup = () => {
    setOpenSoloPopup(!openSoloPopup);
  };

  // useEffect(() => {
  //   handleGetData();
  //   // console.log(db);
  // }, []);

  return (
    <>
      {showSettings ? (
        <BlogArticoleFields
          handleEdit={handleEdit}
          handleUpload={handleUpload}
          handleShowSettings={handleShowSettings}
          isEdit={isEdit}
          dialogData={dialogData}
          handleDelete={handleDelete}
        />
      ) : (
        <>
          <Box component="main" className={classes.mainBox}>
            <Box>
              <TableToolbar
                isMainToolbar={true}
                handleShowSettings={handleShowSettings}
                handleShowAddContract={handleShowAddContract}
                handleShowSoloPopup={handleShowSoloPopup}
                settingsRef={settingsRef}
                db={db}
                handleSearchFilter={handleSearchFilter}
              />
              <TableToolbar />
              <Stack direction="column" alignItems="center">
                {isLoading ? (
                  <CircularProgress />
                ) : db.length === 0 ? (
                  <Typography
                    sx={{
                      fontSize: 20,
                      marginTop: 5,
                      fontWeight: "400",
                      color: "white",
                    }}
                  >
                    Nu sunt articole adăugate
                  </Typography>
                ) : (
                  <CustomTableContainer
                    currentPage={currentPage}
                    setCurrentPage={setCurrentPage}
                    db={db}
                    searchedDb={searchedDb}
                    searchValue={searchValue}
                    handleShowDialog={handleShowDialog}
                    showNume={true}
                    showDesc={true}
                    sortConfig={sortConfig}
                    handleSort={handleSort}
                  />
                )}
              </Stack>
            </Box>
          </Box>
          <IconInSelect
            anchorEl={settingsRef.current}
            open={openSoloPopup}
            onClose={setOpenSoloPopup}
          />
        </>
      )}
      <DeleteDialog
        openConfirmDialog={openDeleteDialog}
        handleDelete={handleDelete}
        confirmDelete={confirmDelete}
      />
    </>
  );
}
