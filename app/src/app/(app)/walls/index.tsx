import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useServerStore } from "../../../lib/store/server";

interface UserInfo {
  id: string;
  email: string;
  display_name: string;
  role: string;
  created_at: string;
}

export default function WallsScreen() {
  const router = useRouter();
  const { serverUrl, accessToken, clearTokens } = useServerStore();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await fetch(`${serverUrl}/auth/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!res.ok) {
          setError(`Failed to load user (${res.status}).`);
          return;
        }

        const data = await res.json();
        setUser(data);
      } catch {
        setError("Could not reach the server.");
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, [serverUrl, accessToken]);

  const handleLogout = () => {
    clearTokens();
    router.replace("/login" as any);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Walls</Text>

      {loading && <ActivityIndicator size="large" color="#007AFF" />}

      {error && <Text style={styles.error}>{error}</Text>}

      {user && (
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{user.display_name}</Text>
          <Text style={styles.userEmail}>{user.email}</Text>
          <Text style={styles.userRole}>Role: {user.role}</Text>
        </View>
      )}

      <Pressable style={styles.button} onPress={handleLogout}>
        <Text style={styles.buttonText}>Log Out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    marginBottom: 24,
  },
  userInfo: {
    alignItems: "center",
    marginBottom: 32,
  },
  userName: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 16,
    color: "#666",
    marginBottom: 4,
  },
  userRole: {
    fontSize: 14,
    color: "#999",
  },
  error: {
    color: "#ff3b30",
    fontSize: 14,
    marginBottom: 16,
    textAlign: "center",
  },
  button: {
    backgroundColor: "#ff3b30",
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
