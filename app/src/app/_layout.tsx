import { useEffect } from "react";
import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isDbAvailable, getDb } from "../lib/db/database";
import { startSyncEngine, stopSyncEngine } from "../lib/sync/engine";
import { useHasHydrated, useServerStore } from "../lib/store/server";

const queryClient = new QueryClient();

export default function RootLayout() {
  const hasHydrated = useHasHydrated();
  const isAuthenticated = useServerStore((state) => state.accessToken !== null);

  useEffect(() => {
    if (!isDbAvailable()) return;

    getDb();
    if (!hasHydrated || !isAuthenticated) return;

    startSyncEngine(queryClient);
    return () => stopSyncEngine();
  }, [hasHydrated, isAuthenticated]);

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="(app)" />
      </Stack>
    </QueryClientProvider>
  );
}
