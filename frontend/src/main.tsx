import React from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import i18n from "./lib/i18n";
import { PayerDashboard } from "./components/PayerDashboard";

createRoot(document.getElementById("root")!).render(
  <I18nextProvider i18n={i18n}>
    <PayerDashboard />
  </I18nextProvider>,
);
