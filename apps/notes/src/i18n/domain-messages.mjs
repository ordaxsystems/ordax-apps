export const NOTES_DOMAIN_COPY = Object.freeze({
  "pt-BR": Object.freeze({
    duplicateSuffix: " — cópia",
    newTaskText: "Novo item",
    referenceFallback: "Referência",
  }),
  "en-US": Object.freeze({
    duplicateSuffix: " — copy",
    newTaskText: "New item",
    referenceFallback: "Reference",
  }),
});

export function notesDomainCopyForLocale(locale) {
  return NOTES_DOMAIN_COPY[locale === "en-US" ? "en-US" : "pt-BR"];
}
