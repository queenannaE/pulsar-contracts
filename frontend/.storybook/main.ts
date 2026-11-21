import type { StorybookConfig } from "@storybook/react-vite";

/**
 * DOC-021: minimal Storybook catalogue for the frontend UI components.
 * Run with `npm run storybook` (after `npm install`) from the frontend/
 * directory.
 */
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-essentials"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  docs: {
    autodocs: "tag",
  },
};

export default config;
