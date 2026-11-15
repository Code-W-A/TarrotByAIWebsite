import { articleDocumentBytes, assertArticleSize, articleSaveError } from "../../lib/articleSize";
import React, { useState, useRef, useEffect } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  Typography,
  TextField,
  Grid,
  Button,
  Card,
  CardContent,
  CardMedia,
  CardActions,
  IconButton,
  ImageList,
  ImageListItem,
  Fab,
  Box,
  Chip,
  useMediaQuery,
  useTheme,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from "@mui/material";
import dayjs from "dayjs";
import { createArticleTranslationSession, runArticleTranslation } from "../../lib/articleTranslation";
import GTranslateIcon from "@mui/icons-material/GTranslate";
import { StyledTextField } from "../../styles/FormStyles";
import DeleteIcon from "@mui/icons-material/Delete";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import HorizontalLineWithText from "../HorizontalLineText";
import ArticleEditor from "../QuillForm";
import AddCircleIcon from "@mui/icons-material/AddCircle";
import FieldRow from "./FieldRow";
import LoadingDialog from "../DialogBox/DialogLoader";
import { LANGUAGE_LABELS } from "../../data/constants";
import { gTranslateFetch } from "../../utils/apiUtils";
import DropdownFieldRow from "./DropdownFieldRow";
import DropdownFieldCategorii from "./DropdownFieldCategorii";
import DateTimePicker from "./DateTimePicker";
import {
  logBlogArticoleUpload,
  logBlogArticoleUploadError,
  summarizeArticleInfo,
} from "../../utils/blogArticoleUploadLogger";
import { authentication } from "../../firebase";

