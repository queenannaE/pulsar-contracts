import type { Meta, StoryObj } from "@storybook/react";
import { CopyButton } from "./CopyButton";

const meta: Meta<typeof CopyButton> = {
  title: "Controls/CopyButton",
  component: CopyButton,
  args: {
    text: "GABC123...XYZ",
    label: "Copy address",
  },
};

export default meta;

type Story = StoryObj<typeof CopyButton>;

export const Default: Story = {};

export const CustomLabel: Story = {
  args: {
    text: "0xdeadbeef",
    label: "Copy tx hash",
  },
};
