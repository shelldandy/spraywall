import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";

const DELETE_BUTTON_WIDTH = 80;

interface SwipeToDeleteProps {
  onDelete: () => void;
  children: React.ReactNode;
}

export default function SwipeToDelete({
  onDelete,
  children,
}: SwipeToDeleteProps) {
  const translateX = useSharedValue(0);

  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-5, 5])
    .onUpdate((e) => {
      // Only allow swiping left, clamp to button width
      translateX.value = Math.max(
        -DELETE_BUTTON_WIDTH,
        Math.min(0, e.translationX + (translateX.value < 0 ? -DELETE_BUTTON_WIDTH : 0)),
      );
    })
    .onEnd(() => {
      // Snap open if swiped past halfway, otherwise snap closed
      if (translateX.value < -DELETE_BUTTON_WIDTH / 2) {
        translateX.value = withTiming(-DELETE_BUTTON_WIDTH);
      } else {
        translateX.value = withTiming(0);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const handleDelete = () => {
    translateX.value = withTiming(0);
    onDelete();
  };

  return (
    <GestureHandlerRootView style={styles.container}>
      <Pressable style={styles.deleteButton} onPress={handleDelete}>
        <Text style={styles.deleteText}>Delete</Text>
      </Pressable>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.content, animatedStyle]}>
          {children}
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    borderRadius: 8,
    marginBottom: 6,
  },
  deleteButton: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: DELETE_BUTTON_WIDTH,
    backgroundColor: "#ff3b30",
    justifyContent: "center",
    alignItems: "center",
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  deleteText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  content: {
    backgroundColor: "#fff",
  },
});
