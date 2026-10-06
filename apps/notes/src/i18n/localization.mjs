import {
  LOCALIZATION_SCHEMA,
  assertLocalizationPort,
  assertSurfaceRenderLifecycle,
} from "../sdk/public-contracts.mjs";
import { NOTES_ENGLISH_MESSAGES, NOTES_SOURCE_MESSAGES } from "./messages.mjs";
import { notesDomainCopyForLocale } from "./domain-messages.mjs";

function interpolate(template, params) {
  if (!params || typeof params !== "object") return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
  ));
}

function catalogFor(locale) {
  return locale === "en-US" ? NOTES_ENGLISH_MESSAGES : NOTES_SOURCE_MESSAGES;
}

export function createNotesLocalization(hostValue) {
  const host = assertLocalizationPort(hostValue);
  const port = {
    schema: LOCALIZATION_SCHEMA,
    getLocale: () => host.getLocale(),
    getProfile: () => host.getProfile(),
    translate(key, params = null) {
      const catalog = catalogFor(host.getLocale());
      if (Object.prototype.hasOwnProperty.call(catalog, key)) {
        return interpolate(catalog[key], params);
      }
      return host.translate(key, params);
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Notes localization listener must be a function");
      }
      return host.subscribe(listener);
    },
  };
  return Object.freeze(port);
}

export function createNotesDomainCopy(localizationValue) {
  const localization = assertLocalizationPort(localizationValue);
  const supplemental = notesDomainCopyForLocale(localization.getLocale());
  return Object.freeze({
    homeProjectName: localization.translate("notes.home"),
    untitledNoteTitle: localization.translate("notes.note.untitled"),
    duplicateSuffix: supplemental.duplicateSuffix,
    newTaskText: supplemental.newTaskText,
    referenceFallback: supplemental.referenceFallback,
  });
}

export function createNotesSurfaceLifecycle(hostLifecycleValue, localizationValue) {
  const host = assertSurfaceRenderLifecycle(hostLifecycleValue);
  const localization = assertLocalizationPort(localizationValue);
  return Object.freeze({
    schema: host.schema,
    localization,
    subscribeRender: host.subscribeRender.bind(host),
    getAppTarget: host.getAppTarget.bind(host),
    setAppTarget: host.setAppTarget.bind(host),
  });
}
