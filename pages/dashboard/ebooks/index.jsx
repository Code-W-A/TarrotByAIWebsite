import React, { useRef, useState } from "react";
import Head from "next/head";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import LibraryBooksOutlinedIcon from "@mui/icons-material/LibraryBooksOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SyncIcon from "@mui/icons-material/Sync";
import CustomDrawer from "../../../components/Dashboard/CustomDrawer";
import LocalPasswordGate from "../../../components/Dashboard/LocalPasswordGate";

export default function EbookDashboard() {
  const [syncing, setSyncing] = useState(false);
  const syncInFlight = useRef(false);
  const [notice, setNotice] = useState(null);
  const [editorLoading, setEditorLoading] = useState(true);

  async function sync() {
    if (syncInFlight.current) return;
    syncInFlight.current = true;
    setSyncing(true);
    setNotice(null);
    try {
      const response = await fetch("/api/ebooks/admin-sync", {
        method: "POST", credentials: "same-origin",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Catalogul nu a putut fi sincronizat.");
      setNotice({ severity: "success", text: `Catalog sincronizat: ${payload.synced} cărți actualizate.` });
    } catch (error) {
      setNotice({ severity: "error", text: error.message || "Catalogul nu a putut fi sincronizat." });
    } finally {
      syncInFlight.current = false;
      setSyncing(false);
    }
  }

  return (
    <>
      <Head>
        <title>Ebookuri — Dashboard</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <LocalPasswordGate redirectTo="/dashboard/login">
        <CustomDrawer selectedItem="Ebookuri" responsive mainSx={{ backgroundColor: "#f5f7fb", minWidth: 0 }}>
          <Box sx={{ p: { xs: 2, md: 4 }, width: "100%", maxWidth: 1800, mx: "auto" }}>
            <Stack direction={{ xs: "column", lg: "row" }} justifyContent="space-between" spacing={3} sx={{ mb: 3 }}>
              <Stack direction="row" spacing={2} alignItems="flex-start">
                <Box sx={{ bgcolor: "#ede9fe", color: "#6d28d9", p: 1.5, borderRadius: 3, display: "flex" }}>
                  <LibraryBooksOutlinedIcon />
                </Box>
                <Box>
                  <Typography component="h1" variant="h4" sx={{ fontWeight: 700, color: "#172033", fontSize: { xs: 26, md: 32 } }}>Ebookuri</Typography>
                  <Typography sx={{ color: "#64748b", mt: 1, maxWidth: 620 }}>
                    Redactați cărțile, adăugați traducerile și publicați fiecare ediție când este gata.
                  </Typography>
                </Box>
              </Stack>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }}>
                <Button variant="outlined" startIcon={syncing ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />} disabled={syncing} onClick={sync}
                  sx={{ textTransform: "none", borderColor: "#cbd5e1", color: "#475569", bgcolor: "white", whiteSpace: "nowrap" }}>
                  {syncing ? "Se sincronizează…" : "Sincronizează catalogul"}
                </Button>
                <Button component="a" href="/ebook-studio/intent/create/type=ebook" target="_blank" rel="noopener noreferrer" variant="contained" endIcon={<OpenInNewIcon />}
                  sx={{ textTransform: "none", bgcolor: "#6d28d9", boxShadow: "none", "&:hover": { bgcolor: "#5b21b6" }, whiteSpace: "nowrap" }}>
                  Adaugă ebook · editor separat
                </Button>
              </Stack>
            </Stack>
            {notice && <Alert severity={notice.severity} role={notice.severity === "error" ? "alert" : "status"} sx={{ mb: 3 }} onClose={() => setNotice(null)}>{notice.text}</Alert>}
            <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden", borderColor: "#e2e8f0", boxShadow: "0 4px 24px rgba(15,23,42,0.04)" }}>
              <Box sx={{ px: { xs: 2, md: 3 }, py: 2, borderBottom: "1px solid #e2e8f0" }}>
                <Typography component="h2" sx={{ fontWeight: 600, color: "#172033" }}>Editorul cărților</Typography>
                <Typography variant="body2" sx={{ color: "#64748b", mt: 0.5 }}>
                  Alegeți cartea și limba. Editorul folosește autentificarea contului Sanity.
                </Typography>
              </Box>
              <Box sx={{ position: "relative", height: { xs: "75vh", md: "calc(100vh - 300px)" }, minHeight: { xs: 520, md: 600 } }}>
                {editorLoading && <Stack role="status" alignItems="center" justifyContent="center" spacing={2} sx={{ position: "absolute", inset: 0, bgcolor: "white", pointerEvents: "none" }}>
                  <CircularProgress size={28} sx={{ color: "#6d28d9" }} />
                  <Typography variant="body2" sx={{ color: "#64748b" }}>Se încarcă editorul…</Typography>
                </Stack>}
                <iframe title="Editor ebookuri Sanity" src="/ebook-studio/" onLoad={() => setEditorLoading(false)}
                  style={{ display: "block", width: "100%", height: "100%", border: 0 }} />
              </Box>
            </Paper>
          </Box>
        </CustomDrawer>
      </LocalPasswordGate>
    </>
  );
}
