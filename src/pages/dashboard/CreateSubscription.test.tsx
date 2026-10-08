// @ts-nocheck
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateSubscription } from "./CreateSubscription";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";

vi.mock("../../hooks/useWallet", () => ({
  useWallet: () => ({ address: "TEST_ADDRESS_123" })
}));

vi.mock("../../hooks/useStreamerContract", () => ({
  useStreamerContract: () => ({
    executeContractMethod: vi.fn(),
    getContractClient: vi.fn()
  })
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() })
}));

vi.mock("../../hooks/useNotification", () => ({
  useNotification: () => ({ addNotification: vi.fn() })
}));

describe("CreateSubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setup = () => render(<CreateSubscription />);

  it("calculates expected intervalSeconds for days, weeks, and months", async () => {
    const user = userEvent.setup();
    setup();

    const amountInput = screen.getByLabelText(/Amount per Interval/i);
    await user.clear(amountInput);
    await user.type(amountInput, "100");

    const intervalTypeSelect = screen.getByLabelText(/Interval Type/i);

    // Default months (1 month -> 2592000)
    expect(screen.getByText(/2592000/)).toBeInTheDocument();

    await user.selectOptions(intervalTypeSelect, "days");
    expect(screen.getByText(/86400/)).toBeInTheDocument();

    await user.selectOptions(intervalTypeSelect, "weeks");
    expect(screen.getByText(/604800/)).toBeInTheDocument();
  });

  it("yields 'Immediate after creation' when firstPaymentDays is 0", async () => {
    const user = userEvent.setup();
    setup();

    const daysInput = screen.getByLabelText(/Days Until First Payment/i);
    await user.clear(daysInput);
    await user.type(daysInput, "0");

    expect(screen.getByText("Immediate after creation")).toBeInTheDocument();
    
    await user.clear(daysInput);
    await user.type(daysInput, "1");
    expect(screen.queryByText("Immediate after creation")).not.toBeInTheDocument();
  });

  it("blocks submit on invalid receiver and surfaces error", async () => {
    const user = userEvent.setup();
    setup();

    const receiverInput = screen.getByLabelText(/Receiver Stellar Address/i);
    await user.clear(receiverInput);
    await user.type(receiverInput, "INVALID_ADDRESS");

    const amountInput = screen.getByLabelText(/Amount per Interval/i);
    await user.clear(amountInput);
    await user.type(amountInput, "10");

    const submitButton = screen.getByRole("button", { name: /Create Subscription/i });
    await user.click(submitButton);

    expect(screen.getByText(/Invalid receiver address/i)).toBeInTheDocument();
  });

  it("surfaces error on non-positive amount submit", async () => {
    const user = userEvent.setup();
    setup();

    const receiverInput = screen.getByLabelText(/Receiver Stellar Address/i);
    await user.clear(receiverInput);
    await user.type(receiverInput, "G" + "A".repeat(55));

    const amountInput = screen.getByLabelText(/Amount per Interval/i);
    await user.clear(amountInput);
    await user.type(amountInput, "0");

    const submitButton = screen.getByRole("button", { name: /Create Subscription/i });
    await user.click(submitButton);

    expect(screen.getByText(/Amount must be greater than 0/i)).toBeInTheDocument();
  });

  it("displays preview amount and per-second rate matching the input", async () => {
    const user = userEvent.setup();
    setup();

    const amountInput = screen.getByLabelText(/Amount per Interval/i);
    await user.clear(amountInput);
    await user.type(amountInput, "1000");

    // 1000 formatted
    expect(screen.getByText("1,000")).toBeInTheDocument();
    
    // Per second rate for 1000 over 1 month (2592000)
    const perSecond = 1000 / 2592000;
    const expectedStr = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(perSecond);
    expect(screen.getByText(expectedStr)).toBeInTheDocument();
  });
});
