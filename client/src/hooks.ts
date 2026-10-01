import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type CatalogItem, type Household, type Recipe } from "./api";

export const useHousehold = () => useQuery({ queryKey: ["household"], queryFn: () => api<Household>("/household") });
export const useCatalog = () => useQuery({ queryKey: ["items"], queryFn: () => api<CatalogItem[]>("/items") });
export const useRecipes = () => useQuery({ queryKey: ["recipes"], queryFn: () => api<Recipe[]>("/recipes") });

/** Anything that changes stock affects most screens, so refresh them together. */
const STOCK_KEYS = ["items", "inventory", "predictions", "recipes", "item", "shopping", "logs", "health", "mealplan", "waste"];

export function useStockMutation<TVars, TData = unknown>(fn: (v: TVars) => Promise<TData>, onSuccess?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const k of STOCK_KEYS) qc.invalidateQueries({ queryKey: [k] });
      onSuccess?.();
    },
  });
}
