import { Redirect, useLocalSearchParams } from "expo-router";

/** Meeting links (https://…/meet/<ID> or diwakarconnect://meet/<ID>) open the join screen with the ID filled in. */
export default function MeetLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <Redirect href={{ pathname: "/join-meeting", params: { code: code ?? "" } }} />;
}
