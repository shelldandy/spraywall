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
import { formatGrade, gradeIdFromV } from "../../../lib/grades";

export default function CreateRouteScreen() {
  const { wallId, gymSlug, holdIds, holdRoles, routeId, initialName, initialGrade, initialDescription } =
    useLocalSearchParams<{
      wallId: string;
      gymSlug: string;
      holdIds: string;
      holdRoles: string;
      routeId: string;
      initialName: string;
      initialGrade: string;
      initialDescription: string;
    }>();
  const queryClient = useQueryClient();

  const isEditing = !!routeId;
  const parsedHoldIds: string[] = holdIds ? JSON.parse(holdIds) : [];
  const parsedHoldRoles = holdRoles ? JSON.parse(holdRoles) : null;

  const [name, setName] = useState(initialName ?? "");
  const [gradeId, setGradeId] = useState<number | null>(
    initialGrade ? gradeIdFromV(initialGrade) : null,
  );
  const [description, setDescription] = useState(initialDescription ?? "");

  const saveMutation = useMutation<Route, Error, { status: "draft" | "published" }>({
    mutationFn: async ({ status }) => {
      const url = isEditing
        ? `/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}`
        : `/gyms/${gymSlug}/walls/${wallId}/routes`;
      const res = await apiFetch(url, {
        method: isEditing ? "PUT" : "POST",
        body: JSON.stringify({
          name: name.trim(),
          grade: gradeId !== null ? formatGrade(gradeId, "v") : null,
          description: description.trim() || null,
          hold_ids: parsedHoldIds,
          hold_roles: parsedHoldRoles,
          status,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || `Failed to ${isEditing ? "update" : "create"} route`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["routes", gymSlug, wallId],
      });
      if (isEditing) {
        queryClient.invalidateQueries({
          queryKey: ["route-detail", gymSlug, wallId, routeId],
        });
        // Go back to route detail, skipping the wall edit screen
        router.replace({
          pathname: "/(app)/routes/[routeId]" as any,
          params: { routeId, wallId, gymSlug },
        });
      } else {
        router.back();
      }
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{"< Back"}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>
          {isEditing ? "Edit Route" : "Create Route"}
        </Text>
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
          placeholderTextColor="#999"
          value={name}
          onChangeText={setName}
          autoFocus={!isEditing}
          returnKeyType="done"
        />

        <Text style={styles.label}>Grade</Text>
        <GradePicker selectedGradeId={gradeId} onSelect={setGradeId} />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Optional description"
          placeholderTextColor="#999"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
        />

        <View style={styles.buttonRow}>
          <Pressable
            style={[
              styles.draftButton,
              (!name.trim() || saveMutation.isPending) &&
                styles.buttonDisabled,
            ]}
            onPress={() => saveMutation.mutate({ status: "draft" })}
            disabled={!name.trim() || saveMutation.isPending}
          >
            <Text style={styles.draftText}>Save Draft</Text>
          </Pressable>
          <Pressable
            style={[
              styles.saveButton,
              (!name.trim() || saveMutation.isPending) &&
                styles.buttonDisabled,
            ]}
            onPress={() => saveMutation.mutate({ status: "published" })}
            disabled={!name.trim() || saveMutation.isPending}
          >
            <Text style={styles.saveText}>
              {saveMutation.isPending ? "Saving..." : "Publish Route"}
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
