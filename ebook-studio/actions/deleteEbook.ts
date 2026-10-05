import { useState } from "react";
import { useClient } from "sanity";
import { TrashIcon } from "@sanity/icons";
import {
  createDeleteBookConfirmation,
  deleteEbookDocuments,
} from "./documentActions";

const API_VERSION = "2025-02-19";

export function DeleteEbookAction(props: any) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const client = useClient({ apiVersion: API_VERSION }).withConfig({
    perspective: "raw",
  });
  const current = props.draft || props.published;

  if (!current || current._type !== "ebook") return null;

  return {
    label: "Șterge cartea",
    title: "Șterge definitiv cartea și traducerile ei",
    icon: TrashIcon,
    tone: "critical",
    group: ["default"],
    disabled: deleting,
    onHandle: () => setDialogOpen(true),
    dialog: dialogOpen
      ? createDeleteBookConfirmation(
          async () => {
            if (deleting) return;
            setDeleting(true);
            try {
              await deleteEbookDocuments(client, props.id);
              props.onComplete();
              window.alert("Cartea și toate edițiile ei au fost șterse.");
            } catch (error) {
              setDeleting(false);
              window.alert(
                error instanceof Error
                  ? `Cartea nu a putut fi ștearsă: ${error.message}`
                  : "Cartea nu a putut fi ștearsă. Încearcă din nou.",
              );
            }
          },
          () => setDialogOpen(false),
        )
      : null,
  };
}
