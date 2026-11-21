import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import "./NotificationCenter.css";

export type NotificationKind = "error" | "success" | "info";

export interface Notification {
  id: string;
  kind: NotificationKind;
  message: string;
}

interface NotificationContextValue {
  notify: (kind: NotificationKind, message: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

const AUTO_DISMISS_MS = 6000;

/**
 * MISC-045: app-wide notification/alert surface. Mount <NotificationProvider>
 * once near the root so any component (including hooks like useContractCall)
 * can surface a payment failure to the user, even outside the widget that
 * triggered it.
 */
export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setNotifications((current) => current.filter((n) => n.id !== id));
  }, []);

  const notify = useCallback(
    (kind: NotificationKind, message: string) => {
      counterRef.current += 1;
      const id = `notif-${counterRef.current}-${Date.now()}`;
      setNotifications((current) => [...current, { id, kind, message }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss]
  );

  return (
    <NotificationContext.Provider value={{ notify }}>
      {children}
      <div className="notification-center" role="status" aria-live="polite">
        {notifications.map((n) => (
          <div key={n.id} className={`notification notification-${n.kind}`}>
            <span>{n.message}</span>
            <button
              type="button"
              aria-label="Dismiss notification"
              className="notification-dismiss"
              onClick={() => dismiss(n.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

/**
 * Returns a `notify` function for firing a global toast-style alert.
 * Falls back to a console warning if used outside a NotificationProvider
 * (e.g. in tests) instead of throwing.
 */
export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    return {
      notify: (kind, message) => {
        // eslint-disable-next-line no-console
        console.warn(`[notification:${kind}] ${message}`);
      },
    };
  }
  return ctx;
}
