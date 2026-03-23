import React from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useRoutes } from "../../../lib/hooks/queries";
import { useSyncStore } from "../../../lib/store/sync";
import { triggerSync } from "../../../lib/sync/engine";
import type { Route } from "../../../lib/api/types";

export default function RoutesListScreen() {
  const { wallId, gymSlug } = useLocalSearchParams<{
    wallId: string;
    gymSlug: string;
  }>();

  const queryClient = useQueryClient();
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const routesQuery = useRoutes(wallId, gymSlug);

  const routes = routesQuery.data ?? [];

  const renderRoute = ({ item }: { item: Route }) => (
    <Pressable
      style={styles.routeCard}
      onPress={() =>
        router.push({
          pathname: "/(app)/routes/[routeId]" as any,
          params: { routeId: item.id, wallId, gymSlug },
        })
      }
    >
      <View style={styles.routeInfo}>
        <Text style={styles.routeName}>{item.name}</Text>
        {item.grade && (
          <Text style={styles.routeGrade}>{item.grade}</Text>
        )}
        <Text style={styles.sendCount}>
          {item.send_count} send{item.send_count !== 1 ? "s" : ""}
        </Text>
      </View>
      <View style={styles.routeRight}>
        {item.status === "draft" && (
          <View style={styles.draftBadge}>
            <Text style={styles.draftBadgeText}>Draft</Text>
          </View>
        )}
        {item.is_legacy && (
          <View style={styles.resetBadge}>
            <Text style={styles.resetBadgeText}>Reset</Text>
          </View>
        )}
        {item.has_sent && (
          <View style={styles.sentBadge}>
            <Text style={styles.sentBadgeText}>Sent</Text>
          </View>
        )}
        <Text style={styles.chevron}>{">"}</Text>
      </View>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{"< Back"}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Routes</Text>
        <View style={{ minWidth: 60 }} />
      </View>

      {routesQuery.isLoading ? (
        <ActivityIndicator style={styles.loader} size="large" color="#007AFF" />
      ) : (
        <FlatList
          data={routes}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isSyncing}
              onRefresh={() => triggerSync(queryClient)}
            />
          }
          renderItem={renderRoute}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              No routes yet. Select holds on the wall to create one.
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
  emptyText: {
    textAlign: "center",
    color: "#999",
    marginTop: 40,
    fontSize: 16,
  },
  routeCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f8f8f8",
    padding: 14,
    borderRadius: 8,
    marginBottom: 8,
  },
  routeInfo: {
    flex: 1,
  },
  routeName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  routeGrade: {
    fontSize: 14,
    color: "#666",
    marginTop: 2,
  },
  sendCount: {
    fontSize: 13,
    color: "#999",
    marginTop: 2,
  },
  routeRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sentBadge: {
    backgroundColor: "#34c759",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  sentBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  draftBadge: {
    backgroundColor: "#999",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  draftBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  resetBadge: {
    backgroundColor: "#f5a623",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  resetBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  chevron: {
    fontSize: 16,
    color: "#999",
  },
});
