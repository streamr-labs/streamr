// @ts-nocheck
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useWallet } from "./useWallet";
import { useStreamerContract } from "./useStreamerContract";
import { useNotification } from "./useNotification";
import { Address } from "@stellar/stellar-sdk/contract";
import { Address as StellarBaseAddress, scValToBigInt, xdr } from "@stellar/stellar-base";

/**
 * Stream data structure from contract
 */
export interface Stream {
  id: number;
  sender: string;
  recipient: string;
  recipients?: string[];
  token_contract: string;
  rate_per_second: bigint;
  deposit: bigint;
  start_time: bigint;
  last_withdraw_time: bigint;
  is_active: boolean;
  title?: string | null;
  description?: string | null;
}

/**
 * Formatted stream for UI display
 */
export interface FormattedStream extends Stream {
  withdrawableAmount: bigint;
  totalStreamed: bigint;
  remainingDeposit: bigint;
  estimatedCompletionTime: number | null;
  duration: number;
  progress: number; // 0-100
}

/**
 * Hook for fetching and managing payment streams
 */

export const unwrapOptionalText = (value: any): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === "object") {
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
      const decoded = value.toString("utf-8").trim();
      return decoded.length ? decoded : null;
    }
    if (typeof value._value === "object" && value._value?.type === "Buffer" && Array.isArray(value._value?.data)) {
      const bytes = Uint8Array.from(value._value.data);
      let decoded = "";
      if (typeof Buffer !== "undefined") {
        decoded = Buffer.from(bytes).toString("utf-8").trim();
      } else if (typeof TextDecoder !== "undefined") {
        decoded = new TextDecoder("utf-8").decode(bytes).trim();
      }
      return decoded.length ? decoded : null;
    }
    if ("some" in value) return unwrapOptionalText(value.some);
    if ("value" in value) return unwrapOptionalText(value.value);
    if ("str" in value) return unwrapOptionalText(value.str);
    if (Array.isArray(value)) {
      if (value.length === 0) return null;
      return unwrapOptionalText(value[0]);
    }
    if (typeof value.toString === "function") {
      const asString = value.toString();
      if (asString && asString !== "[object Object]") {
        return unwrapOptionalText(asString);
      }
    }
  }
  const fallback = String(value ?? "").trim();
  return fallback.length ? fallback : null;
};

export const unwrapAddress = (value: unknown): string => {
  if (!value) return "";
  const asString = String(value).trim();
  if (asString.startsWith("\"") && asString.endsWith("\"")) {
    return asString.slice(1, -1);
  }
  return asString;
};

export const mapRawStream = (stream: any): Stream | null => {
  if (!stream) return null;
  const id = Number(stream.id?.toString?.() ?? stream.id);
  if (Number.isNaN(id)) return null;

  const recipientsArray: string[] = Array.isArray(stream.recipients)
    ? stream.recipients.map(unwrapAddress)
    : [];
  const primaryRecipient =
    recipientsArray.length > 0 ? recipientsArray[0] : unwrapAddress(stream.recipient || "");

  const rate = stream.rate_per_second?.toString?.() ?? stream.rate_per_second ?? "0";
  const deposit = stream.deposit?.toString?.() ?? stream.deposit ?? "0";
  const startTime = stream.start_time?.toString?.() ?? stream.start_time ?? "0";
  const lastWithdrawTime = stream.last_withdraw_time?.toString?.() ?? stream.last_withdraw_time ?? "0";

  return {
    id,
    sender: unwrapAddress(stream.sender || ""),
    recipient: primaryRecipient,
    recipients: recipientsArray,
    token_contract: stream.token_contract || "",
    rate_per_second: BigInt(rate || "0"),
    deposit: BigInt(deposit || "0"),
    start_time: BigInt(startTime || "0"),
    last_withdraw_time: BigInt(lastWithdrawTime || "0"),
    is_active: Boolean(stream.is_active),
    title: unwrapOptionalText(stream.title),
    description: unwrapOptionalText(stream.description),
  };
};

