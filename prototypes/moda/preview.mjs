import { createModaPreviewDataPort } from "./preview-data-port.mjs";
import { mountModaApp } from "/apps/moda/src/ui/app.mjs";

const port = createModaPreviewDataPort();
mountModaApp({ port, root: document.querySelector("#app") });
