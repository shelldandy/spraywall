import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  FlatList,
  StyleSheet,
} from "react-native";
import { grades, gradeSystems, type Grade, type GradeSystem } from "../lib/grades";

interface GradePickerProps {
  selectedGradeId: number | null;
  onSelect: (gradeId: number | null) => void;
  system?: GradeSystem;
}

export default function GradePicker({
  selectedGradeId,
  onSelect,
  system = "v",
}: GradePickerProps) {
  const [visible, setVisible] = useState(false);
  const [activeSystem, setActiveSystem] = useState<GradeSystem>(system);

  const selected = selectedGradeId !== null
    ? grades.find((g) => g.id === selectedGradeId)
    : null;

  const displayLabel = selected ? selected[activeSystem] : "Select grade";

  return (
    <>
      <Pressable style={styles.trigger} onPress={() => setVisible(true)}>
        <Text style={[styles.triggerText, !selected && styles.placeholder]}>
          {displayLabel}
        </Text>
      </Pressable>

      <Modal visible={visible} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Select Grade</Text>
              <Pressable onPress={() => setVisible(false)}>
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            </View>

            <View style={styles.systemTabs}>
              {gradeSystems.map((gs) => (
                <Pressable
                  key={gs.value}
                  style={[
                    styles.systemTab,
                    activeSystem === gs.value && styles.systemTabActive,
                  ]}
                  onPress={() => setActiveSystem(gs.value)}
                >
                  <Text
                    style={[
                      styles.systemTabText,
                      activeSystem === gs.value && styles.systemTabTextActive,
                    ]}
                  >
                    {gs.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              style={styles.clearButton}
              onPress={() => {
                onSelect(null);
                setVisible(false);
              }}
            >
              <Text style={styles.clearText}>No grade</Text>
            </Pressable>

            <FlatList
              data={grades}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => (
                <Pressable
                  style={[
                    styles.gradeRow,
                    selectedGradeId === item.id && styles.gradeRowSelected,
                  ]}
                  onPress={() => {
                    onSelect(item.id);
                    setVisible(false);
                  }}
                >
                  <Text style={styles.gradeText}>{item[activeSystem]}</Text>
                  <Text style={styles.gradeSubText}>
                    {activeSystem === "v" ? item.font : item.v}
                  </Text>
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  triggerText: {
    fontSize: 16,
    color: "#333",
  },
  placeholder: {
    color: "#999",
  },
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "70%",
    paddingBottom: 20,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: "bold",
  },
  doneText: {
    fontSize: 16,
    color: "#007AFF",
    fontWeight: "600",
  },
  systemTabs: {
    flexDirection: "row",
    padding: 12,
    gap: 8,
  },
  systemTab: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: "#f0f0f0",
  },
  systemTabActive: {
    backgroundColor: "#007AFF",
  },
  systemTabText: {
    fontSize: 14,
    color: "#666",
  },
  systemTabTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  clearButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  clearText: {
    fontSize: 16,
    color: "#999",
  },
  gradeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eee",
  },
  gradeRowSelected: {
    backgroundColor: "#e8f4ff",
  },
  gradeText: {
    fontSize: 16,
    fontWeight: "500",
  },
  gradeSubText: {
    fontSize: 14,
    color: "#999",
  },
});
