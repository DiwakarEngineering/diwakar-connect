import { Alert } from "react-native";
import { router } from "expo-router";
import { friendlyError, supabase } from "./supabase";

/** Opens the direct chat with a colleague (reusing it if it already exists). */
export async function openDirectChat(otherUserId: string) {
  const { data, error } = await supabase.rpc("get_or_create_direct_conversation", { p_other_user: otherUserId });
  if (error || !data) {
    Alert.alert("Couldn't open the chat", friendlyError(error));
    return;
  }
  router.push({ pathname: "/chat/[id]", params: { id: data } });
}
