import type { Meta, StoryObj } from "@storybook/react";
import { Spinner, ErrorMessage, SuccessBanner } from "./ContractCallStatus";

const meta: Meta = {
  title: "Feedback/ContractCallStatus",
};

export default meta;

export const Loading: StoryObj<typeof Spinner> = {
  render: () => <Spinner label="Submitting…" />,
};

export const Error: StoryObj<typeof ErrorMessage> = {
  render: () => <ErrorMessage message="Payment failed: insufficient balance" />,
};

export const Success: StoryObj<typeof SuccessBanner> = {
  render: () => <SuccessBanner txHash="a1b2c3d4e5f6" />,
};
