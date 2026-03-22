import { useEffect } from "react";
import { View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useServerStore } from "../../lib/store/server";
import SyncStatusBar from "../../components/SyncStatusBar";

export default function AppLayout() {
  const router = useRouter();
  const { accessToken } = useServerStore();

  useEffect(() => {
    if (!accessToken) {
      router.replace("/login" as any);
    }
  }, [accessToken, router]);

  if (!accessToken) {
    return null;
  }

  return (
    <View style={{ flex: 1 }}>
      <SyncStatusBar />
      <Stack screenOptions={{ headerShown: false }} />
    </View>
  );
}