export const useStreams = () => {
  const { address } = useWallet();
  const { getContractClient, executeContractMethod } = useStreamerContract();
  const queryClient = useQueryClient();
  const { addNotification } = useNotification();

  

  /**
   * Calculate withdrawable amount for a stream
   */
  

  const calculateWithdrawableAmount = useCallback(
    (stream: Stream, currentTime: bigint): bigint => {
      if (!stream.is_active) {
        return BigInt(0);
      }

      const elapsed = currentTime - stream.last_withdraw_time;
      if (elapsed <= 0) {
        return BigInt(0);
      }

      const withdrawable = elapsed * stream.rate_per_second;
      const remaining = stream.deposit - calculateTotalStreamed(stream, currentTime);

      // Return the minimum of withdrawable and remaining deposit
      return withdrawable < remaining ? withdrawable : remaining;
    },
    []
  );

  /**
   * Calculate total streamed amount up to current time
   */
  const calculateTotalStreamed = useCallback(
    (stream: Stream, currentTime: bigint): bigint => {
      if (!stream.is_active) {
        return stream.deposit; // All streamed if inactive
      }

      const elapsed = currentTime - stream.start_time;
      if (elapsed <= 0) {
        return BigInt(0);
      }

      const total = elapsed * stream.rate_per_second;
      return total < stream.deposit ? total : stream.deposit;
    },
    []
  );

  /**
   * Format stream data for UI
   */
  const formatStream = useCallback(
    (stream: Stream, currentTime: bigint): FormattedStream => {
      const totalStreamed = calculateTotalStreamed(stream, currentTime);
      const withdrawableAmount = calculateWithdrawableAmount(stream, currentTime);
      const remainingDeposit = stream.deposit - totalStreamed;

      // Calculate progress percentage
      const progress =
        stream.deposit > 0 ? Number((totalStreamed * BigInt(100)) / stream.deposit) : 0;

      // Calculate estimated completion time
      let estimatedCompletionTime: number | null = null;
      if (stream.is_active && stream.rate_per_second > 0) {
        const secondsRemaining = Number(remainingDeposit / stream.rate_per_second);
        estimatedCompletionTime = Number(currentTime) + secondsRemaining;
      }

      // Duration in seconds
      const duration = stream.is_active
        ? Number(currentTime - stream.start_time)
        : Number(stream.last_withdraw_time - stream.start_time);

      const normalizedSender = unwrapAddress(stream.sender);
      const normalizedRecipient = unwrapAddress(stream.recipient);
      const normalizedRecipients = stream.recipients?.map(unwrapAddress) ?? [];

      return {
        ...stream,
        withdrawableAmount,
        totalStreamed,
        remainingDeposit,
        estimatedCompletionTime,
        duration,
        progress,
        title: stream.title ?? null,
        description: stream.description ?? null,
        sender: normalizedSender,
        recipient: normalizedRecipient,
        recipients: normalizedRecipients,
      };
    },
    [calculateTotalStreamed, calculateWithdrawableAmount]
  );

  /**
   * Normalize raw stream data to the Stream interface
   */
  

  /**
   * Decode a stream returned as raw ScVal when generated bindings fail to parse
   */
  const decodeStreamScVal = useCallback(
    (scVal: xdr.ScVal): Stream | null => {
      try {
        const entries = scVal?.map?.();
        if (!entries || !Array.isArray(entries)) {
          return null;
        }

        const fieldMap = new Map<string, xdr.ScVal>();
        entries.forEach((entry) => {
          const keyVal = entry.key();
          if (keyVal.switch().value === xdr.ScValType.scvSymbol().value) {
            fieldMap.set(keyVal.sym().toString(), entry.val());
          }
        });

        const bytesToUtf8 = (value: Buffer | Uint8Array): string => {
          if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
            return value.toString("utf-8");
          }
          const array = value instanceof Uint8Array ? value : Uint8Array.from(value);
          if (typeof TextDecoder !== "undefined") {
            return new TextDecoder("utf-8").decode(array);
          }
          let result = "";
          array.forEach((code) => {
            result += String.fromCharCode(code);
          });
          return result;
        };

        const decodeText = (value?: xdr.ScVal): string | null => {
          if (!value) return null;
          const type = value.switch().value;
          if (type === xdr.ScValType.scvString().value) {
            return unwrapOptionalText(value.str().toString());
          }
          if (type === xdr.ScValType.scvSymbol().value) {
            return unwrapOptionalText(value.sym().toString());
          }
          if (type === xdr.ScValType.scvVec().value) {
            const vec = value.vec() ?? [];
            if (!vec.length) return null;
            const tag = vec[0];
            if (tag && tag.switch().value === xdr.ScValType.scvSymbol().value) {
              const symbol = tag.sym().toString();
              if (symbol === "some" && vec.length > 1) {
                return decodeText(vec[1]);
              }
              if (symbol === "none") {
                return null;
              }
            }
            return decodeText(vec[0]);
          }
          if (type === xdr.ScValType.scvVoid().value) {
            return null;
          }
          if (type === xdr.ScValType.scvBytes().value) {
            const bytes = value.bytes();
            const text = bytesToUtf8(bytes);
            return unwrapOptionalText(text);
          }
          return unwrapOptionalText(value.toString());
        };

        const decodeAddress = (value?: xdr.ScVal): string => {
          if (!value) return "";
          const type = value.switch().value;
          if (type === xdr.ScValType.scvAddress().value) {
            return StellarBaseAddress.fromScAddress(value.address()).toString();
          }
          if (type === xdr.ScValType.scvString().value) {
            return unwrapAddress(value.str().toString());
          }
          if (type === xdr.ScValType.scvVec().value) {
            const vec = value.vec() ?? [];
            if (!vec.length) return "";
            return decodeAddress(vec[0]);
          }
          return "";
        };

        const decodeBigIntVal = (value?: xdr.ScVal): bigint => {
          if (!value) return BigInt(0);
          const t = value.switch().value;
          if (
            t === xdr.ScValType.scvI128().value ||
            t === xdr.ScValType.scvU128().value ||
            t === xdr.ScValType.scvI256().value ||
            t === xdr.ScValType.scvU256().value
          ) {
            return scValToBigInt(value);
          }
          if (t === xdr.ScValType.scvU64().value) {
            return scValToBigInt(xdr.ScVal.scvU64(value.u64()));
          }
          if (t === xdr.ScValType.scvI64().value) {
            return scValToBigInt(xdr.ScVal.scvI64(value.i64()));
          }
          if (t === xdr.ScValType.scvU32().value) {
            return BigInt(value.u32());
          }
          if (t === xdr.ScValType.scvI32().value) {
            return BigInt(value.i32());
          }
          return BigInt(0);
        };

        const decodeRecipients = (value?: xdr.ScVal): string[] => {
          if (!value || value.switch().value !== xdr.ScValType.scvVec().value) {
            return [];
          }
          const vec = value.vec() ?? [];
          return vec
            .map((item) => decodeAddress(item))
            .filter((addr): addr is string => typeof addr === "string" && addr.length > 0);
        };

        const decodeAddressBigIntMap = (value?: xdr.ScVal): Map<string, bigint> => {
          const result = new Map<string, bigint>();
          if (!value || value.switch().value !== xdr.ScValType.scvMap().value) {
            return result;
          }
          const mapEntries = value.map() ?? [];
          mapEntries.forEach((entry) => {
            const key = decodeAddress(entry.key());
            if (!key) return;
            result.set(key, decodeBigIntVal(entry.val()));
          });
          return result;
        };

        const idVal = fieldMap.get("id");
        const senderVal = fieldMap.get("sender");
        const recipientsVal = fieldMap.get("recipients");
        const tokenContractVal = fieldMap.get("token_contract");
        const rateMapVal = fieldMap.get("recipient_rate_per_second");
        const lastWithdrawMapVal = fieldMap.get("recipient_last_withdraw");

        const deposit = decodeBigIntVal(fieldMap.get("deposit"));
        const startTime = decodeBigIntVal(fieldMap.get("start_time"));
        const recipients = decodeRecipients(recipientsVal);
        const sender = decodeAddress(senderVal);
        const tokenContract = decodeText(tokenContractVal) ?? "";
        const isActive =
          fieldMap.get("is_active")?.switch().value === xdr.ScValType.scvBool().value
            ? Boolean(fieldMap.get("is_active")?.b())
            : false;
        const title = decodeText(fieldMap.get("title"));
        const description = decodeText(fieldMap.get("description"));

        const id =
          idVal && idVal.switch().value === xdr.ScValType.scvU32().value ? Number(idVal.u32()) : 0;

        const rateMap = decodeAddressBigIntMap(rateMapVal);
        const lastWithdrawMap = decodeAddressBigIntMap(lastWithdrawMapVal);

        const primaryRecipient = recipients[0] || decodeAddress(fieldMap.get("recipient"));
        const ratePerSecond =
          (primaryRecipient && rateMap.get(primaryRecipient)) ??
          (rateMap.size ? Array.from(rateMap.values())[0] : BigInt(0));
        const lastWithdrawTime =
          (primaryRecipient && lastWithdrawMap.get(primaryRecipient)) ?? BigInt(0);

        const rawStream = {
          id,
          sender,
          recipient: primaryRecipient,
          recipients,
          token_contract: tokenContract,
          rate_per_second: ratePerSecond,
          deposit,
          start_time: startTime,
          last_withdraw_time: lastWithdrawTime,
          is_active: isActive,
          title,
          description,
        };

        return mapRawStream(rawStream);
      } catch (err) {
        console.error("Failed to decode stream ScVal", err);
        return null;
      }
    },
    [mapRawStream, unwrapAddress, unwrapOptionalText]
  );

  /**
   * Fetch a single stream by ID
   */
  const fetchStream = useCallback(
    async (streamId: number): Promise<Stream> => {
      const client = getContractClient();
      const tx = await client.get_stream({ stream_id: streamId }, { simulate: true });

      try {
        await tx.simulate();
      } catch (simulateError) {
        console.warn(`Simulation failed for stream ${streamId}`, simulateError);
      }

      try {
        const raw = (tx as any).result ?? (tx as any);
        const parsed = raw?.result ?? raw;
        const mapped = mapRawStream(parsed);
        if (mapped) {
          return mapped;
        }
      } catch (err) {
        console.warn(`Generated bindings failed to parse stream ${streamId}`, err);
      }

      const fallback = decodeStreamScVal(tx.simulationData.result.retval);
      if (fallback) {
        return fallback;
      }

      throw new Error(`Unable to decode stream ${streamId}`);
    },
    [getContractClient, mapRawStream, decodeStreamScVal]
  );

  /**
   * Fetch all streams for the current user using the new contract method
   * This is much more efficient than iterating through stream IDs
   */
  const fetchAllStreams = useCallback(async (): Promise<Stream[]> => {
    if (!address) {
      return [];
    }

    const client = getContractClient();

    const fetchByIds = async (): Promise<Stream[]> => {
      const ids = new Set<number>();

      const collectIds = async (promise: Promise<any>) => {
        try {
          const res = await promise;
          const rawIds = res?.result ?? [];
          const arr: any[] = Array.isArray(rawIds)
            ? rawIds
            : Array.isArray(rawIds?.value)
            ? rawIds.value
            : [];
          arr.forEach((item) => {
            const num = Number(item?.toString?.() ?? item);
            if (!Number.isNaN(num)) {
              ids.add(num);
            }
          });
        } catch (err) {
          console.error("Fallback: failed to collect stream IDs", err);
        }
      };

      await collectIds(client.get_user_sent_stream_ids({ user: address }, { simulate: true }));
      await collectIds(client.get_user_received_stream_ids({ user: address }, { simulate: true }));

      const streams: Stream[] = [];
      for (const id of ids) {
        try {
          const tx = await client.get_stream({ stream_id: id }, { simulate: true });
          try {
            await tx.simulate();
          } catch (simulateErr) {
            console.warn(`Simulation failed for stream ${id}`, simulateErr);
          }

          let mapped: Stream | null = null;
          try {
            const raw = (tx as any).result ?? (tx as any);
            const parsed = raw?.result ?? raw;
            mapped = mapRawStream(parsed);
          } catch (parseErr) {
            console.warn(`Generated bindings failed to parse stream ${id}`, parseErr);
          }

          if (!mapped) {
            mapped = decodeStreamScVal(tx.simulationData.result.retval);
          }

          if (mapped) {
            streams.push(mapped);
          } else {
            console.error(`Failed to decode stream ${id}: no data parsed`);
          }
        } catch (err) {
          console.error(`Fallback: failed to fetch stream ${id}`, err);
        }
      }

      return streams;
    };

    return await fetchByIds();
  }, [address, getContractClient, mapRawStream, decodeStreamScVal]);

  /**
   * Query hook for fetching all streams
   */
  const {
    data: streams = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["streams", address],
    queryFn: fetchAllStreams,
    enabled: !!address,
    refetchInterval: 10000, // Refetch every 10 seconds for real-time updates
  });

  /**
   * Format streams with current time
   */
  const formattedStreams = useMemo(() => {
    if (!streams.length) return [];
    const currentTime = BigInt(Math.floor(Date.now() / 1000));
    return streams.map((stream) => formatStream(stream, currentTime));
  }, [streams, formatStream]);

  /**
   * Filter streams by type
   */
  const sentStreams = useMemo(
    () =>
      formattedStreams.filter(
        (stream) => stream.sender && address && stream.sender.trim() === address.trim(),
      ),
    [formattedStreams, address]
  );

  const receivedStreams = useMemo(
    () =>
      formattedStreams.filter(
        (stream) => stream.recipient && address && stream.recipient.trim() === address.trim(),
      ),
    [formattedStreams, address]
  );

  /**
   * Format amount for display (assuming 7 decimals for tokens)
   */
  const formatAmount = useCallback((amount: bigint | string | number) => {
    const amountNum = typeof amount === 'bigint' 
      ? Number(amount) 
      : typeof amount === 'string' 
      ? parseFloat(amount) 
      : amount;
    return (amountNum / 10000000).toFixed(2);
  }, []);

  /**
   * Withdraw from a stream
   */
  const withdrawMutation = useMutation({
    mutationFn: async (streamId: number) => {
      return executeContractMethod(async () => {
        const client = getContractClient();
        return await client.withdraw_stream({ stream_id: streamId });
      });
    },
    onSuccess: async (result) => {
      console.log("=== WITHDRAW RESULT DEBUG ===");
      console.log("Full result object:", JSON.stringify(result, (key, value) => 
        typeof value === 'bigint' ? value.toString() : value, 2));
      console.log("Result type:", typeof result);
      console.log("Result keys:", result ? Object.keys(result) : "no result");
      console.log("Result.result:", result?.result);
      console.log("Result.result type:", typeof result?.result);
      console.log("Result.hash:", result?.hash);
      console.log("=============================");
      
      // Extract withdrawn amount from result
      let withdrawnAmount = "0";
      try {
        // The result from signAndSend should have a structure like:
        // { result: <actual return value>, hash: <tx hash>, ... }
        // For withdraw_stream, the return value is i128 (bigint)
        if (result && typeof result === 'object') {
          // Check if result has a 'result' property (the actual return value)
          if ('result' in result && result.result !== undefined && result.result !== null) {
            let amount: bigint;
            
            if (typeof result.result === 'bigint') {
              amount = result.result;
            } else if (typeof result.result === 'string') {
              // Try parsing as number first
              const num = parseFloat(result.result);
              if (!isNaN(num)) {
                amount = BigInt(Math.floor(num));
              } else {
                // Might be hex or other format
                amount = BigInt(result.result);
              }
            } else if (typeof result.result === 'number') {
              amount = BigInt(Math.floor(result.result));
            } else {
              // Try to convert to string and parse
              amount = BigInt(result.result?.toString() || '0');
            }
            
            withdrawnAmount = formatAmount(amount);
            console.log("Extracted withdrawn amount:", withdrawnAmount, "from raw:", result.result);
          } else if ('hash' in result && result.hash) {
            // Transaction was successful, but we don't have the exact amount yet
            console.log("Transaction hash:", result.hash, "- waiting for processing...");
            withdrawnAmount = "funds";
          }
        } else if (typeof result === 'bigint' || typeof result === 'string' || typeof result === 'number') {
          // Result might be directly the amount
          const amount = typeof result === 'bigint' 
            ? result 
            : typeof result === 'string'
            ? BigInt(result)
            : BigInt(result);
          withdrawnAmount = formatAmount(amount);
        }
      } catch (e) {
        console.warn("Could not parse withdrawn amount:", e, "result was:", result);
        // If we have a hash, the transaction succeeded even if we can't parse the amount
        if (result?.hash) {
          withdrawnAmount = "funds";
        }
      }
      
      // Wait a bit for the transaction to be processed on-chain before refetching
      // This ensures the state update is reflected when we query
      console.log("Waiting 2 seconds before refetching streams...");
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Invalidate and refetch streams to update balances
      // Use refetchQueries to ensure immediate refetch
      console.log("Invalidating and refetching streams...");
      await queryClient.invalidateQueries({ queryKey: ["streams"] });
      await queryClient.refetchQueries({ queryKey: ["streams", address] });
      console.log("Streams refetched");
      
      addNotification(
        `Successfully withdrawn ${withdrawnAmount} tokens from stream!`,
        "success"
      );
    },
    onError: (error: any) => {
      console.error("Withdraw failed:", error);
      
      // Extract user-friendly error message
      let errorMessage = "Failed to withdraw from stream. Please try again.";
      
      if (error?.message) {
        if (error.message.includes("NothingToWithdraw") || error.message.includes("nothing to withdraw")) {
          errorMessage = "No funds available to withdraw from this stream yet.";
        } else if (error.message.includes("StreamInactive") || error.message.includes("stream inactive")) {
          errorMessage = "This stream is inactive and cannot be withdrawn from.";
        } else if (error.message.includes("StreamNotFound") || error.message.includes("stream not found")) {
          errorMessage = "Stream not found. It may have been deleted.";
        } else if (error.message.includes("rejected") || error.message.includes("User rejected")) {
          errorMessage = "Transaction was cancelled.";
        } else {
          errorMessage = error.message;
        }
      }
      
      addNotification(errorMessage, "error");
    },
  });

  /**
   * Cancel a stream
   */
  const cancelMutation = useMutation({
    mutationFn: async (streamId: number) => {
      return executeContractMethod(async () => {
        const client = getContractClient();
        return await client.cancel_stream({ stream_id: streamId });
      });
    },
    onSuccess: () => {
      // Invalidate and refetch streams
      queryClient.invalidateQueries({ queryKey: ["streams"] });
      addNotification("Stream cancelled successfully!", "success");
    },
    onError: (error: any) => {
      console.error("Cancel failed:", error);
      
      let errorMessage = "Failed to cancel stream. Please try again.";
      
      if (error?.message) {
        if (error.message.includes("StreamNotFound") || error.message.includes("stream not found")) {
          errorMessage = "Stream not found. It may have been deleted.";
        } else if (error.message.includes("StreamInactive") || error.message.includes("stream inactive")) {
          errorMessage = "This stream is already inactive.";
        } else if (error.message.includes("rejected") || error.message.includes("User rejected")) {
          errorMessage = "Transaction was cancelled.";
        } else {
          errorMessage = error.message;
        }
      }
      
      addNotification(errorMessage, "error");
    },
  });

  return {
    streams: formattedStreams,
    sentStreams,
    receivedStreams,
    isLoading,
    error,
    refetch,
    withdraw: withdrawMutation.mutate,
    cancel: cancelMutation.mutate,
    isWithdrawing: withdrawMutation.isPending,
    isCancelling: cancelMutation.isPending,
  };
};

