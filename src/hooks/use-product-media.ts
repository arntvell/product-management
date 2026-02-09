"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { MediaItem } from "@/types";

async function fetchProductMedia(productId: string): Promise<MediaItem[]> {
  const res = await fetch(
    `/api/media/${encodeURIComponent(productId)}`
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch media: ${res.statusText}`);
  }
  const data = await res.json();
  return data.media;
}

export function useProductMedia(productId: string | null) {
  return useQuery({
    queryKey: ["product-media", productId],
    queryFn: () => fetchProductMedia(productId!),
    enabled: !!productId,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

interface UploadFile {
  filename: string;
  mimeType: string;
  fileSize: number;
  file: File;
}

interface StagedTarget {
  url: string;
  resourceUrl: string;
  parameters: Array<{ name: string; value: string }>;
}

export function useUploadMedia() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      productId,
      files,
      onProgress,
    }: {
      productId: string;
      files: UploadFile[];
      onProgress?: (completed: number, total: number) => void;
    }) => {
      // Step 1: Get staged upload URLs
      const stageRes = await fetch("/api/media/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: files.map((f) => ({
            filename: f.filename,
            mimeType: f.mimeType,
            fileSize: f.fileSize,
          })),
        }),
      });

      if (!stageRes.ok) {
        const data = await stageRes.json();
        throw new Error(data.error || "Failed to create staged uploads");
      }

      const { targets } = (await stageRes.json()) as {
        targets: StagedTarget[];
      };

      // Step 2: Upload files to staged URLs
      const resourceUrls: string[] = [];
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        const file = files[i];

        const formData = new FormData();
        for (const param of target.parameters) {
          formData.append(param.name, param.value);
        }
        formData.append("file", file.file);

        const uploadRes = await fetch(target.url, {
          method: "POST",
          body: formData,
        });

        if (!uploadRes.ok) {
          throw new Error(`Failed to upload ${file.filename}`);
        }

        resourceUrls.push(target.resourceUrl);
        onProgress?.(i + 1, files.length);
      }

      // Step 3: Confirm media creation
      const confirmRes = await fetch("/api/media/upload/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, resourceUrls }),
      });

      if (!confirmRes.ok) {
        const data = await confirmRes.json();
        throw new Error(data.error || "Failed to confirm upload");
      }

      return confirmRes.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["product-media", vars.productId],
      });
    },
  });
}

export function useDeleteMedia() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      productId,
      mediaIds,
    }: {
      productId: string;
      mediaIds: string[];
    }) => {
      const res = await fetch(
        `/api/media/${encodeURIComponent(productId)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mediaIds }),
        }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete media");
      }
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["product-media", vars.productId],
      });
    },
  });
}

export function useReorderMedia() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      productId,
      moves,
    }: {
      productId: string;
      moves: Array<{ id: string; newPosition: string }>;
    }) => {
      const res = await fetch("/api/media/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, moves }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to reorder media");
      }
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["product-media", vars.productId],
      });
    },
  });
}
