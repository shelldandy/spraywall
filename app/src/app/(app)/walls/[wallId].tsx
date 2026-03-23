import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  LayoutChangeEvent,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { apiFetch } from "../../../lib/api/fetch";
import { useServerStore } from "../../../lib/store/server";
import { useWallDetail, useHolds } from "../../../lib/hooks/queries";
import { isDbAvailable } from "../../../lib/db/database";
import { triggerSync } from "../../../lib/sync/engine";
import type { Hold } from "../../../lib/api/types";

function getDbQueries() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../../../lib/db/queries") as typeof import("../../../lib/db/queries");
}
import HoldOverlay from "../../../components/HoldOverlay";
import ZoomableView from "../../../components/ZoomableView";

export default function WallDetailScreen() {
  const { wallId, gymSlug, editRouteId, editHoldIds, editHoldRoles, editName, editGrade, editDescription } =
    useLocalSearchParams<{
      wallId: string;
      gymSlug: string;
      editRouteId?: string;
      editHoldIds?: string;
      editHoldRoles?: string;
      editName?: string;
      editGrade?: string;
      editDescription?: string;
    }>();
  const queryClient = useQueryClient();
  const { serverUrl } = useServerStore();

  const isEditingRoute = !!editRouteId;

  const [isEditingHolds, setIsEditingHolds] = useState(false);
  const [editHoldMode, setEditHoldMode] = useState<"delete" | "add">("delete");
  const [holdToDelete, setHoldToDelete] = useState<string | null>(null);

  type HoldRole = "normal" | "start" | "finish";
  const [holdSelections, setHoldSelections] = useState<Map<string, HoldRole>>(
    () => {
      if (!editHoldIds) return new Map();
      const ids: string[] = JSON.parse(editHoldIds);
      const roles = editHoldRoles ? JSON.parse(editHoldRoles) as { start: string[]; finish: string[] } : null;
      const map = new Map<string, HoldRole>();
      for (const id of ids) {
        if (roles?.start.includes(id)) {
          map.set(id, "start");
        } else if (roles?.finish.includes(id)) {
          map.set(id, "finish");
        } else {
          map.set(id, "normal");
        }
      }
      return map;
    },
  );
  const selectedIds = new Set(holdSelections.keys());
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.25);
  const [imageLayout, setImageLayout] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [uploading, setUploading] = useState(false);

  const wallQuery = useWallDetail(wallId, gymSlug);

  const holdsQuery = useHolds(
    wallId,
    wallQuery.data?.detection_status === "done",
    gymSlug,
  );

  const handleToggle = useCallback((holdId: string) => {
    setHoldSelections((prev) => {
      const next = new Map(prev);
      const current = next.get(holdId);
      if (!current) {
        next.set(holdId, "normal");
      } else if (current === "normal") {
        next.set(holdId, "start");
      } else if (current === "start") {
        next.set(holdId, "finish");
      } else {
        next.delete(holdId);
      }
      return next;
    });
  }, []);

  const deleteHold = useCallback(
    async (holdId: string) => {
      // Optimistic removal
      queryClient.setQueryData<Hold[] | undefined>(["holds", wallId], (old) =>
        old ? old.filter((h) => h.id !== holdId) : old
      );
      try {
        const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/holds/${holdId}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Failed to delete hold");
      } catch {
        queryClient.invalidateQueries({ queryKey: ["holds", wallId] });
      }
    },
    [queryClient, gymSlug, wallId],
  );

  const handleEditToggle = useCallback(
    (holdId: string) => {
      if (editHoldMode === "delete") {
        setHoldToDelete((prev) => {
          if (prev === holdId) {
            // Second tap = confirm delete
            deleteHold(holdId);
            return null;
          }
          return holdId;
        });
      }
    },
    [editHoldMode, deleteHold],
  );

  const addHold = async (normX: number, normY: number) => {
    const size = 0.05;
    const bbox = {
      x: Math.max(0, normX - size / 2),
      y: Math.max(0, normY - size / 2),
      w: Math.min(size, 1 - Math.max(0, normX - size / 2)),
      h: Math.min(size, 1 - Math.max(0, normY - size / 2)),
    };
    try {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/holds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bbox }),
      });
      if (!res.ok) throw new Error("Failed to add hold");
      const newHold = await res.json();
      if (isDbAvailable()) getDbQueries().upsertHolds([newHold]);
      queryClient.invalidateQueries({ queryKey: ["holds", wallId] });
    } catch (err: any) {
      Alert.alert("Error", err.message);
    }
  };

  const handleUpload = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const uri = asset.uri;
    const filename = uri.split("/").pop() ?? "photo.jpg";
    const match = /\.(\w+)$/.exec(filename);
    const mimeType = match ? `image/${match[1]}` : "image/jpeg";

    const formData = new FormData();
    if (Platform.OS === "web") {
      const response = await fetch(uri);
      const blob = await response.blob();
      formData.append("image", blob, filename);
    } else {
      formData.append("image", {
        uri,
        name: filename,
        type: mimeType,
      } as any);
    }

    setUploading(true);
    try {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/images`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Upload failed");
      }
      // Trigger sync to pull the new image into SQLite
      if (isDbAvailable()) triggerSync(queryClient);
      queryClient.invalidateQueries({
        queryKey: ["wall-detail", wallId],
      });
      queryClient.invalidateQueries({ queryKey: ["holds", wallId] });
      setHoldSelections(new Map());
    } catch (err: any) {
      Alert.alert("Upload Error", err.message);
    } finally {
      setUploading(false);
    }
  };

  const onImageLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setImageLayout({ width, height });
  };

  const wall = wallQuery.data;
  const holds = holdsQuery.data ?? [];
  const filteredHolds = holds.filter((h) => h.confidence >= confidenceThreshold);
  const filteredIds = new Set(filteredHolds.map((h) => h.id));
  const visibleSelectedIds = new Set(
    [...selectedIds].filter((id) => filteredIds.has(id)),
  );
  const detectionStatus = wall?.detection_status;

  const statusBadge = () => {
    if (!detectionStatus) return null;
    let color = "#999";
    let label = detectionStatus;
    if (detectionStatus === "pending" || detectionStatus === "processing") {
      color = "#f5a623";
      label = "Detecting holds...";
    } else if (detectionStatus === "done") {
      color = "#34c759";
      label = "Holds detected";
    } else if (detectionStatus === "failed") {
      color = "#ff3b30";
      label = "Detection failed";
    }
    return (
      <View style={[styles.badge, { backgroundColor: color }]}>
        <Text style={styles.badgeText}>{label}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{"< Back"}</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {wall?.wall.name ?? "Wall"}
        </Text>
        {isEditingHolds ? (
          <Pressable onPress={() => { setIsEditingHolds(false); setHoldToDelete(null); }}>
            <Text style={styles.backText}>Done</Text>
          </Pressable>
        ) : (
          <Text style={styles.selectedCount}>
            {visibleSelectedIds.size > 0 ? `${visibleSelectedIds.size} selected` : ""}
          </Text>
        )}
      </View>

      {wallQuery.isLoading ? (
        <ActivityIndicator style={styles.loader} size="large" color="#007AFF" />
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {statusBadge()}

          {wall?.image ? (
            <View style={styles.imageContainer}>
              {imageLayout ? (
                <ZoomableView
                  width={imageLayout.width}
                  height={imageLayout.height}
                >
                  <Image
                    source={{ uri: `${serverUrl}${wall.image.image_url}` }}
                    style={styles.wallImage}
                    contentFit="contain"
                    onLayout={onImageLayout}
                  />
                  {(isEditingHolds || filteredHolds.length > 0) && (
                    <HoldOverlay
                      holds={isEditingHolds ? holds : filteredHolds}
                      selectedIds={isEditingHolds ? new Set() : selectedIds}
                      onToggle={isEditingHolds ? handleEditToggle : handleToggle}
                      imageWidth={imageLayout.width}
                      imageHeight={imageLayout.height}
                      mode={isEditingHolds ? "edit" : undefined}
                      editHoldMode={editHoldMode}
                      holdToDelete={holdToDelete}
                      onBackgroundPress={editHoldMode === "add" ? addHold : undefined}
                      holdRoles={
                        holdSelections.size > 0
                          ? {
                              start: [...holdSelections.entries()]
                                .filter(([id, r]) => r === "start" && visibleSelectedIds.has(id))
                                .map(([id]) => id),
                              finish: [...holdSelections.entries()]
                                .filter(([id, r]) => r === "finish" && visibleSelectedIds.has(id))
                                .map(([id]) => id),
                            }
                          : null
                      }
                    />
                  )}
                </ZoomableView>
              ) : (
                <Image
                  source={{ uri: `${serverUrl}${wall.image.image_url}` }}
                  style={styles.wallImage}
                  contentFit="contain"
                  onLayout={onImageLayout}
                />
              )}
            </View>
          ) : (
            <View style={styles.noImage}>
              <Text style={styles.noImageText}>No photo uploaded yet</Text>
            </View>
          )}

          {(wall?.user_role === "setter" || wall?.user_role === "admin") && (
            <Pressable
              style={[styles.uploadButton, uploading && styles.buttonDisabled]}
              onPress={handleUpload}
              disabled={uploading}
            >
              <Text style={styles.uploadText}>
                {uploading ? "Uploading..." : "Upload Photo"}
              </Text>
            </Pressable>
          )}

          {(wall?.user_role === "setter" || wall?.user_role === "admin") && detectionStatus === "done" && !isEditingHolds && (
            <Pressable style={styles.editHoldsButton} onPress={() => setIsEditingHolds(true)}>
              <Text style={styles.editHoldsText}>Edit Holds</Text>
            </Pressable>
          )}

          {isEditingHolds && (
            <View style={styles.editToolbar}>
              <Pressable
                style={[styles.editToolButton, editHoldMode === "delete" && styles.editToolButtonActive]}
                onPress={() => { setEditHoldMode("delete"); setHoldToDelete(null); }}
              >
                <Text style={[styles.editToolText, editHoldMode === "delete" && styles.editToolTextActive]}>Delete</Text>
              </Pressable>
              <Pressable
                style={[styles.editToolButton, editHoldMode === "add" && styles.editToolButtonActive]}
                onPress={() => { setEditHoldMode("add"); setHoldToDelete(null); }}
              >
                <Text style={[styles.editToolText, editHoldMode === "add" && styles.editToolTextActive]}>Add</Text>
              </Pressable>
            </View>
          )}

          {!isEditingHolds && detectionStatus === "done" && holds.length > 0 && (
            <View style={styles.thresholdContainer}>
              <Text style={styles.thresholdLabel}>Confidence threshold</Text>
              <View style={styles.thresholdButtons}>
                {[0.1, 0.25, 0.5, 0.75, 0.9].map((t) => (
                  <Pressable
                    key={t}
                    style={[
                      styles.thresholdButton,
                      confidenceThreshold === t && styles.thresholdButtonActive,
                    ]}
                    onPress={() => setConfidenceThreshold(t)}
                  >
                    <Text
                      style={[
                        styles.thresholdButtonText,
                        confidenceThreshold === t &&
                          styles.thresholdButtonTextActive,
                      ]}
                    >
                      {Math.round(t * 100)}%
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {!isEditingHolds && detectionStatus === "done" && holds.length > 0 && (
            <Text style={styles.holdCount}>
              {filteredHolds.length} of {holds.length} hold
              {holds.length !== 1 ? "s" : ""} ({"\u2265"}{" "}
              {Math.round(confidenceThreshold * 100)}%)
            </Text>
          )}

          {!isEditingHolds && visibleSelectedIds.size >= 2 && (
            <Pressable
              style={styles.createRouteButton}
              onPress={() => {
                const holdRoles = {
                  start: [...holdSelections.entries()]
                    .filter(([id, r]) => r === "start" && visibleSelectedIds.has(id))
                    .map(([id]) => id),
                  finish: [...holdSelections.entries()]
                    .filter(([id, r]) => r === "finish" && visibleSelectedIds.has(id))
                    .map(([id]) => id),
                };
                router.push({
                  pathname: "/(app)/routes/create" as any,
                  params: {
                    wallId,
                    gymSlug,
                    holdIds: JSON.stringify(Array.from(visibleSelectedIds)),
                    holdRoles: JSON.stringify(holdRoles),
                    ...(isEditingRoute && {
                      routeId: editRouteId,
                      initialName: editName ?? "",
                      initialGrade: editGrade ?? "",
                      initialDescription: editDescription ?? "",
                    }),
                  },
                });
              }}
            >
              <Text style={styles.createRouteText}>
                {isEditingRoute ? "Update" : "Create"} Route ({visibleSelectedIds.size} holds)
              </Text>
            </Pressable>
          )}

          {!isEditingHolds && (
            <Pressable
              style={styles.viewRoutesButton}
              onPress={() =>
                router.push({
                  pathname: "/(app)/routes" as any,
                  params: { wallId, gymSlug },
                })
              }
            >
              <Text style={styles.viewRoutesText}>View Routes</Text>
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
  selectedCount: {
    fontSize: 14,
    color: "#007AFF",
    minWidth: 60,
    textAlign: "right",
  },
  loader: {
    marginTop: 40,
  },
  scrollContent: {
    padding: 16,
  },
  badge: {
    alignSelf: "flex-start",
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  badgeText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  imageContainer: {
    position: "relative",
    width: "100%",
    aspectRatio: 3 / 4,
    marginBottom: 16,
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
    marginBottom: 16,
  },
  noImageText: {
    color: "#999",
    fontSize: 16,
  },
  uploadButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
  },
  uploadText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  thresholdContainer: {
    marginBottom: 12,
  },
  thresholdLabel: {
    fontSize: 13,
    color: "#666",
    marginBottom: 6,
  },
  thresholdButtons: {
    flexDirection: "row",
    gap: 6,
  },
  thresholdButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "#f0f0f0",
  },
  thresholdButtonActive: {
    backgroundColor: "#007AFF",
  },
  thresholdButtonText: {
    fontSize: 13,
    color: "#666",
  },
  thresholdButtonTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  holdCount: {
    textAlign: "center",
    color: "#666",
    fontSize: 14,
    marginBottom: 12,
  },
  createRouteButton: {
    backgroundColor: "#34c759",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
  },
  createRouteText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  viewRoutesButton: {
    backgroundColor: "#f8f8f8",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#007AFF",
    marginBottom: 12,
  },
  viewRoutesText: {
    color: "#007AFF",
    fontSize: 16,
    fontWeight: "600",
  },
  editHoldsButton: {
    backgroundColor: "#f0f0f0",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#666",
  },
  editHoldsText: {
    color: "#333",
    fontSize: 16,
    fontWeight: "600",
  },
  editToolbar: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  editToolButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: "#f0f0f0",
  },
  editToolButtonActive: {
    backgroundColor: "#007AFF",
  },
  editToolText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#666",
  },
  editToolTextActive: {
    color: "#fff",
  },
});
