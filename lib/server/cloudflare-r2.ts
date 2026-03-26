type R2ObjectBody = {
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

type R2ObjectLike = {
  body: R2ObjectBody | null;
  httpMetadata?: {
    contentType?: string;
  };
  size?: number;
};

type R2BucketLike = {
  put: (
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ) => Promise<unknown>;
  get: (key: string) => Promise<R2ObjectLike | null>;
  delete: (key: string) => Promise<void>;
};

export function getR2(): R2BucketLike | null {
  return (globalThis as { FILES?: R2BucketLike }).FILES ?? null;
}
