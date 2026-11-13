import type { MetadataRoute } from "next";

/** Web app manifest: makes the site installable and is the basis of the Android (Play Store) app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Diwakar Connect",
    short_name: "Diwakar Connect",
    description: "Chat, teams and calls for Diwakar Solar employees.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FFFFFF",
    theme_color: "#F06A1A",
    categories: ["business", "communication", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
