const PROVIDER_SCHEMA = "ordax.application-action-provider/1";
const RESULT_SCHEMA = "ordax.application-action-provider-result/1";

export const STUDIO_APPLICATION_ACTIONS = Object.freeze([
  "studio.list-projects",
  "studio.select-project",
  "studio.inspect-project",
  "studio.preview-project",
  "studio.check-project-health",
  "studio.open-managed-browser",
  "studio.prepare-blender",
]);

const REQUIRED_HOST_METHODS = Object.freeze([
  "projectsCatalog",
  "selectProject",
  "inventory",
  "briefing",
  "search",
  "gitDiff",
  "previewStatus",
  "previewStart",
  "previewStop",
  "previewCapture",
  "previewLogs",
  "health",
  "executionStatus",
  "productStatus",
  "browserStart",
  "blenderPrepare",
  "blenderInstallBridge",
  "blenderInstances",
  "blenderStart",
]);

const BLOCKED_OUTPUT_KEYS = Object.freeze([
  "path",
  "command",
  "argv",
  "environment",
  "token",
  "password",
  "secret",
  "credential",
  "authorization",
  "cookie",
  "grant",
  "approval",
  "sessionid",
]);

function result(status, summary, output = null) {
  return Object.freeze({
    schema: RESULT_SCHEMA,
    status,
    summary,
    output,
    artifactRefs: Object.freeze([]),
  });
}

function assertStudioHost(host) {
  if (!host || typeof host !== "object" || Array.isArray(host)) {
    throw new TypeError("Studio provider requires a typed host");
  }
  for (const method of REQUIRED_HOST_METHODS) {
    if (typeof host[method] !== "function") {
      throw new TypeError(`Studio provider host is missing ${method}()`);
    }
  }
  return host;
}

function isBlockedKey(key) {
  const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
  return BLOCKED_OUTPUT_KEYS.some((fragment) => normalized.includes(fragment));
}

function safeProjection(value, depth = 0) {
  if (depth > 4) return null;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return value.slice(0, 8192);
  if (Array.isArray(value)) {
    return Object.freeze(value.slice(0, 64).map((item) => safeProjection(item, depth + 1)));
  }
  if (!value || typeof value !== "object") return null;
  const output = Object.create(null);
  let count = 0;
  for (const [key, item] of Object.entries(value)) {
    if (count >= 64 || isBlockedKey(key)) continue;
    output[key] = safeProjection(item, depth + 1);
    count += 1;
  }
  return Object.freeze(output);
}

function summaryOf(value, fallback) {
  const summary = value?.summary;
  return typeof summary === "string" && summary.trim()
    ? summary.slice(0, 1024)
    : fallback;
}

async function hostCall(host, method, args = [], {
  successSummary,
  projectOutput = false,
} = {}) {
  const value = await host[method](...args);
  if (!value || value.ok !== true) {
    return result("failed", summaryOf(value, `${method} falhou`));
  }
  if (projectOutput) {
    const projects = Array.isArray(value.projects)
      ? value.projects
      : Array.isArray(value.data?.projects) ? value.data.projects : [];
    const names = projects.slice(0, 128).map((project) => (
      project?.slug ?? project?.id ?? project?.name ?? project?.title ?? "projeto"
    ));
    return result("succeeded", summaryOf(value, successSummary), Object.freeze({
      projects: Object.freeze(names.map((project) => String(project).slice(0, 240))),
    }));
  }
  const data = value.data === undefined ? null : safeProjection(value.data);
  return result(
    "succeeded",
    summaryOf(value, successSummary),
    data === null ? Object.freeze({ ok: true }) : data,
  );
}

