import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useHolds, useRoutes, useWallDetail } from "../../../lib/hooks/queries";
import { useServerStore } from "../../../lib/store/server";
import { useSyncStore } from "../../../lib/store/sync";
import { triggerSync } from "../../../lib/sync/engine";
import HoldOverlay from "../../../components/HoldOverlay";
import type { Hold, Route } from "../../../lib/api/types";

const THUMBNAIL_WIDTH = 76;
const THUMBNAIL_HEIGHT = 96;

type RouteThumbnailProps = {
  route: Route;
  holds: Hold[];
  imageUrl: string | null;
};

function RouteThumbnail({ route, holds, imageUrl }: RouteThumbnailProps) {
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const selectedIds = new Set(route.hold_ids);
  const routeHolds = holds.filter((hold) => selectedIds.has(hold.id));

  let imageBounds: { width: number; height: number; left: number; top: number } | null = null;
  if (sourceSize) {
    const scale = Math.min(
      THUMBNAIL_WIDTH / sourceSize.width,
      THUMBNAIL_HEIGHT / sourceSize.height,
    );
    const width = sourceSize.width * scale;
    const height = sourceSize.height * scale;
    imageBounds = {
      width,
      height,
      left: (THUMBNAIL_WIDTH - width) / 2,
      top: (THUMBNAIL_HEIGHT - height) / 2,
    };
  }

  return (
    <View style={styles.thumbnail}>
      {imageUrl ? (
        <>
          <Image
            source={{ uri: imageUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            onLoad={({ source }) => {
              if (source.width > 0 && source.height > 0) {
                setSourceSize({ width: source.width, height: source.height });
              }
            }}
          />
          {imageBounds && routeHolds.length > 0 && (
            <View
              pointerEvents="none"
              style={[
                styles.thumbnailOverlay,
                {
                  left: imageBounds.left,
                  top: imageBounds.top,
                  width: imageBounds.width,
                  height: imageBounds.height,
                },
              ]}
            >
              <HoldOverlay
                holds={routeHolds}
                selectedIds={selectedIds}
                onToggle={() => {}}
                imageWidth={imageBounds.width}
                imageHeight={imageBounds.height}
                mode="view"
                holdRoles={route.hold_roles}
              />
            </View>
          )}
        </>
      ) : (
        <Text style={styles.thumbnailPlaceholder}>▦</Text>
      )}
    </View>
  );
}

export default function RoutesListScreen() {
  const { wallId, gymSlug } = useLocalSearchParams<{
    wallId: string;
    gymSlug: string;
  }>();
  const { serverUrl } = useServerStore();
  const queryClient = useQueryClient();
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const routesQuery = useRoutes(wallId, gymSlug);
  const wallQuery = useWallDetail(wallId, gymSlug);
  const holdsQuery = useHolds(
    wallId,
    wallQuery.data?.detection_status === "done",
    gymSlug,
  );

  const routes = routesQuery.data ?? [];
  const holds = holdsQuery.data ?? [];
  const imagePath = wallQuery.data?.image?.image_url;
  const imageUrl = imagePath ? `${serverUrl}${imagePath}` : null;

  const renderRoute = ({ item }: { item: Route }) => (
    <Pressable
      style={({ pressed }) => [styles.routeRow, pressed && styles.routeRowPressed]}
      onPress={() =>
        router.push({
          pathname: "/(app)/routes/[routeId]" as any,
          params: { routeId: item.id, wallId, gymSlug },
        })
      }
    >
      <RouteThumbnail route={item} holds={holds} imageUrl={imageUrl} />
      <View style={styles.routeInfo}>
        <Text style={styles.routeName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.routeMeta} numberOfLines={1}>
          {item.send_count} send{item.send_count !== 1 ? "s" : ""}
          <Text style={styles.metaSeparator}> · </Text>
          {item.hold_ids.length} hold{item.hold_ids.length !== 1 ? "s" : ""}
        </Text>
        {(item.status === "draft" || item.is_legacy || item.has_sent) && (
          <View style={styles.badges}>
            {item.status === "draft" && (
              <Text style={[styles.badge, styles.draftBadge]}>Draft</Text>
            )}
            {item.is_legacy && (
              <Text style={[styles.badge, styles.resetBadge]}>Reset</Text>
            )}
            {item.has_sent && (
              <Text style={[styles.badge, styles.sentBadge]}>Sent</Text>
            )}
          </View>
        )}
      </View>
      <View style={styles.gradeColumn}>
        <Text style={styles.routeGrade}>{item.grade ?? "—"}</Text>
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
        <View style={styles.headerSpacer} />
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
  headerSpacer: {
    minWidth: 60,
  },
  loader: {
    marginTop: 40,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  emptyText: {
    textAlign: "center",
    color: "#999",
    marginTop: 40,
    fontSize: 16,
  },
  routeRow: {
    minHeight: 120,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#dedede",
  },
  routeRowPressed: {
    backgroundColor: "#f7f7f7",
  },
  thumbnail: {
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
    borderRadius: 7,
    overflow: "hidden",
    position: "relative",
    backgroundColor: "#252525",
    marginRight: 14,
  },
  thumbnailOverlay: {
    position: "absolute",
    overflow: "hidden",
  },
  thumbnailPlaceholder: {
    color: "#777",
    fontSize: 30,
    textAlign: "center",
    lineHeight: THUMBNAIL_HEIGHT,
  },
  routeInfo: {
    flex: 1,
    justifyContent: "center",
    minWidth: 0,
  },
  routeName: {
    fontSize: 17,
    fontWeight: "700",
    color: "#272727",
  },
  routeMeta: {
    fontSize: 13,
    color: "#858585",
    marginTop: 5,
  },
  metaSeparator: {
    color: "#b0b0b0",
  },
  badges: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
  },
  badge: {
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },
  draftBadge: {
    backgroundColor: "#858585",
  },
  resetBadge: {
    backgroundColor: "#d99528",
  },
  sentBadge: {
    backgroundColor: "#34a853",
  },
  gradeColumn: {
    width: 46,
    alignItems: "flex-end",
    marginLeft: 8,
  },
  routeGrade: {
    fontSize: 20,
    fontWeight: "700",
    color: "#e78368",
  },
});
