import { validateAppIntelligenceManifest } from "../src/sdk/contracts/app-intelligence-manifest.mjs";
import appManifest from "../app.json" with { type: "json" };
import aiManifest from "./manifest.json" with { type: "json" };
export const activityIntelligenceManifest = validateAppIntelligenceManifest(aiManifest, { appId: appManifest.id, appVersion: appManifest.version });
