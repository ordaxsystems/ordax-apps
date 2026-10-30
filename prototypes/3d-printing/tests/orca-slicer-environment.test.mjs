import assert from "node:assert/strict";
import test from "node:test";
import { createOrcaChildEnvironment, parseOrcaProgressLine } from "../shared/orca-slicer-development.mjs";

test("progresso do Orca usa apenas percentuais recebidos pelo canal CLI e sanitiza a mensagem", () => {
  assert.deepEqual(parseOrcaProgressLine(JSON.stringify({
    plate_index: 0,
    plate_count: 2,
    plate_percent: 31,
    total_percent: 47,
    message: "Gerando perímetros\nplaca 1",
  })), { percent: 47, stage: "Gerando perímetros placa 1" });
  assert.deepEqual(parseOrcaProgressLine(JSON.stringify({ warning: "Malha precisa de revisão", plate_index: 1, plate_count: 2 })), {
    percent: null,
    stage: "Aviso do OrcaSlicer: Malha precisa de revisão",
  });
  assert.equal(parseOrcaProgressLine("not-json"), null);
  assert.equal(parseOrcaProgressLine("x".repeat(4097)), null);
  assert.deepEqual(parseOrcaProgressLine(JSON.stringify({ total_percent: 140, message: "Processando" })), {
    percent: null,
    stage: "Processando",
  });
});

test("processo do Orca no Windows recebe apenas variáveis de sistema e dados temporários do job", () => {
  const environment = createOrcaChildEnvironment({
    platform: "win32",
    jobDirectory: "C:\\jobs\\slice-1",
    source: {
      Path: "C:\\Windows\\System32;C:\\OrcaSlicer",
      SystemRoot: "C:\\Windows",
      TEMP: "C:\\Users\\TONECOS\\AppData\\Local\\Temp",
      USERPROFILE: "C:\\Users\\TONECOS",
      APPDATA: "C:\\Users\\TONECOS\\AppData\\Roaming",
      GROQ_API_KEY: "must-not-leak",
      AWS_ACCESS_KEY_ID: "must-not-leak",
      NODE_OPTIONS: "--require attacker.js",
      KUBECONFIG: "C:\\Users\\TONECOS\\.kube\\config",
    },
  });

  assert.equal(environment.PATH, "C:\\Windows\\System32;C:\\OrcaSlicer");
  assert.equal(environment.SYSTEMROOT, "C:\\Windows");
  assert.equal(environment.USERPROFILE, "C:\\jobs\\slice-1");
  assert.equal(environment.APPDATA, "C:\\jobs\\slice-1\\appdata");
  assert.equal(environment.LOCALAPPDATA, "C:\\jobs\\slice-1\\local-appdata");
  assert.equal(environment.TEMP, "C:\\jobs\\slice-1\\tmp");
  assert.equal("GROQ_API_KEY" in environment, false);
  assert.equal("AWS_ACCESS_KEY_ID" in environment, false);
  assert.equal("NODE_OPTIONS" in environment, false);
  assert.equal("KUBECONFIG" in environment, false);
  assert.equal("USERPROFILE" in environment && environment.USERPROFILE.includes("TONECOS"), false);
  assert.equal(Object.isFrozen(environment), true);
});

test("processo do Orca no Linux não herda preload nem diretórios pessoais", () => {
  const environment = createOrcaChildEnvironment({
    platform: "linux",
    jobDirectory: "/var/tmp/ordax-job-1",
    source: {
      PATH: "/usr/bin:/usr/local/bin",
      LANG: "pt_BR.UTF-8",
      HOME: "/home/usuario",
      LD_PRELOAD: "/tmp/inject.so",
      XDG_CONFIG_HOME: "/home/usuario/.config",
      XDG_DATA_HOME: "/home/usuario/.local/share",
      API_CREDENTIALS: "must-not-leak",
    },
  });

  assert.deepEqual(environment, {
    PATH: "/usr/bin:/usr/local/bin",
    LANG: "pt_BR.UTF-8",
    HOME: "/var/tmp/ordax-job-1",
    TMPDIR: "/var/tmp/ordax-job-1/tmp",
    TEMP: "/var/tmp/ordax-job-1/tmp",
    TMP: "/var/tmp/ordax-job-1/tmp",
    XDG_CONFIG_HOME: "/var/tmp/ordax-job-1/config",
    XDG_CACHE_HOME: "/var/tmp/ordax-job-1/cache",
    XDG_DATA_HOME: "/var/tmp/ordax-job-1/data-home",
    XDG_STATE_HOME: "/var/tmp/ordax-job-1/state",
  });
});

test("consulta inicial do Orca não recebe o ambiente pessoal do host", () => {
  const environment = createOrcaChildEnvironment({
    platform: "linux",
    source: { PATH: "/usr/bin", HOME: "/home/usuario", GROQ_API_KEY: "must-not-leak", DISPLAY: ":0" },
  });

  assert.deepEqual(environment, { PATH: "/usr/bin" });
});
