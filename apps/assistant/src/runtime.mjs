import { COMPONENT_RUNTIME_SCHEMA } from "./sdk/contracts/component-runtime.mjs";
import appManifest from "../app.json" with { type: "json" };
const ASSISTANT_VERSION = appManifest.version;
import { createAssistantConversationRuntime } from "./conversation.mjs";
import {
  ASSISTANT_CONVERSATION_EXTENSION,
  ASSISTANT_CONVERSATION_EXTENSION_SELECTOR,
  mountAssistantConversationControls,
} from "./ui/conversation-controls.mjs";

const ASSISTANT_STYLESHEET_URL = new URL("../assets/assistant.css", import.meta.url).href;
const ASSISTANT_STYLE_SELECTOR = 'link[data-ordax-component-style="assistant"]';

async function mountAssistantStyles(root) {
  const documentObject = root?.ownerDocument;
  if (!documentObject?.head) {
    throw new TypeError("Assistant runtime requires a document head for component styles");
  }
  const existing = documentObject.querySelector(ASSISTANT_STYLE_SELECTOR);
  if (existing) {
    if (existing.href !== ASSISTANT_STYLESHEET_URL) {
      throw new TypeError("Assistant component stylesheet identity mismatch");
    }
    return () => {};
  }
  const link = documentObject.createElement("link");
  link.rel = "stylesheet";
  link.href = ASSISTANT_STYLESHEET_URL;
  link.dataset.ordaxComponentStyle = "assistant";
  const loaded = new Promise((resolve, reject) => {
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener(
      "error",
      () => reject(new Error("Assistant component stylesheet failed to load")),
      { once: true },
    );
  });
  documentObject.head.append(link);
  try {
    await loaded;
  } catch (error) {
    link.remove();
    throw error;
  }
  return () => link.remove();
}

// The isolated Native component iframe provides an empty root. The product
// owns its extension slot, while legacy/embed hosts may provide it themselves.
// Never make the OS know an app-specific DOM selector or create a second UI.
function ensureConversationExtensionSlot(root) {
  if (!(root instanceof Element)) {
    throw new TypeError("Assistant runtime requires a DOM Element root");
  }
  if (root.querySelector(ASSISTANT_CONVERSATION_EXTENSION_SELECTOR)) {
    return () => {};
  }
  const slot = root.ownerDocument.createElement("section");
  slot.dataset.appExtension = ASSISTANT_CONVERSATION_EXTENSION;
  root.append(slot);
  return () => slot.remove();
}

export const componentRuntime = Object.freeze({
  schema: COMPONENT_RUNTIME_SCHEMA,
  componentId: "assistant",
  version: ASSISTANT_VERSION,
  async mount({
    root,
    surfaceLifecycle,
    intelligence = null,
    memoryCapture = null,
    personalOrdax = null,
    identitySessionPort,
    spaceSelectionPort,
    profileActivationStatePort = null,
    appActivation = null,
    projectWorkCanvas = null,
  } = {}) {
    const releaseStyles = await mountAssistantStyles(root);
    let releaseExtensionSlot = () => {};
    let conversation = null;
    let controls = null;
    const cleanup = () => {
      try {
        controls?.destroy();
      } finally {
        try {
          conversation?.dispose();
        } finally {
          releaseExtensionSlot();
          releaseStyles();
        }
      }
    };
    try {
      releaseExtensionSlot = ensureConversationExtensionSlot(root);
      conversation = createAssistantConversationRuntime({
        intelligencePort: intelligence,
        memoryCapture,
        identitySessionPort,
        spaceSelectionPort,
        profileActivationStatePort,
      });
      controls = mountAssistantConversationControls(root, conversation, surfaceLifecycle, {
        personalOrdax,
        identitySessionPort,
        spaceSelectionPort,
        appActivation,
        projectWorkCanvas,
      });
      let destroyed = false;
      return Object.freeze({
        destroy() {
          if (destroyed) return;
          destroyed = true;
          cleanup();
        },
      });
    } catch (error) {
      cleanup();
      throw error;
    }
  },
});
