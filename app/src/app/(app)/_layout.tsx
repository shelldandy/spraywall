import { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import { useServerStore } from "../../lib/store/server";

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

  return <Stack screenOptions={{ headerShown: false }} />;
}
