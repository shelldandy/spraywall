import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSyncStore } from "../lib/store/sync";

export default function SyncStatusBar() {
  const insets = useSafeAreaInsets();
  const { isOnline, isSyncing, pendingMutationCount } = useSyncStore();

  if (isOnline && !isSyncing && pendingMutationCount === 0) {
    return null;
  }

  let message = "";
  let backgroundColor = "#f5a623";

  if (!isOnline) {
    message = pendingMutationCount > 0
      ? `Offline \u00B7 ${pendingMutationCount} change${pendingMutationCount !== 1 ? "s" : ""} pending`
      : "Offline";
    backgroundColor = "#f5a623";
  } else if (isSyncing) {
    message = "Syncing...";
    backgroundColor = "#007AFF";
  } else if (pendingMutationCount > 0) {
    message = `${pendingMutationCount} change${pendingMutationCount !== 1 ? "s" : ""} pending`;
    backgroundColor = "#f5a623";
  }

  return (
    <View style={[styles.container, { backgroundColor, paddingTop: insets.top }]}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  text: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
});
