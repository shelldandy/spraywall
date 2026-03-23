import React, { useState, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  TextInput,
  StyleSheet,
  Alert,
  Share,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useServerStore } from "../../../lib/store/server";
import { apiFetch } from "../../../lib/api/fetch";
import { useGymsWithWalls, type GymWithWalls } from "../../../lib/hooks/queries";
import { isDbAvailable } from "../../../lib/db/database";
import { useSyncStore } from "../../../lib/store/sync";
import { triggerSync } from "../../../lib/sync/engine";
import SwipeToDelete from "../../../components/SwipeToDelete";

function getDbQueries() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../../../lib/db/queries") as typeof import("../../../lib/db/queries");
}

export default function WallsScreen() {
  const queryClient = useQueryClient();
  const { clearTokens } = useServerStore();

  const [showGymForm, setShowGymForm] = useState(false);
  const [gymName, setGymName] = useState("");
  const [gymSlug, setGymSlug] = useState("");

  const [wallFormGymSlug, setWallFormGymSlug] = useState<string | null>(null);
  const [wallName, setWallName] = useState("");
  const gymSlugRef = useRef<TextInput>(null);

  const isSyncing = useSyncStore((s) => s.isSyncing);
  const gymsWithWallsQuery = useGymsWithWalls();

  const createGymMutation = useMutation({
    mutationFn: async ({ name, slug }: { name: string; slug: string }) => {
      const res = await apiFetch("/gyms", {
        method: "POST",
        body: JSON.stringify({ name, slug }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Failed to create gym");
      }
      return res.json();
    },
    onSuccess: (gym) => {
      if (isDbAvailable()) getDbQueries().upsertGyms([gym]);
      queryClient.invalidateQueries({ queryKey: ["gyms-with-walls"] });
      setShowGymForm(false);
      setGymName("");
      setGymSlug("");
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });

  const createWallMutation = useMutation({
    mutationFn: async ({
      gymSlug,
      name,
    }: {
      gymSlug: string;
      name: string;
    }) => {
      const res = await apiFetch(`/gyms/${gymSlug}/walls`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Failed to create wall");
      }
      return res.json();
    },
    onSuccess: (wall) => {
      if (isDbAvailable()) getDbQueries().upsertWalls([wall]);
      queryClient.invalidateQueries({ queryKey: ["gyms-with-walls"] });
      setWallFormGymSlug(null);
      setWallName("");
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });

  const handleLogout = () => {
    clearTokens();
    router.replace("/login" as any);
  };

  const handleInvite = async (gym: GymWithWalls) => {
    try {
      const res = await apiFetch(`/gyms/${gym.slug}/invites`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        Alert.alert("Error", data.error || "Failed to create invite");
        return;
      }
      const data = await res.json();
      const inviteLink = `spraywall://invite/${data.token}`;
      await Share.share({ message: `Join ${gym.name} on Spraywall! ${inviteLink}` });
    } catch {
      Alert.alert("Error", "Failed to create invite");
    }
  };

  const handleDeleteGym = (gym: GymWithWalls) => {
    Alert.alert(
      "Delete Gym",
      `Are you sure you want to delete "${gym.name}"? All walls, routes, and sends will be permanently deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const res = await apiFetch(`/gyms/${gym.slug}`, { method: "DELETE" });
              // 404 means already deleted on server — clean up locally
              if (!res.ok && res.status !== 404) {
                const data = await res.json();
                Alert.alert("Error", data.error || "Failed to delete gym");
                return;
              }
              if (isDbAvailable()) {
                const { getDb } = require("../../../lib/db/database") as typeof import("../../../lib/db/database");
                const db = getDb();
                db.execSync("BEGIN TRANSACTION");
                try {
                  // Delete children in FK order (no CASCADE in local schema)
                  db.runSync("DELETE FROM sends WHERE route_id IN (SELECT id FROM routes WHERE wall_id IN (SELECT id FROM walls WHERE gym_id = ?))", gym.id);
                  db.runSync("DELETE FROM routes WHERE wall_id IN (SELECT id FROM walls WHERE gym_id = ?)", gym.id);
                  db.runSync("DELETE FROM holds WHERE wall_image_id IN (SELECT id FROM wall_images WHERE wall_id IN (SELECT id FROM walls WHERE gym_id = ?))", gym.id);
                  db.runSync("DELETE FROM wall_images WHERE wall_id IN (SELECT id FROM walls WHERE gym_id = ?)", gym.id);
                  db.runSync("DELETE FROM walls WHERE gym_id = ?", gym.id);
                  db.runSync("DELETE FROM gyms WHERE id = ?", gym.id);
                  db.execSync("COMMIT");
                } catch {
                  db.execSync("ROLLBACK");
                }
              }
              queryClient.invalidateQueries({ queryKey: ["gyms-with-walls"] });
            } catch {
              Alert.alert("Error", "Failed to delete gym");
            }
          },
        },
      ],
    );
  };

  const handleDeleteWall = (gym: GymWithWalls, wallId: string, wallName: string) => {
    Alert.alert(
      "Delete Wall",
      `Are you sure you want to delete "${wallName}"? All routes and sends on this wall will be permanently deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const res = await apiFetch(`/gyms/${gym.slug}/walls/${wallId}`, { method: "DELETE" });
              // 404 means already deleted on server — clean up locally
              if (!res.ok && res.status !== 404) {
                const data = await res.json();
                Alert.alert("Error", data.error || "Failed to delete wall");
                return;
              }
              if (isDbAvailable()) {
                const { getDb } = require("../../../lib/db/database") as typeof import("../../../lib/db/database");
                const db = getDb();
                db.execSync("BEGIN TRANSACTION");
                try {
                  db.runSync("DELETE FROM sends WHERE route_id IN (SELECT id FROM routes WHERE wall_id = ?)", wallId);
                  db.runSync("DELETE FROM routes WHERE wall_id = ?", wallId);
                  db.runSync("DELETE FROM holds WHERE wall_image_id IN (SELECT id FROM wall_images WHERE wall_id = ?)", wallId);
                  db.runSync("DELETE FROM wall_images WHERE wall_id = ?", wallId);
                  db.runSync("DELETE FROM walls WHERE id = ?", wallId);
                  db.execSync("COMMIT");
                } catch {
                  db.execSync("ROLLBACK");
                }
              }
              queryClient.invalidateQueries({ queryKey: ["gyms-with-walls"] });
            } catch {
              Alert.alert("Error", "Failed to delete wall");
            }
          },
        },
      ],
    );
  };

  const data = gymsWithWallsQuery.data ?? [];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Spraywall</Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() =>
              router.push("/(app)/logbook" as any)
            }
            style={styles.logbookButton}
          >
            <Text style={styles.logbookText}>Logbook</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/(app)/settings" as any)}
            style={styles.logbookButton}
          >
            <Text style={styles.logbookText}>Settings</Text>
          </Pressable>
          <Pressable onPress={handleLogout} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Logout</Text>
          </Pressable>
        </View>
      </View>

      {gymsWithWallsQuery.isLoading ? (
        <ActivityIndicator style={styles.loader} size="large" color="#007AFF" />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isSyncing}
              onRefresh={() => triggerSync(queryClient)}
            />
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              No gyms yet. Create one to get started.
            </Text>
          }
          renderItem={({ item: gym }) => (
            <View style={styles.gymSection}>
              <SwipeToDelete onDelete={() => handleDeleteGym(gym)}>
                <View style={styles.gymHeader}>
                  <Text style={styles.gymName}>{gym.name}</Text>
                  {gym.user_role === "admin" && (
                    <Pressable onPress={() => handleInvite(gym)}>
                      <Text style={{ color: "#007AFF", fontSize: 14, fontWeight: "600" }}>Invite</Text>
                    </Pressable>
                  )}
                </View>
              </SwipeToDelete>
              {gym.walls.map((wall) => (
                <SwipeToDelete
                  key={wall.id}
                  onDelete={() => handleDeleteWall(gym, wall.id, wall.name)}
                >
                  <Pressable
                    style={styles.wallItem}
                    onPress={() =>
                      router.push({
                        pathname: "/(app)/walls/[wallId]" as any,
                        params: { wallId: wall.id, gymSlug: gym.slug },
                      })
                    }
                  >
                    <Text style={styles.wallName}>{wall.name}</Text>
                    <Text style={styles.chevron}>{">"}</Text>
                  </Pressable>
                </SwipeToDelete>
              ))}

              {(gym.user_role === "admin" || gym.user_role === "setter") && (
                wallFormGymSlug === gym.slug ? (
                  <View style={styles.inlineForm}>
                    <TextInput
                      style={styles.input}
                      placeholder="Wall name"
                      value={wallName}
                      onChangeText={setWallName}
                      autoFocus
                      returnKeyType="go"
                      onSubmitEditing={() => {
                        if (wallName.trim() && !createWallMutation.isPending) {
                          createWallMutation.mutate({
                            gymSlug: gym.slug,
                            name: wallName.trim(),
                          });
                        }
                      }}
                    />
                    <View style={styles.formButtons}>
                      <Pressable
                        style={styles.cancelButton}
                        onPress={() => {
                          setWallFormGymSlug(null);
                          setWallName("");
                        }}
                      >
                        <Text style={styles.cancelText}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        style={[
                          styles.submitButton,
                          (!wallName.trim() ||
                            createWallMutation.isPending) &&
                            styles.buttonDisabled,
                        ]}
                        onPress={() =>
                          createWallMutation.mutate({
                            gymSlug: gym.slug,
                            name: wallName.trim(),
                          })
                        }
                        disabled={
                          !wallName.trim() || createWallMutation.isPending
                        }
                      >
                        <Text style={styles.submitText}>
                          {createWallMutation.isPending ? "Creating..." : "Add"}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    style={styles.addWallButton}
                    onPress={() => setWallFormGymSlug(gym.slug)}
                  >
                    <Text style={styles.addWallText}>+ Add Wall</Text>
                  </Pressable>
                )
              )}
            </View>
          )}
          ListFooterComponent={
            showGymForm ? (
              <View style={styles.gymForm}>
                <Text style={styles.formTitle}>New Gym</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Gym name"
                  value={gymName}
                  onChangeText={setGymName}
                  autoFocus
                  returnKeyType="next"
                  onSubmitEditing={() => gymSlugRef.current?.focus()}
                  blurOnSubmit={false}
                />
                <TextInput
                  ref={gymSlugRef}
                  style={styles.input}
                  placeholder="Slug (e.g. my-gym)"
                  value={gymSlug}
                  onChangeText={setGymSlug}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="go"
                  onSubmitEditing={() => {
                    if (gymName.trim() && gymSlug.trim() && !createGymMutation.isPending) {
                      createGymMutation.mutate({
                        name: gymName.trim(),
                        slug: gymSlug.trim(),
                      });
                    }
                  }}
                />
                <View style={styles.formButtons}>
                  <Pressable
                    style={styles.cancelButton}
                    onPress={() => {
                      setShowGymForm(false);
                      setGymName("");
                      setGymSlug("");
                    }}
                  >
                    <Text style={styles.cancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.submitButton,
                      (!gymName.trim() ||
                        !gymSlug.trim() ||
                        createGymMutation.isPending) &&
                        styles.buttonDisabled,
                    ]}
                    onPress={() =>
                      createGymMutation.mutate({
                        name: gymName.trim(),
                        slug: gymSlug.trim(),
                      })
                    }
                    disabled={
                      !gymName.trim() ||
                      !gymSlug.trim() ||
                      createGymMutation.isPending
                    }
                  >
                    <Text style={styles.submitText}>
                      {createGymMutation.isPending ? "Creating..." : "Create"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                style={styles.createGymButton}
                onPress={() => setShowGymForm(true)}
              >
                <Text style={styles.createGymText}>+ Create Gym</Text>
              </Pressable>
            )
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
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  logbookButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  logbookText: {
    color: "#007AFF",
    fontSize: 16,
    fontWeight: "600",
  },
  logoutButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  logoutText: {
    color: "#ff3b30",
    fontSize: 16,
    fontWeight: "600",
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
  gymSection: {
    marginBottom: 24,
  },
  gymHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  gymName: {
    fontSize: 18,
    fontWeight: "700",
    color: "#333",
  },
  wallItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f8f8f8",
    padding: 14,
    borderRadius: 8,
  },
  wallName: {
    fontSize: 16,
    color: "#333",
  },
  chevron: {
    fontSize: 16,
    color: "#999",
  },
  addWallButton: {
    paddingVertical: 10,
  },
  addWallText: {
    color: "#007AFF",
    fontSize: 15,
    fontWeight: "600",
  },
  inlineForm: {
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 8,
  },
  formButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  cancelText: {
    color: "#999",
    fontSize: 15,
    fontWeight: "600",
  },
  submitButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  submitText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  createGymButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  createGymText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  gymForm: {
    backgroundColor: "#f8f8f8",
    padding: 16,
    borderRadius: 8,
    marginTop: 8,
  },
  formTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 12,
  },
});
