from pathlib import Path
import unittest

APP_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = APP_ROOT / "src" / "ui" / "workspace-controls.mjs"
PICKER = APP_ROOT / "src" / "ui" / "file-picker.mjs"
LIST_MODEL = APP_ROOT / "src" / "ui" / "list-model.mjs"
CATALOG = APP_ROOT / "src" / "i18n" / "messages.mjs"


class NotesDeepLocalizationTests(unittest.TestCase):
    def test_deep_notes_ui_has_no_pt_br_user_copy(self):
        workspace = WORKSPACE.read_text(encoding="utf-8")
        for marker in (
            't("notes.note.open"',
            't("notes.image.previewFailed")',
            't("notes.task.markDone"',
            't("notes.filePicker.loading")',
            't("notes.references.relatedFiles")',
            't("notes.statistics.summary"',
            't("notes.prompt.newProjectName")',
            't("notes.confirm.deleteForever"',
            't("notes.action.importText")',
            't("notes.filePicker.title.importText")',
            't("notes.import.failed")',
            'intelligenceErrorMessageId = "notes.intelligence.failed"',
        ):
            self.assertIn(marker, workspace)

        for hardcoded in (
            '"Não foi possível salvar esta edição"',
            '"Carregando imagem…"',
            '"Fechar seletor de arquivos"',
            '"Nenhuma referência adicionada."',
            '"Nome do novo projeto:"',
            '"Use um endereço da web válido."',
            '"Excluir permanentemente a nota da lixeira? Esta ação não pode ser desfeita."',
            '"Importar arquivo de texto"',
            '"Não foi possível importar este arquivo como nota."',
        ):
            self.assertNotIn(hardcoded, workspace)

    def test_file_picker_state_stores_message_identity_not_translated_copy(self):
        picker = PICKER.read_text(encoding="utf-8")
        self.assertIn("errorMessageId", picker)
        self.assertIn('"notes.filePicker.openFailed"', picker)
        self.assertNotIn('"Não foi possível abrir esta pasta."', picker)
        self.assertNotIn("error:", picker)

    def test_list_presentation_accepts_active_locale(self):
        model = LIST_MODEL.read_text(encoding="utf-8")
        workspace = WORKSPACE.read_text(encoding="utf-8")
        self.assertIn('locale = "pt-BR"', model)
        self.assertIn("new Intl.DateTimeFormat(locale", model)
        self.assertIn("nowLabel", model)
        self.assertIn("yesterdayLabel", model)
        self.assertIn("localization.getLocale()", workspace)
        self.assertIn('t("notes.time.now")', workspace)
        self.assertIn('t("notes.time.yesterday")', workspace)

    def test_new_file_references_do_not_persist_localized_system_labels(self):
        workspace = WORKSPACE.read_text(encoding="utf-8")
        attach = workspace.split('action === "attach-file-reference"', 1)[1].split(
            'action === "open-file-reference"', 1
        )[0]
        self.assertIn('detail: ""', attach)
        self.assertNotIn('"Imagem local"', attach)
        self.assertNotIn('"Arquivo local"', attach)

    def test_catalog_has_pt_br_and_en_us_deep_notes_messages(self):
        catalog = CATALOG.read_text(encoding="utf-8")
        pairs = (
            ('"notes.filePicker.openFailed": "Não foi possível abrir esta pasta."', '"notes.filePicker.openFailed": "This folder could not be opened."'),
            ('"notes.time.yesterday": "Ontem"', '"notes.time.yesterday": "Yesterday"'),
            ('"notes.references.relatedFiles": "Arquivos relacionados"', '"notes.references.relatedFiles": "Related files"'),
            ('"notes.prompt.newProjectName": "Nome do novo projeto:"', '"notes.prompt.newProjectName": "New project name:"'),
            ('"notes.intelligence.failed": "Não foi possível resumir esta nota localmente."', '"notes.intelligence.failed": "This note could not be summarized locally."'),
            ('"notes.action.importText": "Importar arquivo de texto"', '"notes.action.importText": "Import text file"'),
            ('"notes.filePicker.title.importText": "Importar arquivo de texto"', '"notes.filePicker.title.importText": "Import text file"'),
            ('"notes.import.failed": "Não foi possível importar este arquivo como nota."', '"notes.import.failed": "This file could not be imported as a note."'),
        )
        for source, english in pairs:
            self.assertIn(source, catalog)
            self.assertIn(english, catalog)


if __name__ == "__main__":
    unittest.main()
