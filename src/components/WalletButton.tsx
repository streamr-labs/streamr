// @ts-nocheck
import { useState, useEffect } from "react";
import { Button, Text, Modal, Icon } from "@stellar/design-system";
import { useWallet } from "../hooks/useWallet";
import { useWalletBalance } from "../hooks/useWalletBalance";
import { Box } from "./layout/Box";
// Modal styles are injected at runtime to ensure they override Stellar CSS.

export const WalletButton = () => {
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);

  // Inject modal styles directly via JavaScript to ensure they override Stellar CSS
  useEffect(() => {
    const styleId = 'modal-dark-theme-overrides';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .Modal__background {
        z-index: 9999 !important;
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        background: rgba(0, 0, 0, 0.6) !important;
        backdrop-filter: blur(8px) !important;
        -webkit-backdrop-filter: blur(8px) !important;
      }
      .Modal__container {
        z-index: 10001 !important;
        position: fixed !important;
        top: 50% !important;
        left: 50% !important;
        transform: translate(-50%, -50%) !important;
        max-width: 500px !important;
        width: 90% !important;
        background-color: transparent !important;
        border: none !important;
        box-shadow: none !important;
        padding: 0 !important;
      }
      .Modal__content {
        background: rgba(15, 23, 42, 0.95) !important;
        backdrop-filter: blur(20px) !important;
        -webkit-backdrop-filter: blur(20px) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.5), 0 20px 60px rgba(0, 0, 0, 0.5) !important;
        border-radius: 16px !important;
        padding: 2rem !important;
        color: #ffffff !important;
        position: relative !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 1.5rem !important;
      }
      .ModalHeading {
        color: #ffffff !important;
        font-weight: 600 !important;
      }
      .ModalBody {
        color: #ffffff !important;
      }
      .ModalFooter {
        color: #ffffff !important;
      }
      .Modal__content *,
      .ModalHeading *,
      .ModalBody *,
      .ModalFooter * {
        color: #ffffff !important;
      }
      .Modal__content h1,
      .Modal__content h2,
      .Modal__content h3,
      .Modal__content h4,
      .Modal__content h5,
      .Modal__content h6 {
        color: #ffffff !important;
        font-weight: 600 !important;
      }
      .Modal__content p,
      .Modal__content span,
      .Modal__content code,
      .ModalBody p,
      .ModalBody span,
      .ModalBody code {
        color: #ffffff !important;
      }
      .Modal__content code,
      .ModalBody code {
        background: rgba(255, 255, 255, 0.1) !important;
        padding: 0.25rem 0.5rem !important;
        border-radius: 8px !important;
        font-family: 'Inconsolata', monospace !important;
        color: #ffffff !important;
      }
      .ModalFooter button,
      .Modal__content button {
        background: rgba(255, 255, 255, 0.05) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        color: #ffffff !important;
      }
      .ModalFooter button[class*="primary"],
      .Modal__content button[class*="primary"] {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
        border: none !important;
        color: #ffffff !important;
      }
      .Modal__close svg {
        stroke: #ffffff !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      const existingStyle = document.getElementById(styleId);
      if (existingStyle) {
        existingStyle.remove();
      }
    };
  }, []);
  const { address, isPending, isConnecting, connect, disconnect } = useWallet();
  const { xlm, ...balance } = useWalletBalance();
  const buttonLabel = isPending ? "Loading..." : isConnecting ? "Connecting..." : "Connect";

  if (!address) {
    return (
      <Button 
        variant="primary" 
        size="sm" 
        onClick={() => void connect()}
        disabled={isConnecting}
      >
        {buttonLabel}
      </Button>
    );
  }

  // Format address for display (first 6 and last 4 characters)
  const formatAddress = (addr: string) => {
    if (addr.length <= 10) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <>
      <div className="wallet-info">
        <button
          className="wallet-address-button"
          onClick={() => setShowDisconnectModal(true)}
          style={{ opacity: balance.isLoading ? 0.6 : 1 }}
        >
          <Text as="span" size="sm" className="address-text">
          {xlm} XLM
          </Text>
        </button>
      </div>

      <Modal
        visible={showDisconnectModal}
        onClose={() => setShowDisconnectModal(false)}
      >
        <Box gap="md" direction="column">
          <Box gap="sm" direction="column" align="center">
            <Modal.Heading>
              Disconnect Wallet?
            </Modal.Heading>
            <Text as="p" size="sm" style={{ color: 'var(--color-text-inverse)', opacity: 0.8, textAlign: 'center' }}>
              You are currently connected as:
            </Text>
            <code className="modal-address-code">{address}</code>
            <Text as="p" size="sm" style={{ color: 'var(--color-text-inverse)', opacity: 0.8, textAlign: 'center' }}>
              Do you want to disconnect this wallet?
            </Text>
          </Box>
          <Modal.Footer itemAlignment="stack">
            <Button
              size="md"
              variant="primary"
              onClick={() => {
                void disconnect().then(() =>
                  setShowDisconnectModal(false),
                );
              }}
            >
              <Icon.LogOut01 size="sm" />
              Disconnect
            </Button>
            <Button
              size="md"
              variant="tertiary"
              onClick={() => {
                setShowDisconnectModal(false);
              }}
            >
              Cancel
            </Button>
          </Modal.Footer>
        </Box>
      </Modal>
    </>
  );
};
