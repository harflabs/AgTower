import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_DMG_CONFIG = {
  appPosition: { x: 180, y: 170 },
  applicationFolderPosition: { x: 480, y: 170 },
  windowSize: { width: 660, height: 400 },
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const tauriDir = resolve(repoRoot, "src-tauri");
const tauriConfig = JSON.parse(
  readFileSync(resolve(tauriDir, "tauri.conf.json"), "utf8"),
);

const productName = tauriConfig.productName;
const installerName = `${productName} Installer`;
const bundleDir = resolve(tauriDir, "target/release/bundle");
const dmgDir = resolve(bundleDir, "dmg");
const appPath = resolve(bundleDir, "macos", `${productName}.app`);
const bundleScriptPath = resolve(dmgDir, "bundle_dmg.sh");
const volumeIconPath = resolve(dmgDir, "icon.icns");
const macConfig = tauriConfig.bundle?.macOS ?? {};
const dmgConfig = {
  ...DEFAULT_DMG_CONFIG,
  ...macConfig.dmg,
};

if (!existsSync(appPath)) {
  throw new Error(`App bundle not found at ${appPath}`);
}

if (!existsSync(bundleScriptPath)) {
  throw new Error(`DMG bundler script not found at ${bundleScriptPath}`);
}

const sourceDmgName = readdirSync(dmgDir)
  .filter((name) => name.endsWith(".dmg") && name.startsWith(`${productName}_`))
  .map((name) => ({
    name,
    path: resolve(dmgDir, name),
  }))
  .sort((left, right) => {
    const leftMtime = statSync(left.path).mtimeMs;
    const rightMtime = statSync(right.path).mtimeMs;
    return rightMtime - leftMtime;
  })[0]?.name;

if (!sourceDmgName) {
  throw new Error(`No generated DMG matching ${productName}_*.dmg was found in ${dmgDir}`);
}

const outputDmgName = sourceDmgName.replace(`${productName}_`, `${installerName}_`);
const sourceDmgPath = resolve(dmgDir, sourceDmgName);
const outputDmgPath = resolve(dmgDir, outputDmgName);
const stagedRoot = mkdtempSync(join(dmgDir, "installer-stage-"));
const stagedAppPath = resolve(stagedRoot, `${productName}.app`);

if (existsSync(outputDmgPath)) {
  unlinkSync(outputDmgPath);
}

try {
  execFileSync("ditto", [appPath, stagedAppPath], { stdio: "inherit" });

  const args = ["--volname", installerName];

  if (existsSync(volumeIconPath)) {
    args.push("--volicon", volumeIconPath);
  }

  if (dmgConfig.background) {
    args.push("--background", resolve(tauriDir, dmgConfig.background));
  }

  if (dmgConfig.windowPosition) {
    args.push(
      "--window-pos",
      String(dmgConfig.windowPosition.x),
      String(dmgConfig.windowPosition.y),
    );
  }

  args.push(
    "--window-size",
    String(dmgConfig.windowSize.width),
    String(dmgConfig.windowSize.height),
    "--icon",
    `${productName}.app`,
    String(dmgConfig.appPosition.x),
    String(dmgConfig.appPosition.y),
    "--hide-extension",
    `${productName}.app`,
    "--app-drop-link",
    String(dmgConfig.applicationFolderPosition.x),
    String(dmgConfig.applicationFolderPosition.y),
  );

  const signingIdentity = process.env.APPLE_SIGNING_IDENTITY;
  if (signingIdentity && signingIdentity !== "-") {
    args.push("--codesign", signingIdentity);
  }

  args.push(outputDmgPath, stagedRoot);

  execFileSync(bundleScriptPath, args, {
    cwd: dmgDir,
    stdio: "inherit",
  });

  unlinkSync(sourceDmgPath);
  console.log(`Created ${outputDmgPath}`);
} finally {
  rmSync(stagedRoot, { force: true, recursive: true });
}
