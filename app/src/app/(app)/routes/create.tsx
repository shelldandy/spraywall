import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  SafeAreaView,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../../lib/api/fetch";
import type { Route } from "../../../lib/api/types";

export default function CreateRouteScreen() {
  const { wallId, gymSlug, holdIds } = useLocalSearchParams<{
    wallId: string;
    gymSlug: string;
    holdIds: string;
  }>();
  const queryClient = useQueryClient();

  const parsedHoldIds: string[] = holdIds ? JSON.parse(holdIds) : [];

  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [description, setDescription] = useState("");

  const createMutation = useMutation<Route, Error, { status: "draft" | "published" }>({
    mutationFn: async ({ status }) => {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/routes`, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          grade: grade.trim() || null,
          description: description.trim() || null,
          hold_ids: parsedHoldIds,
          status,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Failed to create route");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["routes", gymSlug, wallId],
      });
      router.back();
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{"< Back"}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Create Route</Text>
        <View style={{ minWidth: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.holdsBadge}>
          <Text style={styles.holdsBadgeText}>
            {parsedHoldIds.length} holds selected
          </Text>
        </View>

        <Text style={styles.label}>Name *</Text>
        <TextInput
          style={styles.input}
          placeholder="Route name"
          value={name}
          onChangeText={setName}
          autoFocus
        />

        <Text style={styles.label}>Grade</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. V4, 5.11a"
          value={grade}
          onChangeText={setGrade}
          autoCapitalize="none"
        />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Optional description"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
        />

        <View style={styles.buttonRow}>
          <Pressable
            style={[
              styles.draftButton,
              (!name.trim() || createMutation.isPending) &&
                styles.buttonDisabled,
            ]}
            onPress={() => createMutation.mutate({ status: "draft" })}
            disabled={!name.trim() || createMutation.isPending}
          >
            <Text style={styles.draftText}>Save Draft</Text>
          </Pressable>
          <Pressable
            style={[
              styles.saveButton,
              (!name.trim() || createMutation.isPending) &&
                styles.buttonDisabled,
            ]}
            onPress={() => createMutation.mutate({ status: "published" })}
            disabled={!name.trim() || createMutation.isPending}
          >
            <Text style={styles.saveText}>
              {createMutation.isPending ? "Saving..." : "Publish Route"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
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
  scrollContent: {
    padding: 16,
  },
  holdsBadge: {
    backgroundColor: "#34c759",
    alignSelf: "flex-start",
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 20,
  },
  holdsBadgeText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  textArea: {
    height: 80,
    textAlignVertical: "top",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  draftButton: {
    flex: 1,
    backgroundColor: "#f8f8f8",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#ccc",
  },
  draftText: {
    color: "#666",
    fontSize: 16,
    fontWeight: "600",
  },
  saveButton: {
    flex: 1,
    backgroundColor: "#007AFF",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  saveText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
