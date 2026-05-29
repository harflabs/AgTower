// --- SessionEvent from Rust Channel (matches #[serde(tag="event", content="data")]) ---

export type SessionEvent =
  | { event: "PtyOutput"; data: { data: string } } // base64-encoded bytes
  | {
      event: "Terminated";
      data: { code: number | null; signal: string | null };
    };

export interface PtySessionState {
  processState: "running" | "terminated";
  attachmentState: "attached" | "detached" | "parked";
  cols: number;
  rows: number;
}

export interface PtyPreviewBootstrap extends PtySessionState {
  snapshot: string;
  outputOffset: number;
}

export interface PtyOutputBroadcast {
  data: string;
  endOffset: number;
}

export interface PtyOwnerLease {
  token: string;
  generation: number;
}

// --- Session types ---

export type SessionStatus = "running" | "idle" | "needsAttention" | "closed" | "archived";

export type ProviderType = string;
