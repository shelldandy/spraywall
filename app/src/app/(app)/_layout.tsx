import { View } from "react-native";
import { Stack, Redirect } from "expo-router";
import { useServerStore, useHasHydrated } from "../../lib/store/server";
import SyncStatusBar from "../../components/SyncStatusBar";

export default function AppLayout() {
  const hasHydrated = useHasHydrated();
  const { accessToken } = useServerStore();

  if (!hasHydrated) {
    return null;
  }

  if (!accessToken) {
    return <Redirect href="/login" />;
  }

  return (
    <View style={{ flex: 1 }}>
      <SyncStatusBar />
      <Stack screenOptions={{ headerShown: false }} />
    </View>
  );
}