export function createApplicationActionProvider(studioHost) {
  const host = assertStudioHost(studioHost);

  return Object.freeze({
    schema: PROVIDER_SCHEMA,
    appId: "studio",
    adapterId: "studio-native",
    revision: "2",
    actions: STUDIO_APPLICATION_ACTIONS,
    async invoke(invocation) {
      if (
        !invocation
        || invocation.appId !== "studio"
        || !STUDIO_APPLICATION_ACTIONS.includes(invocation.actionId)
        || !invocation.arguments
        || typeof invocation.arguments !== "object"
        || Array.isArray(invocation.arguments)
      ) {
        return result("failed", "Invocation do Studio incompatível");
      }

      const args = invocation.arguments;
      try {
        switch (invocation.actionId) {
          case "studio.list-projects":
            return hostCall(host, "projectsCatalog", [], {
              successSummary: "Projetos consultados",
              projectOutput: true,
            });

          case "studio.select-project": {
            const value = await host.selectProject(args.project);
            if (!value || value.ok !== true) {
              return result("failed", summaryOf(value, "Projeto não pôde ser selecionado"));
            }
            return result("succeeded", summaryOf(value, "Projeto selecionado"), Object.freeze({
              project: String(args.project).slice(0, 240),
            }));
          }

          case "studio.inspect-project": {
            const query = String(args.query ?? "").trim();
            if (!query) {
              return hostCall(host, "briefing", [], { successSummary: "Briefing consultado" });
            }
            const lower = query.toLocaleLowerCase("pt-BR");
            if (lower === "inventory" || lower === "inventário" || lower === "inventario") {
              return hostCall(host, "inventory", [], { successSummary: "Inventário consultado" });
            }
            if (lower === "diff" || lower === "git diff") {
              return hostCall(host, "gitDiff", [], { successSummary: "Diff consultado" });
            }
            return hostCall(host, "search", [query], { successSummary: "Busca concluída" });
          }

          case "studio.preview-project": {
            const operations = Object.freeze({
              status: ["previewStatus", []],
              start: ["previewStart", []],
              stop: ["previewStop", []],
              capture: ["previewCapture", []],
              logs: ["previewLogs", [65536]],
            });
            const selected = operations[args.operation];
            if (!selected) return result("failed", "Operação de preview não suportada");
            return hostCall(host, selected[0], selected[1], {
              successSummary: "Operação de preview concluída",
            });
          }

          case "studio.check-project-health": {
            const [health, execution, product] = await Promise.all([
              host.health(),
              host.executionStatus(),
              host.productStatus(),
            ]);
            if (health?.ok !== true || execution?.ok !== true || product?.ok !== true) {
              return result("failed", "A saúde do projeto não pôde ser consultada");
            }
            return result("succeeded", "Saúde do projeto consultada", Object.freeze({
              health: safeProjection(health.data),
              execution: safeProjection(execution.data),
              product: safeProjection(product.data),
            }));
          }

          case "studio.open-managed-browser": {
            const value = await host.browserStart(args.url, false, 3);
            if (!value || value.ok !== true) {
              return result("failed", summaryOf(value, "Navegador gerenciado não pôde ser aberto"));
            }
            return result("succeeded", summaryOf(value, "Navegador gerenciado aberto"), Object.freeze({
              opened: true,
              url: String(args.url).slice(0, 2048),
            }));
          }

          case "studio.prepare-blender": {
            const operations = Object.freeze({
              prepare: ["blenderPrepare", []],
              "install-bridge": ["blenderInstallBridge", []],
              list: ["blenderInstances", []],
              start: ["blenderStart", []],
            });
            const selected = operations[args.operation];
            if (!selected) return result("failed", "Operação Blender não suportada");
            return hostCall(host, selected[0], selected[1], {
              successSummary: "Operação Blender concluída",
            });
          }

          default:
            return result("failed", "Ação do Studio não suportada");
        }
      } catch {
        return result("failed", "A ação do Studio não pôde ser concluída");
      }
    },
  });
}

export const applicationActionProviderArtifact = Object.freeze({
  schema: "ordax.application-action-provider-artifact/1",
  appId: "studio",
  adapterId: "studio-native",
  revision: "2",
  authority: "none",
  execution: "unavailable",
});
