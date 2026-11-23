import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { CheckoutWidget } from "./CheckoutWidget";
import { server, contract } from "../contract";
import { rpc } from "@stellar/stellar-sdk";

// Mock contract and server
jest.mock("../contract", () => ({
  CONTRACT_ID: "CCONTRACT1234567890",
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  RPC_URL: "https://soroban-testnet.stellar.org",
  contract: {
    call: jest.fn().mockReturnValue({}),
  },
  server: {
    getAccount: jest.fn().mockResolvedValue({
      accountId: () => "GUSER1234567890123456789012345678901234567890123456789012",
      sequenceNumber: () => "1",
      incrementSequenceNumber: () => {},
    }),
    prepareTransaction: jest.fn().mockImplementation((tx) => Promise.resolve({
      ...tx,
      toXDR: () => "AAAA_PREPARED_XDR",
    })),
    sendTransaction: jest.fn().mockResolvedValue({
      status: "PENDING",
      hash: "0x1234567890abcdef",
    }),
    getTransaction: jest.fn().mockResolvedValue({
      status: "SUCCESS",
    }),
  },
}));

describe("CheckoutWidget", () => {
  const defaultProps = {
    orderId: "order_test_101",
    amount: 500,
    token: "CDUMMYTOKEN123",
    merchantAddress: "GMERCHANT123456789012345678901234567890123456789012345678",
    onSuccess: jest.fn(),
    onError: jest.fn(),
  };

  const mockFreighter = {
    setAllowed: jest.fn().mockResolvedValue(true),
    getPublicKey: jest.fn().mockResolvedValue("GUSER1234567890123456789012345678901234567890123456789012"),
    signTransaction: jest.fn().mockResolvedValue({
      signedXDR: "AAAA_SIGNED_XDR",
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (window as any).freighter = mockFreighter;
  });

  afterEach(() => {
    delete (window as any).freighter;
  });

  it("renders order information and connect wallet button", () => {
    render(<CheckoutWidget {...defaultProps} />);

    expect(screen.getByText("order_test_101")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("CDUMMYTOKEN123")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect wallet/i })).toBeInTheDocument();
  });

  it("connects wallet when connect button is clicked", async () => {
    render(<CheckoutWidget {...defaultProps} />);

    const connectBtn = screen.getByRole("button", { name: /connect wallet/i });
    await act(async () => {
      fireEvent.click(connectBtn);
    });

    expect(mockFreighter.setAllowed).toHaveBeenCalled();
    expect(mockFreighter.getPublicKey).toHaveBeenCalled();
    expect(screen.getByText(/GUSER123/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pay now/i })).toBeInTheDocument();
  });

  it("successfully prepares, signs, sends, and polls transaction on Pay Now", async () => {
    render(<CheckoutWidget {...defaultProps} />);

    // Connect wallet first
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    });

    const payBtn = screen.getByRole("button", { name: /pay now/i });

    await act(async () => {
      fireEvent.click(payBtn);
    });

    await waitFor(() => {
      expect(server.prepareTransaction).toHaveBeenCalled();
      expect(mockFreighter.signTransaction).toHaveBeenCalled();
      expect(server.sendTransaction).toHaveBeenCalled();
      expect(server.getTransaction).toHaveBeenCalledWith("0x1234567890abcdef");
      expect(defaultProps.onSuccess).toHaveBeenCalledWith("0x1234567890abcdef");
    });
  });

  it("triggers onError callback when transaction fails on ledger", async () => {
    (server.getTransaction as jest.Mock).mockResolvedValueOnce({
      status: "FAILED",
    });

    render(<CheckoutWidget {...defaultProps} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /pay now/i }));
    });

    await waitFor(() => {
      expect(defaultProps.onError).toHaveBeenCalledWith(
        expect.stringContaining("Transaction execution failed on ledger"),
      );
    });
  });
});
