import { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { apiFetch } from "../../../lib/api/fetch";

interface InviteInfo {
  gym_name: string;
  gym_slug: string;
  role: string;
  expires_at: string;
}

export default function InviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchInvite = async () => {
      try {
        const res = await apiFetch(`/invites/${token}`);
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Invite not found or expired");
          return;
        }
        const data: InviteInfo = await res.json();
        setInvite(data);
      } catch {
        setError("Failed to load invite");
      } finally {
        setLoading(false);
      }
    };

    fetchInvite();
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;
    setAccepting(true);
    setError(null);

    try {
      const res = await apiFetch(`/invites/${token}/accept`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        if (res.status === 409) {
          Alert.alert("Already a member", "You are already a member of this gym.");
        } else {
          setError(data.error || "Failed to accept invite");
        }
        return;
      }

      Alert.alert("Joined!", `You have joined ${invite?.gym_name}.`, [
        {
          text: "OK",
          onPress: () => router.replace("/(app)/walls" as any),
        },
      ]);
    } catch {
      setError("Failed to accept invite");
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading invite...</Text>
      </View>
    );
  }

  if (error && !invite) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable
          style={styles.button}
          onPress={() => router.replace("/(app)/walls" as any)}
        >
          <Text style={styles.buttonText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  if (!invite) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>You've been invited!</Text>

      <View style={styles.card}>
        <Text style={styles.gymName}>{invite.gym_name}</Text>
        <Text style={styles.roleLabel}>
          Role: <Text style={styles.roleValue}>{invite.role}</Text>
        </Text>
        <Text style={styles.expiry}>
          Expires: {new Date(invite.expires_at).toLocaleDateString()}
        </Text>
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <Pressable
        style={[styles.button, accepting && styles.buttonDisabled]}
        onPress={handleAccept}
        disabled={accepting}
      >
        {accepting ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.buttonText}>Join Gym</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: "#fff",
    justifyContent: "center",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 24,
  },
  card: {
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    padding: 24,
    marginBottom: 32,
    alignItems: "center",
  },
  gymName: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
  },
  roleLabel: {
    fontSize: 16,
    color: "#666",
    marginBottom: 4,
  },
  roleValue: {
    fontWeight: "600",
    color: "#333",
  },
  expiry: {
    fontSize: 14,
    color: "#999",
    marginTop: 4,
  },
  button: {
    backgroundColor: "#007AFF",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#666",
  },
  errorText: {
    fontSize: 16,
    color: "#d00",
    textAlign: "center",
    marginBottom: 16,
  },
});
