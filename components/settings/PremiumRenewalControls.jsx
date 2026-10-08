import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "next-i18next";
import Link from "next/link";
import { useRouter } from "next/router";
import { useAuth } from "../../context/AuthContext";
import { getFirebaseBearerHeader } from "../../utils/firebaseAuthHeaders";

const buttonClass =
  "rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 disabled:cursor-wait disabled:opacity-60";
const requestKey = (uid) => `premium-renewal-v1:${uid}`;
function savedRequest(uid) {
  try {
    return JSON.parse(sessionStorage.getItem(requestKey(uid)) || "null");
  } catch (_) {
    return null;
  }
}
function saveRequest(uid, value) {
  try {
    if (value) sessionStorage.setItem(requestKey(uid), JSON.stringify(value));
    else sessionStorage.removeItem(requestKey(uid));
  } catch (_) {}
}

export default function PremiumRenewalControls(props) {
  const { currentUser, isGuestUser } = useAuth();
  return currentUser?.uid && !isGuestUser ? (
    <RenewalControls key={currentUser.uid} uid={currentUser.uid} {...props} />
  ) : null;
}

function RenewalControls({ uid, onChanged, disabled = false }) {
  const { t } = useTranslation("common");
  const { locale = "ro", query } = useRouter();
  const cancelIntent = query?.renewal === "cancel";
  const intentHandled = useRef(false);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [selected, setSelected] = useState("");
  const [outcome, setOutcome] = useState(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const pending = useRef(null);
  const confirmRef = useRef(null);
  const tx = (key) => t(`premiumRenewal.${key}`);

  const api = useCallback(
    async (body) => {
      const bearer = await getFirebaseBearerHeader({ required: true });
      if (!alive.current) throw new Error("account_changed");
      const response = await fetch("/api/stripe/premium/renewal", {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          ...bearer,
          "x-premium-account-uid": uid,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "renewal_unavailable");
      return payload;
    },
    [uid],
  );

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await api();
      if (alive.current) setData(value);
    } catch (_) {
      if (alive.current) setError("loadError");
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }, [api]);

  useEffect(() => {
    alive.current = true;
    pending.current = savedRequest(uid);
    if (pending.current) {
      setConfirmation(pending.current.action);
      setSelected(pending.current.subscriptionId || "");
    }
    refresh();
    return () => {
      alive.current = false;
    };
  }, [uid, refresh]);
  useEffect(() => {
    if (data && !intentHandled.current) {
      intentHandled.current = true;
      if (cancelIntent && !data.allStopped) setConfirmation("cancel");
    }
  }, [data, cancelIntent]);
  useEffect(() => {
    if (confirmation) confirmRef.current?.focus();
  }, [confirmation]);

  const date = (value) =>
    value
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: "long",
          timeZone: "Europe/Bucharest",
        }).format(new Date(value))
      : tx("dateUnknown");
  const start = (action) => {
    setOutcome(null);
    setError("");
    setSelected("");
    setConfirmation(action);
  };
  const submit = async (action) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const target = action === "reactivate" ? selected : null;
    try {
      let operation;
      if (action === "resend") {
        operation = {
          requestId: outcome?.requestId || data?.lastRequest?.requestId,
          action,
        };
      } else {
        operation = pending.current;
        if (
          !operation ||
          operation.action !== action ||
          operation.subscriptionId !== target
        ) {
          operation = {
            requestId: crypto.randomUUID(),
            action,
            subscriptionId: target,
          };
          pending.current = operation;
          saveRequest(uid, operation);
        }
      }
      const result = await api({ ...operation, confirmed: true, locale });
      if (!alive.current) return;
      setOutcome({ ...result, action });
      if (result.summary)
        setData({
          ...result.summary,
          lastRequest: {
            requestId: result.requestId,
            action,
            state: result.ok ? "complete" : "partial",
            emailStatus: result.emailStatus,
          },
        });
      if (result.ok) {
        if (
          result.syncStatus !== "pending" &&
          result.historyStatus !== "pending"
        )
          setConfirmation(null);
        if (
          action !== "resend" &&
          result.syncStatus !== "pending" &&
          result.historyStatus !== "pending"
        ) {
          pending.current = null;
          saveRequest(uid, null);
          onChanged?.();
        }
      } else setError("partial");
    } catch (failure) {
      if (!alive.current) return;
      if (
        ["request_superseded", "request_mismatch"].includes(failure.message)
      ) {
        pending.current = null;
        saveRequest(uid, null);
      }
      setError(
        failure.message === "renewal_busy"
          ? "busyError"
          : failure.message === "subscription_ownership_ambiguous"
            ? "ownershipError"
            : "actionError",
      );
      // Refresh the actual Stripe state after a lost response; do not guess whether it succeeded.
      try {
        const current = await api();
        if (alive.current) setData(current);
      } catch (_) {}
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const rows = data?.subscriptions || [];
  const stopped = rows.filter((sub) => sub.canReactivate);
  const emailStatus = outcome?.emailStatus || data?.lastRequest?.emailStatus;
  const canResend =
    (outcome?.ok || data?.lastRequest?.state === "complete") &&
    emailStatus &&
    emailStatus !== "sent";
  return (
    <section
      id="premium-renewal"
      className="my-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5"
      aria-busy={busy}
      aria-label={tx("title")}
    >
      <h2 className="text-lg font-semibold text-slate-900">{tx("title")}</h2>
      {busy && <p role="status">{tx("loading")}</p>}
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {tx(error)}
        </p>
      )}
      {data && (
        <>
          <p className="text-sm text-slate-800">
            {!rows.length
              ? tx("none")
              : data.allStopped
                ? tx("stopped")
                : tx("renewing")}
          </p>
          {data.accessUntil && (
            <p className="text-sm text-slate-700">
              {t("premiumRenewal.accessUntil", {
                date: date(data.accessUntil),
              })}
            </p>
          )}
          {rows.length > 0 && (
            <ul className="space-y-2 text-sm text-slate-700">
              {rows.map((sub, index) => (
                <li key={sub.id}>
                  {t("premiumRenewal.subscription", { number: index + 1 })}:{" "}
                  {sub.stopped ? tx("stopped") : tx("renewing")} ·{" "}
                  {date(sub.periodEnd)}
                </li>
              ))}
            </ul>
          )}
          {outcome?.ok && outcome.action !== "resend" && (
            <p role="status" className="font-semibold text-green-800">
              {outcome.action === "reactivate"
                ? tx("reactivated")
                : tx("stopped")}
            </p>
          )}
          {outcome?.syncStatus === "pending" && (
            <p role="status" className="text-sm">
              {tx("syncPending")}
            </p>
          )}
          {emailStatus === "sent" && (
            <p className="text-sm">{tx("emailSent")}</p>
          )}
          {canResend && (
            <div className="space-y-2">
              <p className="text-sm">{tx("emailPending")}</p>
              <button
                type="button"
                disabled={busy || disabled}
                onClick={() => submit("resend")}
                className={buttonClass}
              >
                {tx("resend")}
              </button>
            </div>
          )}
          {!rows.length && (
            <Link href="/abonament" className={buttonClass}>
              {t("settingsPremiumRenewCta")}
            </Link>
          )}
          {!confirmation && (
            <div className="flex flex-wrap gap-3">
              {rows.some((sub) => !sub.stopped) && (
                <button
                  type="button"
                  onClick={() => start("cancel")}
                  disabled={busy || disabled}
                  className={buttonClass}
                >
                  {tx("cancel")}
                </button>
              )}
              {data.allStopped && stopped.length > 0 && (
                <button
                  type="button"
                  onClick={() => start("reactivate")}
                  disabled={busy || disabled}
                  className={buttonClass}
                >
                  {tx("reactivate")}
                </button>
              )}
            </div>
          )}
        </>
      )}
      {confirmation && (
        <div
          className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4"
          role="group"
          aria-label={tx("confirmTitle")}
        >
          <h3 ref={confirmRef} tabIndex={-1} className="font-semibold">
            {tx("confirmTitle")}
          </h3>
          <p>
            {tx(
              confirmation === "cancel" ? "confirmCancel" : "confirmReactivate",
            )}
          </p>
          {confirmation === "reactivate" && (
            <label className="block">
              {tx("choose")}
              <select
                className="mt-2 block w-full rounded border p-2"
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
                disabled={busy}
              >
                <option value="">{tx("choose")}</option>
                {stopped.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {t("premiumRenewal.subscription", {
                      number: rows.findIndex((row) => row.id === sub.id) + 1,
                    })}{" "}
                    · {date(sub.periodEnd)} ·{" "}
                    {sub.amount == null
                      ? ""
                      : `${(sub.amount / 100).toFixed(2)} ${sub.currency?.toUpperCase()}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={
                busy || disabled || (confirmation === "reactivate" && !selected)
              }
              onClick={() => submit(confirmation)}
              className={buttonClass}
            >
              {tx("confirm")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmation(null)}
              className={buttonClass}
            >
              {tx("back")}
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={refresh}
        disabled={busy || disabled}
        className={buttonClass}
      >
        {tx("refresh")}
      </button>
    </section>
  );
}
