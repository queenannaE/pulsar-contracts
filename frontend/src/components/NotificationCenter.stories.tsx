import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { NotificationProvider, useNotifications } from "./NotificationCenter";

function Demo() {
  const { notify } = useNotifications();
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button type="button" onClick={() => notify("error", "Payment failed: insufficient balance")}>
        Trigger error
      </button>
      <button type="button" onClick={() => notify("success", "Payment confirmed")}>
        Trigger success
      </button>
      <button type="button" onClick={() => notify("info", "Signature pending")}>
        Trigger info
      </button>
    </div>
  );
}

const meta: Meta = {
  title: "Feedback/NotificationCenter",
};

export default meta;

export const Interactive: StoryObj = {
  render: () => (
    <NotificationProvider>
      <Demo />
    </NotificationProvider>
  ),
};
