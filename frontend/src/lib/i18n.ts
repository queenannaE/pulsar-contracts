import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../locales/en.json";
import fr from "../locales/fr.json";

// ── MISC-041: i18n provider configuration ──────────────────────────────────
//
// Supported locales live under `src/locales/<lang>.json`. `en` is the
// source of truth; other locales are translations of the same key shape.
// See CONTRIBUTING.md "Adding / updating a translation" for the workflow.

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
