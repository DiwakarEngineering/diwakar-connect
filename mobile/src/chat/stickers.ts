// Same sticker ids and labels as the website (src/components/conversation/stickers.tsx).
import { CircleCheckBig, Coffee, Handshake, HardHat, Heart, PartyPopper, Rocket, Sun, ThumbsUp, Trophy, Zap, type LucideIcon } from "lucide-react-native";

export const STICKERS: { id: string; label: string; icon: LucideIcon; bg: string; fg: string }[] = [
  { id: "thumbs-up", label: "Thumbs up", icon: ThumbsUp, bg: "#C84C0A", fg: "#FFFFFF" },
  { id: "thank-you", label: "Thank you", icon: Heart, bg: "#C84C0A", fg: "#FFFFFF" },
  { id: "great-work", label: "Great work", icon: Trophy, bg: "#F6B83A", fg: "#151C2C" },
  { id: "done", label: "Done", icon: CircleCheckBig, bg: "#15803D", fg: "#FFFFFF" },
  { id: "on-site", label: "On site", icon: HardHat, bg: "#F6B83A", fg: "#151C2C" },
  { id: "solar-power", label: "Solar power", icon: Sun, bg: "#C84C0A", fg: "#FFFFFF" },
  { id: "charged-up", label: "Charged up", icon: Zap, bg: "#F6B83A", fg: "#151C2C" },
  { id: "celebrate", label: "Celebrate", icon: PartyPopper, bg: "#C84C0A", fg: "#FFFFFF" },
  { id: "lets-go", label: "Let's go", icon: Rocket, bg: "#27335A", fg: "#FFFFFF" },
  { id: "deal", label: "Deal", icon: Handshake, bg: "#27335A", fg: "#FFFFFF" },
  { id: "coffee-break", label: "Coffee break", icon: Coffee, bg: "#27335A", fg: "#FFFFFF" },
];