export default function BlogArticoleFields({
  handleUpload,
  handleEdit,
  handleShowSettings,
  isEdit,
  dialogData,
  handleDelete,
}) {
  const translationSession = useRef(null);
  const translationController = useRef(null);
  const [translating, setTranslating] = useState(false);
  const [translationStatus, setTranslationStatus] = useState("");
  const [translationError, setTranslationError] = useState("");
  useEffect(() => () => translationController.current?.abort(), []);
  const closeForm = () => {
    if (saveInFlight.current) return;
    translationController.current?.abort();
    handleShowSettings();
  };
  // Funcția de actualizare a conținutului editorului
  const handleContentChange = (value) => {
    setContent(value);
  };
  const [loading, setLoading] = useState(false);
  const saveInFlight = useRef(false);
  const [saveError, setSaveError] = useState(null);

  const [selectedImages, setSelectedImages] = useState([]);
  const [image, setImage] = useState(dialogData.image ? dialogData.image : "");
  const [youtubeLink, setYoutubeLink] = useState(
    dialogData.youtubeLinks ? dialogData.youtubeLinks.join("; ") : ""
  );
  const [categorie, setCategorie] = useState(
    dialogData.categorie ? dialogData.categorie : ""
  );

  const [dataProgramata, setDataProgramata] = useState(
    dialogData.dataProgramata ? dialogData.dataProgramata : ""
  );
  const [timpProgramat, setTimpProgramat] = useState(
    dialogData.timpProgramat ? dialogData.timpProgramat : ""
  );

  const [fileInputKey, setFileInputKey] = useState(Date.now());

  //---RO---
  const [numeRo, setNumeRo] = useState(
    dialogData.info ? dialogData?.info?.ro?.nume : ""
  );
  const [descriereRo, setDescriereRo] = useState(
    dialogData.info ? dialogData?.info?.ro?.descriere : ""
  );
  const [contentRo, setContentRo] = useState(
    dialogData.info ? dialogData?.info?.ro?.content : ""
  );

  //---EN---
  const [numeEn, setNumeEn] = useState(
    dialogData.info ? dialogData?.info?.en?.nume : ""
  );
  const [descriereEn, setDescriereEn] = useState(
    dialogData.info ? dialogData?.info?.en?.descriere : ""
  );
  const [contentEn, setContentEn] = useState(
    dialogData.info ? dialogData?.info?.en?.content : ""
  );

  //---ES---
  const [numeEs, setNumeEs] = useState(
    dialogData.info ? dialogData?.info?.es?.nume : ""
  );
  const [descriereEs, setDescriereEs] = useState(
    dialogData.info ? dialogData?.info?.es?.descriere : ""
  );
  const [contentEs, setContentEs] = useState(
    dialogData.info ? dialogData?.info?.es?.content : ""
  );

  //---IT---
  const [numeIt, setNumeIt] = useState(
    dialogData.info ? dialogData?.info?.it?.nume : ""
  );
  const [descriereIt, setDescriereIt] = useState(
    dialogData.info ? dialogData?.info?.it?.descriere : ""
  );
  const [contentIt, setContentIt] = useState(
    dialogData.info ? dialogData?.info?.it?.content : ""
  );

  //---PL---
  const [numePl, setNumePl] = useState(
    dialogData.info ? dialogData?.info?.pl?.nume : ""
  );
  const [descrierePl, setDescrierePl] = useState(
    dialogData.info ? dialogData?.info?.pl?.descriere : ""
  );
  const [contentPl, setContentPl] = useState(
    dialogData.info ? dialogData?.info?.pl?.content : ""
  );

  //---DE---
  const [numeDe, setNumeDe] = useState(
    dialogData.info ? dialogData?.info?.de?.nume : ""
  );
  const [descriereDe, setDescriereDe] = useState(
    dialogData.info ? dialogData?.info?.de?.descriere : ""
  );
  const [contentDe, setContentDe] = useState(
    dialogData.info ? dialogData?.info?.de?.content : ""
  );

  //---HU care este HI---
  const [numeHu, setNumeHu] = useState(
    dialogData.info ? dialogData?.info?.hu?.nume : ""
  );
  const [descriereHu, setDescriereHu] = useState(
    dialogData.info ? dialogData?.info?.hu?.descriere : ""
  );
  const [contentHu, setContentHu] = useState(
    dialogData.info ? dialogData?.info?.hu?.content : ""
  );

  //---CS---
  const [numeCs, setNumeCs] = useState(
    dialogData.info ? dialogData?.info?.cs?.nume : ""
  );
  const [descriereCs, setDescriereCs] = useState(
    dialogData.info ? dialogData?.info?.cs?.descriere : ""
  );
  const [contentCs, setContentCs] = useState(
    dialogData.info ? dialogData?.info?.cs?.content : ""
  );

  //---SK---
  const [numeSk, setNumeSk] = useState(
    dialogData.info ? dialogData?.info?.sk?.nume : ""
  );
  const [descriereSk, setDescriereSk] = useState(
    dialogData.info ? dialogData?.info?.sk?.descriere : ""
  );
  const [contentSk, setContentSk] = useState(
    dialogData.info ? dialogData?.info?.sk?.content : ""
  );

  //---HR---
  const [numeHr, setNumeHr] = useState(
    dialogData.info ? dialogData?.info?.hr?.nume : ""
  );
  const [descriereHr, setDescriereHr] = useState(
    dialogData.info ? dialogData?.info?.hr?.descriere : ""
  );
  const [contentHr, setContentHr] = useState(
    dialogData.info ? dialogData?.info?.hr?.content : ""
  );

  //---RU care este ID---
  const [numeRu, setNumeRu] = useState(
    dialogData.info ? dialogData?.info?.ru?.nume : ""
  );
  const [descriereRu, setDescriereRu] = useState(
    dialogData.info ? dialogData?.info?.ru?.descriere : ""
  );
  const [contentRu, setContentRu] = useState(
    dialogData.info ? dialogData?.info?.ru?.content : ""
  );

  //---BG---
  const [numeBg, setNumeBg] = useState(
    dialogData.info ? dialogData?.info?.bg?.nume : ""
  );
  const [descriereBg, setDescriereBg] = useState(
    dialogData.info ? dialogData?.info?.bg?.descriere : ""
  );
  const [contentBg, setContentBg] = useState(
    dialogData.info ? dialogData?.info?.bg?.content : ""
  );

  //---EL---
  const [numeEl, setNumeEl] = useState(
    dialogData.info ? dialogData?.info?.el?.nume : ""
  );
  const [descriereEl, setDescriereEl] = useState(
    dialogData.info ? dialogData?.info?.el?.descriere : ""
  );
  const [contentEl, setContentEl] = useState(
    dialogData.info ? dialogData?.info?.el?.content : ""
  );

  //---FR---
  const [numeFr, setNumeFr] = useState(
    dialogData.info ? dialogData?.info?.fr?.nume : ""
  );
  const [descriereFr, setDescriereFr] = useState(
    dialogData.info ? dialogData?.info?.fr?.descriere : ""
  );
  const [contentFr, setContentFr] = useState(
    dialogData.info ? dialogData?.info?.fr?.content : ""
  );

  // --- RU (Rusa) ---
  const [numeRusa, setNumeRusa] = useState(
    dialogData.info ? dialogData?.info?.rusa?.nume : ""
  );
  const [descriereRusa, setDescriereRusa] = useState(
    dialogData.info ? dialogData?.info?.rusa?.descriere : ""
  );
  const [contentRusa, setContentRusa] = useState(
    dialogData.info ? dialogData?.info?.rusa?.content : ""
  );

  // --- TR (Turca) ---
  const [numeTr, setNumeTr] = useState(
    dialogData.info ? dialogData?.info?.tr?.nume : ""
  );
  const [descriereTr, setDescriereTr] = useState(
    dialogData.info ? dialogData?.info?.tr?.descriere : ""
  );
  const [contentTr, setContentTr] = useState(
    dialogData.info ? dialogData?.info?.tr?.content : ""
  );

  // --- AR (Araba) ---
  const [numeAr, setNumeAr] = useState(
    dialogData.info ? dialogData?.info?.ar?.nume : ""
  );
  const [descriereAr, setDescriereAr] = useState(
    dialogData.info ? dialogData?.info?.ar?.descriere : ""
  );
  const [contentAr, setContentAr] = useState(
    dialogData.info ? dialogData?.info?.ar?.content : ""
  );

  // --- SQ (Albaneza) ---
  const [numeSq, setNumeSq] = useState(
    dialogData.info ? dialogData?.info?.sq?.nume : ""
  );
  const [descriereSq, setDescriereSq] = useState(
    dialogData.info ? dialogData?.info?.sq?.descriere : ""
  );
  const [contentSq, setContentSq] = useState(
    dialogData.info ? dialogData?.info?.sq?.content : ""
  );

  const languageFields = [
    // Română
    {
      id: "nume-ro",
      label: LANGUAGE_LABELS.ro.name,
      value: numeRo,
      setValue: setNumeRo,
      denumire: LANGUAGE_LABELS.ro.denumire,
    },
    {
      id: "descriere-ro",
      label: LANGUAGE_LABELS.ro.description,
      value: descriereRo,
      setValue: setDescriereRo,
      denumire: LANGUAGE_LABELS.ro.denumire,
    },
    {
      id: "content-ro",
      label: LANGUAGE_LABELS.ro?.content,
      value: contentRo,
      setValue: setContentRo,
      denumire: LANGUAGE_LABELS.ro.denumire,
    },
    // Engleză
    {
      id: "nume-en",
      label: LANGUAGE_LABELS.en.name,
      value: numeEn,
      setValue: setNumeEn,
      denumire: LANGUAGE_LABELS.en.denumire,
    },
    {
      id: "descriere-en",
      label: LANGUAGE_LABELS.en.description,
      value: descriereEn,
      setValue: setDescriereEn,
      denumire: LANGUAGE_LABELS.en.denumire,
    },
    {
      id: "content-en",
      label: LANGUAGE_LABELS.en?.content,
      value: contentEn,
      setValue: setContentEn,
      denumire: LANGUAGE_LABELS.en.denumire,
    },
    // Spaniolă
    {
      id: "nume-es",
      label: LANGUAGE_LABELS.es.name,
      value: numeEs,
      setValue: setNumeEs,
      denumire: LANGUAGE_LABELS.es.denumire,
    },
    {
      id: "descriere-es",
      label: LANGUAGE_LABELS.es.description,
      value: descriereEs,
      setValue: setDescriereEs,
      denumire: LANGUAGE_LABELS.es.denumire,
    },
    {
      id: "content-es",
      label: LANGUAGE_LABELS.es?.content,
      value: contentEs,
      setValue: setContentEs,
      denumire: LANGUAGE_LABELS.es.denumire,
    },
    // Italiană
    {
      id: "nume-it",
      label: LANGUAGE_LABELS.it.name,
      value: numeIt,
      setValue: setNumeIt,
      denumire: LANGUAGE_LABELS.it.denumire,
    },
    {
      id: "descriere-it",
      label: LANGUAGE_LABELS.it.description,
      value: descriereIt,
      setValue: setDescriereIt,
      denumire: LANGUAGE_LABELS.it.denumire,
    },
    {
      id: "content-it",
      label: LANGUAGE_LABELS.it?.content,
      value: contentIt,
      setValue: setContentIt,
      denumire: LANGUAGE_LABELS.it.denumire,
    },
    // Poloneză
    {
      id: "nume-pl",
      label: LANGUAGE_LABELS.pl.name,
      value: numePl,
      setValue: setNumePl,
      denumire: LANGUAGE_LABELS.pl.denumire,
    },
    {
      id: "descriere-pl",
      label: LANGUAGE_LABELS.pl.description,
      value: descrierePl,
      setValue: setDescrierePl,
      denumire: LANGUAGE_LABELS.pl.denumire,
    },
    {
      id: "content-pl",
      label: LANGUAGE_LABELS.pl?.content,
      value: contentPl,
      setValue: setContentPl,
      denumire: LANGUAGE_LABELS.pl.denumire,
    },
    // Germană
    {
      id: "nume-de",
      label: LANGUAGE_LABELS.de.name,
      value: numeDe,
      setValue: setNumeDe,
      denumire: LANGUAGE_LABELS.de.denumire,
    },
    {
      id: "descriere-de",
      label: LANGUAGE_LABELS.de.description,
      value: descriereDe,
      setValue: setDescriereDe,
      denumire: LANGUAGE_LABELS.de.denumire,
    },
    {
      id: "content-de",
      label: LANGUAGE_LABELS.de?.content,
      value: contentDe,
      setValue: setContentDe,
      denumire: LANGUAGE_LABELS.de.denumire,
    },
    // Hindi
    {
      id: "nume-hu",
      label: LANGUAGE_LABELS.hi.name,
      value: numeHu,
      setValue: setNumeHu,
      denumire: LANGUAGE_LABELS.hi.denumire,
    },
    {
      id: "descriere-hu",
      label: LANGUAGE_LABELS.hi.description,
      value: descriereHu,
      setValue: setDescriereHu,
      denumire: LANGUAGE_LABELS.hi.denumire,
    },
    {
      id: "content-hu",
      label: LANGUAGE_LABELS.hi?.content,
      value: contentHu,
      setValue: setContentHu,
      denumire: LANGUAGE_LABELS.hi.denumire,
    },
    // Cehă
    {
      id: "nume-cs",
      label: LANGUAGE_LABELS.cs.name,
      value: numeCs,
      setValue: setNumeCs,
      denumire: LANGUAGE_LABELS.cs.denumire,
    },
    {
      id: "descriere-cs",
      label: LANGUAGE_LABELS.cs.description,
      value: descriereCs,
      setValue: setDescriereCs,
      denumire: LANGUAGE_LABELS.cs.denumire,
    },
    {
      id: "content-cs",
      label: LANGUAGE_LABELS.cs?.content,
      value: contentCs,
      setValue: setContentCs,
      denumire: LANGUAGE_LABELS.cs.denumire,
    },
    // Slovacă
    {
      id: "nume-sk",
      label: LANGUAGE_LABELS.sk.name,
      value: numeSk,
      setValue: setNumeSk,
      denumire: LANGUAGE_LABELS.sk.denumire,
    },
    {
      id: "descriere-sk",
      label: LANGUAGE_LABELS.sk.description,
      value: descriereSk,
      setValue: setDescriereSk,
      denumire: LANGUAGE_LABELS.sk.denumire,
    },
    {
      id: "content-sk",
      label: LANGUAGE_LABELS.sk?.content,
      value: contentSk,
      setValue: setContentSk,
      denumire: LANGUAGE_LABELS.sk.denumire,
    },
    // Croată
    {
      id: "nume-hr",
      label: LANGUAGE_LABELS.hr.name,
      value: numeHr,
      setValue: setNumeHr,
      denumire: LANGUAGE_LABELS.hr.denumire,
    },
    {
      id: "descriere-hr",
      label: LANGUAGE_LABELS.hr.description,
      value: descriereHr,
      setValue: setDescriereHr,
      denumire: LANGUAGE_LABELS.hr.denumire,
    },
    {
      id: "content-hr",
      label: LANGUAGE_LABELS.hr?.content,
      value: contentHr,
      setValue: setContentHr,
      denumire: LANGUAGE_LABELS.hr.denumire,
    },
    // Indoneziana
    {
      id: "nume-ru",
      label: LANGUAGE_LABELS.id.name,
      value: numeRu,
      setValue: setNumeRu,
      denumire: LANGUAGE_LABELS.id.denumire,
    },
    {
      id: "descriere-ru",
      label: LANGUAGE_LABELS.id.description,
      value: descriereRu,
      setValue: setDescriereRu,
      denumire: LANGUAGE_LABELS.id.denumire,
    },
    {
      id: "content-ru",
      label: LANGUAGE_LABELS.id?.content,
      value: contentRu,
      setValue: setContentRu,
      denumire: LANGUAGE_LABELS.id.denumire,
    },
    // Bulgară
    {
      id: "nume-bg",
      label: LANGUAGE_LABELS.bg.name,
      value: numeBg,
      setValue: setNumeBg,
      denumire: LANGUAGE_LABELS.bg.denumire,
    },
    {
      id: "descriere-bg",
      label: LANGUAGE_LABELS.bg.description,
      value: descriereBg,
      setValue: setDescriereBg,
      denumire: LANGUAGE_LABELS.bg.denumire,
    },
    {
      id: "content-bg",
      label: LANGUAGE_LABELS.bg?.content,
      value: contentBg,
      setValue: setContentBg,
      denumire: LANGUAGE_LABELS.bg.denumire,
    },
    // Greacă
    {
      id: "nume-el",
      label: LANGUAGE_LABELS.el.name,
      value: numeEl,
      setValue: setNumeEl,
      denumire: LANGUAGE_LABELS.el.denumire,
    },
    {
      id: "descriere-el",
      label: LANGUAGE_LABELS.el.description,
      value: descriereEl,
      setValue: setDescriereEl,
      denumire: LANGUAGE_LABELS.el.denumire,
    },
    {
      id: "content-el",
      label: LANGUAGE_LABELS.el?.content,
      value: contentEl,
      setValue: setContentEl,
      denumire: LANGUAGE_LABELS.el.denumire,
    },
    // Franceză
    {
      id: "nume-fr",
      label: LANGUAGE_LABELS.fr.name,
      value: numeFr,
      setValue: setNumeFr,
      denumire: LANGUAGE_LABELS.fr.denumire,
    },
    {
      id: "descriere-fr",
      label: LANGUAGE_LABELS.fr.description,
      value: descriereFr,
      setValue: setDescriereFr,
      denumire: LANGUAGE_LABELS.fr.denumire,
    },
    {
      id: "content-fr",
      label: LANGUAGE_LABELS.fr?.content,
      value: contentFr,
      setValue: setContentFr,
      denumire: LANGUAGE_LABELS.fr.denumire,
    },
    // --- RU (Rusa) ---
    {
      id: "nume-rusa",
      label: LANGUAGE_LABELS.ru.name,
      value: numeRusa,
      setValue: setNumeRusa,
      denumire: LANGUAGE_LABELS.ru.denumire,
    },
    {
      id: "descriere-rusa",
      label: LANGUAGE_LABELS.ru.description,
      value: descriereRusa,
      setValue: setDescriereRusa,
      denumire: LANGUAGE_LABELS.ru.denumire,
    },
    {
      id: "content-rusa",
      label: LANGUAGE_LABELS.ru?.content,
      value: contentRusa,
      setValue: setContentRusa,
      denumire: LANGUAGE_LABELS.ru.denumire,
    },

    // --- TR (Turca) ---
    {
      id: "nume-tr",
      label: LANGUAGE_LABELS.tr.name,
      value: numeTr,
      setValue: setNumeTr,
      denumire: LANGUAGE_LABELS.tr.denumire,
    },
    {
      id: "descriere-tr",
      label: LANGUAGE_LABELS.tr.description,
      value: descriereTr,
      setValue: setDescriereTr,
      denumire: LANGUAGE_LABELS.tr.denumire,
    },
    {
      id: "content-tr",
      label: LANGUAGE_LABELS.tr?.content,
      value: contentTr,
      setValue: setContentTr,
      denumire: LANGUAGE_LABELS.tr.denumire,
    },

    // --- AR (Araba) ---
    {
      id: "nume-ar",
      label: LANGUAGE_LABELS.ar.name,
      value: numeAr,
      setValue: setNumeAr,
      denumire: LANGUAGE_LABELS.ar.denumire,
    },
    {
      id: "descriere-ar",
      label: LANGUAGE_LABELS.ar.description,
      value: descriereAr,
      setValue: setDescriereAr,
      denumire: LANGUAGE_LABELS.ar.denumire,
    },
    {
      id: "content-ar",
      label: LANGUAGE_LABELS.ar?.content,
      value: contentAr,
      setValue: setContentAr,
      denumire: LANGUAGE_LABELS.ar.denumire,
    },

    // --- SQ (Albaneza) ---
    {
      id: "nume-sq",
      label: LANGUAGE_LABELS.sq.name,
      value: numeSq,
      setValue: setNumeSq,
      denumire: LANGUAGE_LABELS.sq.denumire,
    },
    {
      id: "descriere-sq",
      label: LANGUAGE_LABELS.sq.description,
      value: descriereSq,
      setValue: setDescriereSq,
      denumire: LANGUAGE_LABELS.sq.denumire,
    },
    {
      id: "content-sq",
      label: LANGUAGE_LABELS.sq?.content,
      value: contentSq,
      setValue: setContentSq,
      denumire: LANGUAGE_LABELS.sq.denumire,
    },

    // Adaugă aici orice alte limbi necesare, respectând acest format.
  ];

  const handleImageDelete = (index) => {
    const updatedImages = [...selectedImages];
    updatedImages.splice(index, 1);
    setSelectedImages(updatedImages);
    setImage("");
  };

  const handleImageChange = (event) => {
    const files = event.target.files;
    const nextFiles = [...selectedImages, ...Array.from(files)];
    logBlogArticoleUpload("form:image-selected", {
      addedCount: files?.length || 0,
      totalCount: nextFiles.length,
      names: nextFiles.map((file) => file?.name).filter(Boolean),
    });
    setSelectedImages(nextFiles);
    setFileInputKey(Date.now()); // Reset the input to allow selecting more images
  };

  const articleInfo = {
      ro: { nume: numeRo, descriere: descriereRo, content: contentRo },
      en: { nume: numeEn, descriere: descriereEn, content: contentEn },
      es: { nume: numeEs, descriere: descriereEs, content: contentEs },
      it: { nume: numeIt, descriere: descriereIt, content: contentIt },
      pl: { nume: numePl, descriere: descrierePl, content: contentPl },
      de: { nume: numeDe, descriere: descriereDe, content: contentDe },
      hu: { nume: numeHu, descriere: descriereHu, content: contentHu },
      cs: { nume: numeCs, descriere: descriereCs, content: contentCs },
      sk: { nume: numeSk, descriere: descriereSk, content: contentSk },
      hr: { nume: numeHr, descriere: descriereHr, content: contentHr },
      ru: { nume: numeRu, descriere: descriereRu, content: contentRu },
      bg: { nume: numeBg, descriere: descriereBg, content: contentBg },
      el: { nume: numeEl, descriere: descriereEl, content: contentEl },
      fr: { nume: numeFr, descriere: descriereFr, content: contentFr },
      rusa: { nume: numeRusa, descriere: descriereRusa, content: contentRusa },
      tr: { nume: numeTr, descriere: descriereTr, content: contentTr },
      ar: { nume: numeAr, descriere: descriereAr, content: contentAr },
      sq: { nume: numeSq, descriere: descriereSq, content: contentSq },
    };
  const estimatedArticle = { ...dialogData, info: articleInfo, categorie, youtubeLinks: youtubeLink.split(";").filter(Boolean), timpProgramat, dataProgramata };
  const estimatedBytes = articleDocumentBytes(estimatedArticle);
  const handleUploadData = () => {
    if (translationController.current || saveInFlight.current) return;
    try { assertArticleSize(estimatedArticle); }
    catch (error) { setSaveError(articleSaveError(error)); return; }
    saveInFlight.current = true;
    const authUser = authentication.currentUser;
    const startedAt = performance.now();

    logBlogArticoleUpload("form:save-clicked", {
      mode: isEdit ? "edit" : "create",
      uid: authUser?.uid || null,
      email: authUser?.email || null,
      imageCount: selectedImages.length,
      hasExistingImage: Boolean(image?.finalUri),
      categorie,
      dataProgramata,
      timpProgramat,
      youtubeLinkLength: youtubeLink?.length || 0,
      article: summarizeArticleInfo({
        ro: { nume: numeRo, descriere: descriereRo, content: contentRo },
      }),
    });

    setLoading(true);
    const data = articleInfo;

    logBlogArticoleUpload("form:payload-ready", {
      mode: isEdit ? "edit" : "create",
      article: summarizeArticleInfo(data),
      localeCount: Object.keys(data).length,
    });

    const oldFileName = dialogData.image ? dialogData.image.fileName : "";
    Promise.resolve().then(() => isEdit
      ? handleEdit(data, selectedImages, image, oldFileName, categorie, youtubeLink, timpProgramat, dataProgramata)
      : handleUpload(data, selectedImages, categorie, youtubeLink, timpProgramat, dataProgramata)
    ).catch(error => {
      logBlogArticoleUploadError("form:save-failed", error);
      setSaveError(articleSaveError(error));
    }).finally(() => {
      saveInFlight.current = false;
      setLoading(false);
    });
  };

  const theme = useTheme();

  // HANDLE TRANSLATE
  const handleTranslate = async (text, target) => {
    console.log("translate text...", text);
    try {
      const res = await gTranslateFetch(text, target);
      return res;
    } catch (err) {
      console.error("Error on translate.....:", err);
      // Handle error (e.g., show error message to user)
    }
  };

  //---------- NUME HANDLE TRANSLATE -----------

  const handleToTranslateNume = async (numeRoValue) => {
    const languages = [
      "en",
      "es",
      "it",
      "pl",
      "de",
      "hu",
      "cs",
      "sk",
      "hr",
      "ru",
      "bg",
      "el",
      "fr",
      "rusa",
      "tr",
      "ar",
      "sq",
    ];

    // Creăm un obiect de mapare pentru funcțiile set
    const setFunctions = {
      en: setNumeEn,
      es: setNumeEs,
      it: setNumeIt,
      pl: setNumePl,
      de: setNumeDe,
      hu: setNumeHu,
      cs: setNumeCs,
      sk: setNumeSk,
      hr: setNumeHr,
      ru: setNumeRu,
      bg: setNumeBg,
      el: setNumeEl,
      fr: setNumeFr,
      rusa: setNumeRusa,
      tr: setNumeTr,
      ar: setNumeAr,
      sq: setNumeSq,
    };

    // Funcție de delay
    const sleep = (ms) => {
      return new Promise((resolve) => setTimeout(resolve, ms));
    };

    for (let l of languages) {
      console.log("language to translate...", l);

      let translation;

      if (l === "hu") {
        translation = await handleTranslate(numeRoValue, "hi");
      } else if (l === "ru") {
        translation = await handleTranslate(numeRoValue, "id");
      } else if (l === "rusa") {
        translation = await handleTranslate(numeRoValue, "ru");
      } else {
        translation = await handleTranslate(numeRoValue, l);
      }

      // console.log("translation", translation);
      if (translation) {
        console.log("language round...", l);
        console.log("translation", translation);

        // Verificăm dacă există o funcție de setare corespunzătoare și actualizăm starea
        if (setFunctions[l]) {
          setFunctions[l](translation);
        }
      }

      // Așteaptă o secundă înainte de a trece la următoarea limbă
      await sleep(1000); // 1000 ms = 1 secunda
    }
  };

  //---------- DESCRIERE HANDLE TRANSLATE -----------

  const handleToTranslateDescriere = async (descriereRoValue) => {
    const languages = [
      "en",
      "es",
      "it",
      "pl",
      "de",
      "hu",
      "cs",
      "sk",
      "hr",
      "ru",
      "bg",
      "el",
      "fr",
      "rusa",
      "tr",
      "ar",
      "sq",
    ];

    // Creăm un obiect de mapare pentru funcțiile set
    const setFunctions = {
      en: setDescriereEn,
      es: setDescriereEs,
      it: setDescriereIt,
      pl: setDescrierePl,
      de: setDescriereDe,
      hu: setDescriereHu,
      cs: setDescriereCs,
      sk: setDescriereSk,
      hr: setDescriereHr,
      ru: setDescriereRu,
      bg: setDescriereBg,
      el: setDescriereEl,
      fr: setDescriereFr,
      rusa: setDescriereRusa,
      tr: setDescriereTr,
      ar: setDescriereAr,
      sq: setDescriereSq,
    };

    // Funcție de delay
    const sleep = (ms) => {
      return new Promise((resolve) => setTimeout(resolve, ms));
    };

    for (let l of languages) {
      console.log(l);

      let translation;

      if (l === "hu") {
        translation = await handleTranslate(descriereRoValue, "hi");
      } else if (l === "ru") {
        translation = await handleTranslate(descriereRoValue, "id");
      } else if (l === "rusa") {
        translation = await handleTranslate(descriereRoValue, "ru");
      } else {
        translation = await handleTranslate(descriereRoValue, l);
      }

      // console.log("translation", translation);
      if (translation) {
        console.log("language round...", l);
        console.log("translation", translation);

        // Verificăm dacă există o funcție de setare corespunzătoare și actualizăm starea
        if (setFunctions[l]) {
          setFunctions[l](translation);
        }
      }

      // Așteaptă o secundă înainte de a trece la următoarea limbă
      await sleep(1000); // 1000 ms = 1 secunda
    }
  };
  //---------- CONTENT HANDLE TRANSLATE -----------

  const handleToTranslateContent = async (contentRoValue) => {
    const languages = [
      "en",
      "es",
      "it",
      "pl",
      "de",
      "hu",
      "cs",
      "sk",
      "hr",
      "ru",
      "bg",
      "el",
      "fr",
      "rusa",
      "tr",
      "ar",
      "sq",
    ];

    // Creăm un obiect de mapare pentru funcțiile set
    const setFunctions = {
      en: setContentEn,
      es: setContentEs,
      it: setContentIt,
      pl: setContentPl,
      de: setContentDe,
      hu: setContentHu,
      cs: setContentCs,
      sk: setContentSk,
      hr: setContentHr,
      ru: setContentRu,
      bg: setContentBg,
      el: setContentEl,
      fr: setContentFr,
      rusa: setContentRusa,
      tr: setContentTr,
      ar: setContentAr,
      sq: setContentSq,
    };

    if (translationController.current) return;
    const controller = new AbortController();
    translationController.current = controller;
    setTranslating(true);
    setTranslationError("");
    try {
      if (translationSession.current?.source !== contentRoValue) {
        translationSession.current = createArticleTranslationSession(contentRoValue);
      }
      await runArticleTranslation(translationSession.current, {
        languages: languages.map(key => ({ key, target: key === "hu" ? "hi" : key === "ru" ? "id" : key === "rusa" ? "ru" : key })),
        signal: controller.signal,
        onProgress: ({ key, current, total }) => setTranslationStatus(`Traducere ${key}: ${current}/${total} fragmente`),
        onLocale: (key, html) => setFunctions[key](html),
      });
      setTranslationStatus("Traducerea conținutului este completă. Poți salva articolul.");
    } catch (error) {
      if (!controller.signal.aborted) setTranslationError(error.message || "Traducerea a eșuat. Reîncearcă.");
    } finally {
      if (!controller.signal.aborted) setTranslating(false);
      translationController.current = null;
    }
  };

  return (
    <>
      <Grid container spacing={2} sx={{ padding: 1 }}>
        <>
          <Grid
            item
            xs={12}
            sx={{
              width: "100%",

              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
            }}
          >
            {isEdit && (
              <Button
                variant="outlined"
                disabled={translating || loading}
                onClick={handleDelete}
                style={{
                  position: "relative",
                  top: 10,
                  right: 10,
                  marginRight: 10,
                }}
              >
                Șterge
              </Button>
            )}
            <Button
              variant="text"
              onClick={closeForm}
              style={{
                position: "relative",
                top: 10,
                right: 10,
              }}
            >
              Închide
            </Button>
          </Grid>
          <Grid item xs={12} sx={{ width: "100%", marginBottom: 1 }}>
            <HorizontalLineWithText text={"Setări Media"} />
          </Grid>

          <Box
            style={{
              width: "100%",
              paddingRight: "3%",
              paddingLeft: "3%",
              paddingBottom: "3%",
              paddingTop: "3%",
              backgroundColor: "#2B2B2B",
              marginRight: "2%",
              marginLeft: "2%",
              borderRadius: "1%",
            }}
          >
            <Grid
              item
              xs={12}
              sx={{
                width: selectedImages.length > 0 || image ? "100%" : "100%",
                height: "auto",
                position: "relative",
              }}
            >
              {selectedImages.length > 0 ? (
                <div
                  style={{
                    width: "100%",
                  }}
                >
                  {selectedImages.map((item, index) => (
                    <div
                      key={index}
                      style={{
                        position: "relative",

                        width: "100%",
                        justifyContent: "center",
                        alignItems: "center",
                        display: "flex",
                      }}
                    >
                      <img
                        src={URL.createObjectURL(item)}
                        alt={`Image ${index + 1}`}
                        loading="lazy"
                        style={{
                          maxWidth: "100%",

                          objectFit: "contain",
                          // height:"400px"
                          maxHeight: "400px",
                        }}
                      />
                      <Fab
                        size="small"
                        color="secondary"
                        aria-label="delete"
                        onClick={() => handleImageDelete(index)}
                        sx={{ position: "relative", bottom: 190, right: 25 }}
                      >
                        <DeleteIcon />
                      </Fab>
                    </div>
                  ))}
                </div>
              ) : image ? (
                <div>
                  <div
                    style={{
                      position: "relative",

                      width: "100%",
                      justifyContent: "center",
                      alignItems: "center",
                      display: "flex",
                    }}
                  >
                    <img
                      src={image.finalUri}
                      alt={`Image`}
                      loading="lazy"
                      style={{
                        maxWidth: "100%",

                        objectFit: "contain",
                        // height:"400px"
                        maxHeight: "400px",
                      }}
                    />
                    <Fab
                      size="small"
                      color="secondary"
                      aria-label="delete"
                      onClick={() => handleImageDelete()}
                      sx={{ position: "relative", bottom: 190, right: 25 }}
                    >
                      <DeleteIcon />
                    </Fab>
                  </div>
                </div>
              ) : (
                <label
                  htmlFor="image-upload"
                  style={{
                    padding: "20px",
                    textAlign: "center",
                    cursor: "pointer",
                    display: "block",
                    marginBottom: 2,
                    marginTop: 15,
                  }}
                >
                  <input
                    key={fileInputKey}
                    id="image-upload"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageChange}
                    style={{ display: "none" }}
                  />
                  <AddPhotoAlternateIcon sx={{ fontSize: 48, color: "#ccc" }} />
                  <p style={{ color: "white" }}>Select Images</p>
                </label>
              )}
              <React.Fragment>
                <h1 style={{ color: "#D3D3D3", fontSize: 30, marginTop: 20 }}>
                  Link Youtube
                </h1>
                <p
                  style={{
                    color: "#D3D3D3",
                    fontSize: "15px",
                    marginTop: "20px",
                    fontWeight: "bold",
                  }}
                >
                  Pentru adăugarea mai multor video-uri de YouTube, trebuie să
                  le separați prin adăugarea "
                  <span style={{ color: "blue", fontWeight: "bold" }}>;</span>"
                  între link-urile de YouTube introduse.
                </p>
                <p
                  style={{
                    color: "#D3D3D3",
                    fontSize: "15px",
                    marginTop: "20px",
                    fontWeight: "bold",
                  }}
                >
                  Spre exemplu "
                  <span style={{ color: "white" }}>
                    https://www.youtube.com/watch?v=caWBmvhRcII&t=15s
                  </span>
                  <span style={{ color: "blue" }}>;</span>
                  <span style={{ color: "white" }}>
                    https://www.youtube.com/watch?v=caWBmvhRcII&t=15s
                  </span>
                  "
                </p>

                <FieldRow
                  id={"youtubeLink"}
                  name={"youtubeLink"}
                  label={"Link Youtube"}
                  value={youtubeLink}
                  onChange={(event) => setYoutubeLink(event.target.value)}
                  widthLabel="10%"
                />
              </React.Fragment>
            </Grid>
          </Box>
          <Grid
            item
            xs={12}
            sx={{ width: "100%", marginTop: 2, marginBottom: 1 }}
          >
            <HorizontalLineWithText text={"Setări Categorie"} />
          </Grid>
          <Box
            style={{
              width: "100%",
              paddingRight: "3%",
              paddingLeft: "3%",
              paddingBottom: "3%",
              backgroundColor: "#2B2B2B",
              marginRight: "2%",
              marginLeft: "2%",
              borderRadius: "1%",
            }}
          >
            <DropdownFieldCategorii
              id="Categorii-select"
              name="Categorii"
              label="Categorii"
              value={categorie}
              onChange={(item) => setCategorie(item)}
              widthLabel="11.5%"
              options={[
                "Previziuni zilnice",
                "Previziuni săptămânale",
                "Previziuni lunare",
                "Previziuni anuale",
              ]}
              placeHolder="Categorii"
            />
          </Box>
          <Grid
            item
            xs={12}
            sx={{ width: "100%", marginTop: 2, marginBottom: 1 }}
          >
            <HorizontalLineWithText text={"Programare continut"} />
          </Grid>
          <Box
            style={{
              width: "100%",
              paddingRight: "3%",
              paddingLeft: "3%",
              paddingBottom: "3%",
              backgroundColor: "#2B2B2B",
              marginRight: "2%",
              marginLeft: "2%",
              borderRadius: "1%",
              paddingTop: "3%",
            }}
          >
            <DateTimePicker
              dataProgramata={dataProgramata}
              setDataProgramata={setDataProgramata}
              timpProgramat={timpProgramat}
              setTimpProgramat={setTimpProgramat}
            />
          </Box>
          <Grid
            item
            xs={12}
            sx={{ width: "100%", marginTop: 2, marginBottom: 1 }}
          >
            <HorizontalLineWithText text={"Setări Principale"} />
          </Grid>

          <Box
            style={{
              width: "100%",
              paddingRight: "3%",
              paddingLeft: "3%",
              paddingBottom: "3%",
              backgroundColor: "#2B2B2B",
              marginRight: "2%",
              marginLeft: "2%",
              borderRadius: "1%",
            }}
          >
            {languageFields.map((field, index) => (
              <React.Fragment key={field.id}>
                {index % 3 === 0 && (
                  <h1 style={{ color: "#D3D3D3", fontSize: 30, marginTop: 20 }}>
                    {field.denumire}
                  </h1>
                )}
                {!field.id.includes("content") ? (
                  <FieldRow
                    id={field.id}
                    name={field.id}
                    label={field.label}
                    value={field.value}
                    onChange={(event) => field.setValue(event.target.value)}
                    widthLabel="10%"
                  />
                ) : (
                  <ArticleEditor
                    content={field.value}
                    readOnly={translating}
                    setContent={(value) => {
                      if (translationController.current) return;
                      if (field.id === "content-ro") { translationSession.current = null; setTranslationError(""); setTranslationStatus(""); }
                      field.setValue(value);
                    }}
                  />
                )}
                {field.id === "nume-ro" && (
                  <IconButton
                    color="primary"
                    aria-label="add an alarm"
                    sx={{ position: "relative", left: 5, top: 15 }}
                    disabled={translating || loading}
                    onClick={() => handleToTranslateNume(numeRo)}
                  >
                    <GTranslateIcon />
                  </IconButton>
                )}
                {field.id === "descriere-ro" && (
                  <IconButton
                    color="primary"
                    aria-label="add an alarm"
                    sx={{ position: "relative", left: 5, top: 15 }}
                    disabled={translating || loading}
                    onClick={() => handleToTranslateDescriere(descriereRo)}
                  >
                    <GTranslateIcon />
                  </IconButton>
                )}
                {field.id === "content-ro" && (
                  <IconButton
                    color="primary"
                    aria-label="add an alarm"
                    sx={{ position: "relative", left: 5, top: 15 }}
                    disabled={translating || loading}
                    onClick={() => handleToTranslateContent(contentRo)}
                  >
                    <GTranslateIcon />
                  </IconButton>
                )}
                {/* Ajustează condiția pentru afișarea liniei orizontale */}
                {index !== 0 && (index + 1) % 3 === 0 && (
                  <HorizontalLineWithText style={{ marginTop: "3%" }} />
                )}
              </React.Fragment>
            ))}
          </Box>
          <Box
            sx={{
              width: "100%",

              marginTop: 2,
              justifyContent: "flex-end",
              display: "flex",
              paddingRight: "2%",
            }}
          >
            {isEdit ? (
              <Button
                variant="contained"
                disabled={translating || loading}
                onClick={handleUploadData}
                style={{ marginRight: 10 }}
              >
                {" "}
                Actualizează
              </Button>
            ) : (
              <Button
                variant="contained"
                disabled={translating || loading}
                onClick={handleUploadData}
                style={{ marginRight: 10 }}
              >
                {" "}
                Salvează
              </Button>
            )}
            <Button variant="outlined" onClick={closeForm}>
              Cancel
            </Button>
          </Box>
          {translationStatus && <Typography role="status">{translationStatus}</Typography>}
          {translationError && <Box role="alert"><Typography color="error">{translationError}</Typography><Button disabled={translating || loading} onClick={() => handleToTranslateContent(contentRo)}>Reîncearcă traducerea conținutului</Button></Box>}
          <Typography role="status" color={estimatedBytes > 900 * 1024 ? "error" : "text.secondary"}>
            Dimensiune estimată articol: {(estimatedBytes / 1024).toFixed(1)} KiB / 900 KiB (toate limbile)
          </Typography>
          <Dialog open={Boolean(saveError)} onClose={() => setSaveError(null)} aria-labelledby="article-save-error-title">
            <DialogTitle id="article-save-error-title">{saveError?.title}</DialogTitle>
            <DialogContent><DialogContentText>{saveError?.message}</DialogContentText></DialogContent>
            <DialogActions><Button onClick={() => setSaveError(null)}>Am înțeles</Button></DialogActions>
          </Dialog>
          <LoadingDialog loading={loading} setLoading={() => {}} />
        </>
      </Grid>
    </>
  );
}
