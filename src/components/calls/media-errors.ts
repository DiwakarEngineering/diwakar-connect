import { MediaDeviceFailure } from "livekit-client";

/** Human explanation for getUserMedia / getDisplayMedia failures. */
export function describeMediaError(error: unknown, what = "camera or microphone"): string {
  const failure = MediaDeviceFailure.getFailure(error);
  switch (failure) {
    case MediaDeviceFailure.PermissionDenied:
      return `Access to your ${what} is blocked. Allow it in your browser's site settings, then try again.`;
    case MediaDeviceFailure.NotFound:
      return `No ${what} was found. Check that it's connected.`;
    case MediaDeviceFailure.DeviceInUse:
      return `Your ${what} is being used by another app. Close it and try again.`;
    default:
      if (error instanceof Error && error.name === "NotAllowedError") return `You declined access to your ${what}.`;
      return `Couldn't start your ${what}.`;
  }
}

export const supportsScreenShare = () =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices && "getDisplayMedia" in navigator.mediaDevices;

export const supportsOutputSelection = () =>
  typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
