import React, { useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  SectionList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useLogbook } from "../../lib/hooks/queries";
import { useSyncStore } from "../../lib/store/sync";
import { triggerSync } from "../../lib/sync/engine";
import type { LogbookEntry } from "../../lib/api/types";

interface LogbookSection {
  title: string;
  data: LogbookEntry[];
}

export default function LogbookScreen() {
  const queryClient = useQueryClient();
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const logbookQuery = useLogbook();

  const entries = logbookQuery.data ?? [];

  const sections: LogbookSection[] = useMemo(() => {
    const grouped = new Map<string, LogbookEntry[]>();
    for (const entry of entries) {
      const key = entry.wall_name;
      const existing = grouped.get(key);
      if (existing) {
        existing.push(entry);
      } else {
        grouped.set(key, [entry]);
      }
    }
    return Array.from(grouped.entries()).map(([title, data]) => ({
      title,
      data,
    }));
  }, [entries]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{"< Back"}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Logbook</Text>
        <View style={{ minWidth: 60 }} />
      </View>

      {logbookQuery.isLoading ? (
        <ActivityIndicator style={styles.loader} size="large" color="#007AFF" />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isSyncing}
              onRefresh={() => triggerSync(queryClient)}
            />
          }
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>{section.title}</Text>
          )}
          renderItem={({ item }) => (
            <View style={styles.entryCard}>
              <View style={styles.entryInfo}>
                <Text style={styles.entryName}>{item.route_name}</Text>
                {item.route_grade && (
                  <Text style={styles.entryGrade}>{item.route_grade}</Text>
                )}
              </View>
              <Text style={styles.entryDate}>{formatDate(item.sent_at)}</Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              No sends yet. Go climb something!
            </Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  backButton: {
    paddingRight: 12,
    minWidth: 60,
  },
  backText: {
    color: "#007AFF",
    fontSize: 16,
    fontWeight: "600",
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
  },
  loader: {
    marginTop: 40,
  },
  listContent: {
    padding: 16,
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: "700",
    color: "#333",
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: "#fff",
  },
  entryCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f8f8f8",
    padding: 14,
    borderRadius: 8,
    marginBottom: 6,
  },
  entryInfo: {
    flex: 1,
  },
  entryName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
  },
  entryGrade: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
  entryDate: {
    fontSize: 13,
    color: "#999",
  },
  emptyText: {
    textAlign: "center",
    color: "#999",
    marginTop: 40,
    fontSize: 16,
  },
});
