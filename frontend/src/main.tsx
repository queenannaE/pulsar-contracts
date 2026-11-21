import React from "react";
import { createRoot } from "react-dom/client";
import { PayerDashboard } from "./components/PayerDashboard";
import { NotificationProvider } from "./components/NotificationCenter";

createRoot(document.getElementById("root")!).render(
  <NotificationProvider>
    <PayerDashboard />
  </NotificationProvider>
);
