import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
  SafeAreaView,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useServerStore } from "../../../lib/store/server";
import { apiFetch } from "../../../lib/api/fetch";
import type { Gym, Wall } from "../../../lib/api/types";

interface GymWithWalls extends Gym {
  walls: Wall[];
}

export default function WallsScreen() {
  const queryClient = useQueryClient();
  const { clearTokens } = useServerStore();

  const [showGymForm, setShowGymForm] = useState(false);
  const [gymName, setGymName] = useState("");
  const [gymSlug, setGymSlug] = useState("");

  const [wallFormGymSlug, setWallFormGymSlug] = useState<string | null>(null);
  const [wallName, setWallName] = useState("");

  const gymsQuery = useQuery<Gym[]>({
    queryKey: ["gyms"],
    queryFn: async () => {
      const res = await apiFetch("/gyms");
      if (!res.ok) throw new Error("Failed to fetch gyms");
      return res.json();
    },
    refetchInterval: 10000,
  });

  const wallsQueries = useQuery<GymWithWalls[]>({
    queryKey: ["gyms-with-walls", gymsQuery.data],
    queryFn: async () => {
      const gyms = gymsQuery.data;
      if (!gyms) return [];
      const results = await Promise.all(
        gyms.map(async (gym) => {
          const res = await apiFetch(`/gyms/${gym.slug}/walls`);
          const walls: Wall[] = res.ok ? await res.json() : [];
          return { ...gym, walls };
        })
      );
      return results;
    },
    enabled: !!gymsQuery.data,
    refetchInterval: 10000,
  });

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gyms"] });
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
    onSuccess: () => {
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

  const data = wallsQueries.data ?? [];

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
          <Pressable onPress={handleLogout} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Logout</Text>
          </Pressable>
        </View>
      </View>

      {gymsQuery.isLoading ? (
        <ActivityIndicator style={styles.loader} size="large" color="#007AFF" />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              No gyms yet. Create one to get started.
            </Text>
          }
          renderItem={({ item: gym }) => (
            <View style={styles.gymSection}>
              <Text style={styles.gymName}>{gym.name}</Text>
              {gym.walls.map((wall) => (
                <Pressable
                  key={wall.id}
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
              ))}

              {wallFormGymSlug === gym.slug ? (
                <View style={styles.inlineForm}>
                  <TextInput
                    style={styles.input}
                    placeholder="Wall name"
                    value={wallName}
                    onChangeText={setWallName}
                    autoFocus
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
                />
                <TextInput
                  style={styles.input}
                  placeholder="Slug (e.g. my-gym)"
                  value={gymSlug}
                  onChangeText={setGymSlug}
                  autoCapitalize="none"
                  autoCorrect={false}
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
  gymName: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
    color: "#333",
  },
  wallItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f8f8f8",
    padding: 14,
    borderRadius: 8,
    marginBottom: 6,
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
