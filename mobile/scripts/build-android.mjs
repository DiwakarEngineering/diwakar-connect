// Builds the signed Android app (Play Store .aab + installable .apk) on this machine.
//
//   ANDROID_HOME=/path/to/android-sdk \
//   ANDROID_KEYSTORE=/path/to/signing.keystore ANDROID_KEY_ALIAS=diwakar-connect \
//   ANDROID_KEYSTORE_PASSWORD=... ANDROID_KEY_PASSWORD=... \
//   npm run build:android
//
// Needs JDK 17 and the Android SDK. Use the SAME keystore for every release
// (Play Store updates must be signed with the upload key). Outputs go to dist-android/.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const need = ["ANDROID_HOME", "ANDROID_KEYSTORE", "ANDROID_KEY_ALIAS", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_PASSWORD"];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Set ${missing.join(", ")} first (see the comment at the top of this file).`);
  process.exit(1);
}
if (!existsSync(process.env.ANDROID_KEYSTORE)) {
  console.error(`Keystore not found: ${process.env.ANDROID_KEYSTORE}`);
  process.exit(1);
}

const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, CI: "1" } });

// 1. Generate android/ from app.json (Continuous Native Generation).
run("npx", ["expo", "prebuild", "--platform", "android", "--no-install"]);

// 2. Compile, bundle the JavaScript and sign (signing values are passed in, never written to disk).
const signing = [
  `-Pandroid.injected.signing.store.file=${process.env.ANDROID_KEYSTORE}`,
  `-Pandroid.injected.signing.store.password=${process.env.ANDROID_KEYSTORE_PASSWORD}`,
  `-Pandroid.injected.signing.key.alias=${process.env.ANDROID_KEY_ALIAS}`,
  `-Pandroid.injected.signing.key.password=${process.env.ANDROID_KEY_PASSWORD}`,
];
run(
  "./gradlew",
  [
    "bundleRelease",
    "assembleRelease",
    // Phones (32- and 64-bit ARM); add x86_64 for emulators/Chromebooks if needed.
    "-PreactNativeArchitectures=arm64-v8a,armeabi-v7a",
    "--no-daemon",
    "-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g",
    // Be gentle with Maven Central (it rate-limits busy/shared networks) and retry transient errors.
    "-Dorg.gradle.internal.repository.max.tentatives=8",
    "-Dorg.gradle.internal.repository.initial.backoff=3000",
    ...signing,
  ],
  join(root, "android"),
);

// 3. Collect the outputs.
const out = join(root, "dist-android");
mkdirSync(out, { recursive: true });
const version = JSON.parse(execFileSync("node", ["-p", "JSON.stringify(require('./app.json').expo)"], { cwd: root })).version;
copyFileSync(join(root, "android/app/build/outputs/bundle/release/app-release.aab"), join(out, `diwakar-connect-${version}.aab`));
copyFileSync(join(root, "android/app/build/outputs/apk/release/app-release.apk"), join(out, `diwakar-connect-${version}.apk`));
console.log(`\nDone: dist-android/diwakar-connect-${version}.aab and .apk`);
