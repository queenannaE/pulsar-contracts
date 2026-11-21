import type { Preview } from "@storybook/react";

const preview: Preview = {
  parameters: {
    controls: { expanded: true },
    backgrounds: {
      default: "light",
      values: [
        { name: "light", value: "#ffffff" },
        { name: "dark", value: "#111827" },
      ],
    },
  },
};

export default preview;
