"use client";

import { useMutation } from "@tanstack/react-query";

interface StagedTarget {
  url: string;
  resourceUrl: string;
  parameters: Array<{ name: string; value: string }>;
}

interface FileUploadInput {
  files: File[];
  onProgress?: (completed: number, total: number) => void;
}

export function useFileUpload() {
  return useMutation({
    mutationFn: async ({ files, onProgress }: FileUploadInput) => {
      // Step 1: Get staged upload URLs
      const stageRes = await fetch("/api/media/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: files.map((f) => ({
            filename: f.name,
            mimeType: f.type,
            fileSize: f.size,
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
        formData.append("file", file);

        const uploadRes = await fetch(target.url, {
          method: "POST",
          body: formData,
        });

        if (!uploadRes.ok) {
          throw new Error(`Failed to upload ${file.name}`);
        }

        resourceUrls.push(target.resourceUrl);
        onProgress?.(i + 1, files.length);
      }

      // Step 3: Create files via fileCreate mutation
      const createRes = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceUrls }),
      });

      if (!createRes.ok) {
        const data = await createRes.json();
        throw new Error(data.error || "Failed to create files");
      }

      const { files: createdFiles } = (await createRes.json()) as {
        files: Array<{ id: string; alt: string }>;
      };

      return createdFiles.map((f) => f.id);
    },
  });
}
