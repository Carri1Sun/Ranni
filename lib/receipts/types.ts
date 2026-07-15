export type ReceiptCategory =
  | "artifact"
  | "command"
  | "evidence"
  | "file"
  | "observation"
  | "state"
  | "verification"
  | "other";

export type FileReceipt = {
  deleted?: boolean;
  hash?: string;
  path: string;
  receiptId: string;
  toolName: string;
};

export type CommandReceipt = {
  command: string;
  exitCode: number | null;
  receiptId: string;
  timedOut: boolean;
};

export type EvidenceReceipt = {
  key: string;
  receiptId: string;
  source?: string;
  summary: string;
};

export type ArtifactLifecycle =
  | "pending"
  | "draft"
  | "accepted"
  | "prepared"
  | "exported"
  | "validated";

export type ArtifactReceipt = {
  count?: number;
  hash?: string;
  key: string;
  kind: string;
  path?: string;
  receiptId: string;
  status: ArtifactLifecycle;
};

export type VerificationReceipt = {
  details: string[];
  passed: boolean;
  receiptId: string;
  scope: string;
  slideCount?: number;
};

export type ErrorReceipt = {
  fingerprint: string;
  message: string;
  receiptId: string;
  resolved: boolean;
  strategySignature: string;
  toolName: string;
};

export type ReceiptProjection = {
  artifacts?: Omit<ArtifactReceipt, "receiptId">[];
  commands?: Omit<CommandReceipt, "receiptId">[];
  evidence?: Omit<EvidenceReceipt, "receiptId">[];
  files?: Omit<FileReceipt, "receiptId">[];
  verification?: Omit<VerificationReceipt, "receiptId">[];
};

export type ToolReceipt = {
  category: ReceiptCategory;
  domainStatus: "failed" | "succeeded" | "unchanged" | "unknown";
  durationMs: number;
  endedAt: number;
  error?: string;
  id: string;
  input: unknown;
  inputHash: string;
  inputSummary: string;
  projection: ReceiptProjection;
  result: string;
  resultHash: string;
  resultSummary: string;
  reused: boolean;
  startedAt: number;
  strategySignature: string;
  success: boolean;
  toolName: string;
  toolUseId: string;
  unchanged: boolean;
};

export type ObservedState = {
  artifacts: Record<string, ArtifactReceipt>;
  commands: CommandReceipt[];
  evidence: Record<string, EvidenceReceipt>;
  files: Record<string, FileReceipt>;
  receipts: ToolReceipt[];
  stateHash: string;
  unresolvedErrors: ErrorReceipt[];
  verification: VerificationReceipt[];
};
