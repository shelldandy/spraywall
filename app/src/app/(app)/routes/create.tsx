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
import GradePicker from "../../../components/GradePicker";
import { formatGrade } from "../../../lib/grades";

export default function CreateRouteScreen() {
  const { wallId, gymSlug, holdIds } = useLocalSearchParams<{
    wallId: string;
    gymSlug: string;
    holdIds: string;
  }>();
  const queryClient = useQueryClient();

  const parsedHoldIds: string[] = holdIds ? JSON.parse(holdIds) : [];

  const [name, setName] = useState("");
  const [gradeId, setGradeId] = useState<number | null>(null);
  const [description, setDescription] = useState("");

  const createMutation = useMutation<Route, Error>({
    mutationFn: async () => {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/routes`, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          grade: gradeId !== null ? formatGrade(gradeId, "v") : null,
          description: description.trim() || null,
          hold_ids: parsedHoldIds,
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
        <GradePicker selectedGradeId={gradeId} onSelect={setGradeId} />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Optional description"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
        />

        <Pressable
          style={[
            styles.saveButton,
            (!name.trim() || createMutation.isPending) &&
              styles.buttonDisabled,
          ]}
          onPress={() => createMutation.mutate()}
          disabled={!name.trim() || createMutation.isPending}
        >
          <Text style={styles.saveText}>
            {createMutation.isPending ? "Saving..." : "Save Route"}
          </Text>
        </Pressable>
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
  saveButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
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
