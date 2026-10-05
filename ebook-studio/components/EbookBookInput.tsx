import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Box, Button, Card, Dialog, Flex, Spinner, Stack, Text } from "@sanity/ui";
import { ObjectInputProps, useClient, useCurrentUser, useWorkspace, validateDocument } from "sanity";
import { languages } from "../schemaTypes/languages";
import { archiveInspection, editableContent, inspectPublication, PUBLICATION_API_VERSION, publishInspection } from "../actions/publication";
import { createDeleteBookConfirmation, deleteEbookDocuments } from "../actions/documentActions";

const fields: Record<string, string> = { cover: "Copertă", price: "Preț", currency: "Monedă", adminTitle: "Titlu administrare", title: "Titlu", chapters: "Capitole", body: "Text", book: "Carte" };
function validationText(markers: any[]) {
  return markers.map(m => `${fields[String(m.path?.[0])] || "Conținut"}: ${m.message === "Required" ? "câmp obligatoriu" : m.message}`).join("; ");
}

export function EbookBookInput(props: ObjectInputProps) {
  return <BookPublicationInput key={String(props.value?._id || "new").replace(/^drafts\./, "")} {...props} />;
}

function BookPublicationInput(props: ObjectInputProps) {
  const workspace = useWorkspace();
  const currentUser = useCurrentUser();
  const baseClient = useClient({ apiVersion: PUBLICATION_API_VERSION });
  const client = useMemo(() => baseClient.withConfig({ perspective: "raw", useCdn: false, timeout: 20000 }), [baseClient]);
  const id = String(props.value?._id || "").replace(/^drafts\./, "");
  const [inspection, setInspection] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [dialog, setDialog] = useState<"archive" | "delete" | null>(null);
  const [deleted, setDeleted] = useState(false);
  const generation = useRef(0);
  const running = useRef(false);
  const valueRef = useRef(props.value);
  valueRef.current = props.value;
  const validate = useCallback(async (document: any, bookId: string) => validateDocument({
    document, workspace, currentUser, environment: "studio",
    // The parent is validated and published first in the same workflow.
    getDocumentExists: async ({ id: referenceId }) => referenceId === bookId ||
      Boolean(await client.withConfig({ perspective: "published" }).fetch('count(*[_id==$id]) > 0', { id: referenceId })),
  }), [workspace, currentUser, client]);
  const inspect = useCallback((includeLocal = false) => inspectPublication(client, id, languages.map(l => l.id), validate,
    includeLocal ? valueRef.current : undefined), [client, id, validate]);
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    setLoading(true);
    try { const next = await inspect(true); if (version === generation.current) { setInspection(next); setLoadError(""); } }
    catch (e) { if (version === generation.current) setLoadError(e instanceof Error ? e.message : "Nu putem încărca starea publicării."); }
    finally { if (version === generation.current) setLoading(false); }
  }, [inspect]);
  const formContent = editableContent(props.value);
  useEffect(() => {
    const timer = id ? setTimeout(() => void refresh(), 400) : undefined;
    if (!id) setLoading(false);
    return () => { clearTimeout(timer); generation.current++; };
  }, [id, props.value?._rev, formContent, refresh]);

  async function run(operation: "publish" | "archive" | "delete") {
    if (running.current || props.readOnly) return;
    running.current = true; setBusy(true); setError(""); setMessage(""); setDialog(null);
    try {
      if (operation === "delete") {
        await deleteEbookDocuments(client, id); setDeleted(true); setMessage("Cartea și toate edițiile ei au fost șterse.");
      } else {
        setMessage("Se verifică informațiile și traducerile…");
        const next = await inspect(); setInspection(next);
        if (editableContent(valueRef.current) !== editableContent(next.book)) throw new Error("Modificările încă se salvează. Așteaptă câteva secunde și reîncearcă.");
        if (operation === "archive") {
          await archiveInspection(client, next); setMessage("Cartea a fost arhivată. Cumpărătorii își păstrează accesul.");
        } else {
          const completed = await publishInspection(client, next, setMessage);
          const skipped = next.editions.filter((e: any) => e.draft && !e.valid).map((e: any) => e.language.toUpperCase());
          setMessage(`Cartea a fost publicată. ${completed.length} ediții publicate/actualizate.${skipped.length ? ` Au rămas drafturi incomplete: ${skipped.join(", ")}.` : ""}`);
        }
        // Keep an operation error if refreshing the view also fails.
        try { setInspection(await inspect()); } catch { setError("Operația a reușit, dar starea nu a putut fi reîncărcată. Apasă „Reverifică”."); }
      }
    } catch (e) { setMessage(""); setError(e instanceof Error ? e.message : "Operația nu a reușit. Reîncearcă."); }
    finally { running.current = false; setBusy(false); }
  }
  const published = inspection?.published;
  const ro = inspection?.editions.find((e: any) => e.language === "ro");
  const inCatalog = published?.status === "published" && Boolean(ro?.published);
  const problems = inspection ? [
    ...(inspection.bookErrors.length ? [validationText(inspection.bookErrors)] : []),
    ...(!ro?.document ? ["RO: adaugă titlul și cel puțin un capitol cu text."] : ro.errors.length ? [`RO: ${validationText(ro.errors)}`] : []),
  ] : [];
  const disabled = busy || loading || !inspection || deleted || Boolean(props.readOnly);
  const deleteConfirmation = createDeleteBookConfirmation(() => void run("delete"), () => setDialog(null));
  return <Stack space={5}>
    <Card padding={[3, 4]} radius={3} border tone="primary">
      <Stack space={4}>
        <Flex gap={3} align="center" wrap="wrap">
          <Text size={2} weight="semibold">Publicarea cărții</Text>
          <Badge tone={inCatalog ? "positive" : published?.status === "archived" ? "caution" : "default"}>
            {deleted ? "Ștearsă" : inCatalog ? "Publicată în catalog" : published?.status === "archived" ? "Arhivată" : "Nepublicată în catalog"}
          </Badge>
        </Flex>
        <Text size={1}>Un singur buton publică coperta, prețul și toate traducerile complete. Româna este obligatorie.</Text>
        <Flex gap={3} wrap="wrap">
          <Button text={published?.status === "published" ? "Actualizează cartea" : "Publică cartea"} tone="positive"
            disabled={disabled || !inspection?.canPublish} loading={busy} onClick={() => void run("publish")} />
          <Button text="Previzualizează" mode="ghost" disabled={busy || !inspection?.persisted || deleted}
            onClick={() => window.open(`/ebooks/${encodeURIComponent(id)}/read?preview=1&locale=ro`, "_blank", "noopener")} />
          <Button text="Arhivează cartea" mode="ghost" disabled={disabled || !published || published.status === "archived" || !!inspection?.bookErrors.length}
            onClick={() => setDialog("archive")} />
          <Button text="Șterge cartea" tone="critical" mode="ghost" disabled={disabled || !inspection?.persisted} onClick={() => setDialog("delete")} />
          <Button text="Reverifică" mode="bleed" disabled={busy || loading || deleted || !id} onClick={() => { setError(""); void refresh(); }} />
        </Flex>
        {loading && <Flex gap={2} align="center"><Spinner /><Text size={1}>Se verifică edițiile…</Text></Flex>}
        {inspection && !deleted && <>
          {!inspection.persisted && <Card padding={3} radius={2} tone="primary"><Text size={1}>
            Carte nouă: completează titlul, coperta și prețul de mai jos, apoi adaugă capitolele în RO. Modificările se salvează automat.
          </Text></Card>}
          <Text size={1} weight="semibold">La apăsare: cartea și {inspection.candidates.length} ediții noi sau modificate.</Text>
          <details><summary style={{ cursor: "pointer", fontSize: 14 }}>Vezi starea limbilor ({inspection.editions.filter((e: any) => e.valid).length} complete / {inspection.editions.length})</summary>
          <Box marginTop={3}><Flex gap={2} wrap="wrap">{inspection.editions.map((e: any) => <Badge key={e.language}
            tone={e.valid ? "positive" : e.document ? "caution" : "default"}>
            {e.language.toUpperCase()}: {e.valid ? e.draft ? "gata de publicare" : "publicată" : e.document ? e.published ? "draft incomplet · ediție publicată păstrată" : "incompletă" : "necompletată"}
          </Badge>)}</Flex></Box></details>
          {!!problems.length && <Card padding={3} radius={2} tone="caution"><Stack space={3}>
            <Text size={1} weight="semibold">Completează înainte de publicare:</Text>
            {problems.map(p => <Text key={p} size={1}>{p}</Text>)}
          </Stack></Card>}
          {inspection.editions.filter((e: any) => e.draft && e.errors.length && e.language !== "ro").map((e: any) =>
            <Text size={1} key={e.language}>{e.language.toUpperCase()} rămâne draft: {validationText(e.errors)}</Text>)}
        </>}
        {!!message && <Card padding={3} radius={2} tone={busy ? "primary" : "positive"}><Text size={1} role="status">{message}</Text></Card>}
        {!!(error || loadError) && <Card padding={3} radius={2} tone="critical"><Text size={1} role="alert">{error || loadError}</Text></Card>}
      </Stack>
    </Card>
    {!deleted && props.renderDefault({ ...props, readOnly: Boolean(props.readOnly) || busy })}
    {dialog && <Dialog id={`ebook-${dialog}`} header={dialog === "delete" ? "Șterge cartea definitiv" : "Arhivează cartea"}
      onClose={() => setDialog(null)} width={1}>
      <Box padding={4}><Stack space={4}>
        <Text size={1}>{dialog === "delete" ? deleteConfirmation.message : "Cartea va fi ascunsă din catalog. Cumpărătorii vor putea citi în continuare edițiile publicate. Modificările salvate ale copertei și prețului se publică odată cu arhivarea."}</Text>
        <Flex gap={3} wrap="wrap">
          <Button text="Anulează" mode="ghost" onClick={() => setDialog(null)} />
          <Button text={dialog === "delete" ? deleteConfirmation.confirmButtonText : "Arhivează cartea"}
            tone={dialog === "delete" ? "critical" : "caution"} onClick={() => void run(dialog)} />
        </Flex>
      </Stack></Box>
    </Dialog>}
  </Stack>;
}
