import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  Image,
  StyleSheet,
  Alert,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  LayoutChangeEvent,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, router } from "expo-router";
import { apiFetch } from "../../../lib/api/fetch";
import { useServerStore } from "../../../lib/store/server";
import type { Route, WallDetail, Hold } from "../../../lib/api/types";
import HoldOverlay from "../../../components/HoldOverlay";

export default function RouteDetailScreen() {
  const { routeId, wallId, gymSlug } = useLocalSearchParams<{
    routeId: string;
    wallId: string;
    gymSlug: string;
  }>();
  const queryClient = useQueryClient();
  const { serverUrl } = useServerStore();

  const [imageLayout, setImageLayout] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const routeQuery = useQuery<Route>({
    queryKey: ["route-detail", gymSlug, wallId, routeId],
    queryFn: async () => {
      const res = await apiFetch(
        `/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}`
      );
      if (!res.ok) throw new Error("Failed to fetch route");
      return res.json();
    },
  });

  const wallQuery = useQuery<WallDetail>({
    queryKey: ["wall-detail", gymSlug, wallId],
    queryFn: async () => {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}`);
      if (!res.ok) throw new Error("Failed to fetch wall");
      return res.json();
    },
  });

  const holdsQuery = useQuery<Hold[]>({
    queryKey: ["holds", gymSlug, wallId],
    queryFn: async () => {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/holds`);
      if (!res.ok) throw new Error("Failed to fetch holds");
      return res.json();
    },
    enabled: wallQuery.data?.detection_status === "done",
  });

  const routeData = routeQuery.data;
  const wall = wallQuery.data;
  const allHolds = holdsQuery.data ?? [];

  const routeHoldIds = useMemo(
    () => new Set(routeData?.hold_ids ?? []),
    [routeData?.hold_ids]
  );

  const routeHolds = useMemo(
    () => allHolds.filter((h) => routeHoldIds.has(h.id)),
    [allHolds, routeHoldIds]
  );

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(
        `/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}/sends`,
        {
          method: "POST",
          body: JSON.stringify({}),
        }
      );
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Failed to log send");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["route-detail", gymSlug, wallId, routeId],
      });
      queryClient.invalidateQueries({
        queryKey: ["routes", gymSlug, wallId],
      });
      queryClient.invalidateQueries({ queryKey: ["logbook"] });
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });

  const unsendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(
        `/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}/sends/me`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Failed to remove send");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["route-detail", gymSlug, wallId, routeId],
      });
      queryClient.invalidateQueries({
        queryKey: ["routes", gymSlug, wallId],
      });
      queryClient.invalidateQueries({ queryKey: ["logbook"] });
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });

  const onImageLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setImageLayout({ width, height });
  };

  const isLoading =
    routeQuery.isLoading || wallQuery.isLoading || holdsQuery.isLoading;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{"< Back"}</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {routeData?.name ?? "Route"}
        </Text>
        <View style={{ minWidth: 60 }} />
      </View>

      {isLoading ? (
        <ActivityIndicator style={styles.loader} size="large" color="#007AFF" />
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {routeData?.is_legacy && (
            <View style={styles.legacyBanner}>
              <Text style={styles.legacyBannerText}>
                This route was reset when a new wall photo was uploaded
              </Text>
            </View>
          )}

          <View style={styles.metaRow}>
            {routeData?.grade && (
              <View style={styles.gradeBadge}>
                <Text style={styles.gradeBadgeText}>{routeData.grade}</Text>
              </View>
            )}
            {routeData?.is_legacy && (
              <View style={styles.resetBadge}>
                <Text style={styles.resetBadgeText}>Reset</Text>
              </View>
            )}
            <Text style={styles.sendCount}>
              {routeData?.send_count ?? 0} send
              {(routeData?.send_count ?? 0) !== 1 ? "s" : ""}
            </Text>
          </View>

          {routeData?.description && (
            <Text style={styles.description}>{routeData.description}</Text>
          )}

          {wall?.image ? (
            <View style={styles.imageContainer}>
              <Image
                source={{ uri: `${serverUrl}${wall.image.image_url}` }}
                style={styles.wallImage}
                resizeMode="contain"
                onLayout={onImageLayout}
              />
              {imageLayout && routeHolds.length > 0 && (
                <HoldOverlay
                  holds={routeHolds}
                  selectedIds={routeHoldIds}
                  onToggle={() => {}}
                  imageWidth={imageLayout.width}
                  imageHeight={imageLayout.height}
                />
              )}
            </View>
          ) : (
            <View style={styles.noImage}>
              <Text style={styles.noImageText}>No wall image</Text>
            </View>
          )}

          <Text style={styles.holdCount}>
            {routeHolds.length} hold{routeHolds.length !== 1 ? "s" : ""}
          </Text>

          {routeData?.has_sent ? (
            <View style={styles.sentSection}>
              <View style={styles.sentBadgeLarge}>
                <Text style={styles.sentBadgeLargeText}>Sent</Text>
              </View>
              <Pressable
                style={styles.unsendButton}
                onPress={() => unsendMutation.mutate()}
                disabled={unsendMutation.isPending}
              >
                <Text style={styles.unsendText}>
                  {unsendMutation.isPending ? "Removing..." : "Remove Send"}
                </Text>
              </Pressable>
            </View>
          ) : routeData?.is_legacy ? (
            <Pressable
              style={[styles.sendButton, styles.buttonDisabled]}
              disabled={true}
            >
              <Text style={styles.sendText}>Route reset - sends disabled</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[
                styles.sendButton,
                sendMutation.isPending && styles.buttonDisabled,
              ]}
              onPress={() => sendMutation.mutate()}
              disabled={sendMutation.isPending}
            >
              <Text style={styles.sendText}>
                {sendMutation.isPending ? "Logging..." : "Log Send"}
              </Text>
            </Pressable>
          )}
        </ScrollView>
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
  scrollContent: {
    padding: 16,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  gradeBadge: {
    backgroundColor: "#007AFF",
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  gradeBadgeText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  sendCount: {
    fontSize: 14,
    color: "#666",
  },
  description: {
    fontSize: 15,
    color: "#444",
    marginBottom: 16,
    lineHeight: 22,
  },
  imageContainer: {
    position: "relative",
    width: "100%",
    aspectRatio: 3 / 4,
    marginBottom: 12,
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    overflow: "hidden",
  },
  wallImage: {
    width: "100%",
    height: "100%",
  },
  noImage: {
    width: "100%",
    aspectRatio: 3 / 4,
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  noImageText: {
    color: "#999",
    fontSize: 16,
  },
  holdCount: {
    textAlign: "center",
    color: "#666",
    fontSize: 14,
    marginBottom: 16,
  },
  sendButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
  },
  sendText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  sentSection: {
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  sentBadgeLarge: {
    backgroundColor: "#34c759",
    paddingVertical: 8,
    paddingHorizontal: 24,
    borderRadius: 16,
  },
  sentBadgeLargeText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  unsendButton: {
    paddingVertical: 8,
  },
  unsendText: {
    color: "#ff3b30",
    fontSize: 14,
    fontWeight: "600",
  },
  legacyBanner: {
    backgroundColor: "#fff3e0",
    borderWidth: 1,
    borderColor: "#f5a623",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  legacyBannerText: {
    color: "#e65100",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  resetBadge: {
    backgroundColor: "#f5a623",
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  resetBadgeText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});
