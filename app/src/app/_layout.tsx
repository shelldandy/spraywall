import { useEffect } from "react";
import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDb } from "../lib/db/database";
import { startSyncEngine, stopSyncEngine } from "../lib/sync/engine";

const queryClient = new QueryClient();

export default function RootLayout() {
  useEffect(() => {
    // Initialize SQLite database
    getDb();
    // Start background sync
    startSyncEngine(queryClient);
    return () => stopSyncEngine();
  }, []);

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
