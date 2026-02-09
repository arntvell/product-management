"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Model } from "@/types";

async function fetchModels(): Promise<Model[]> {
  const res = await fetch("/api/models");
  if (!res.ok) {
    throw new Error(`Failed to fetch models: ${res.statusText}`);
  }
  const data = await res.json();
  return data.models;
}

export function useModels() {
  const query = useQuery({
    queryKey: ["models"],
    queryFn: fetchModels,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    ...query,
    models: query.data || [],
  };
}

interface CreateModelInput {
  name: string;
  height: string;
  size_worn: string;
  notes: string;
}

export function useCreateModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateModelInput) => {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create model");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
  });
}

export function useUpdateModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: CreateModelInput & { id: string }) => {
      const res = await fetch(
        `/api/models/${encodeURIComponent(id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update model");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
  });
}

export function useDeleteModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/models/${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete model");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
  });
}
