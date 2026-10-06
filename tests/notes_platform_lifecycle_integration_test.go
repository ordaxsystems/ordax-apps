package main

import (
	"os"
	"path/filepath"
	"testing"
)

func mustEnv(t *testing.T, name string) string {
	t.Helper()
	value := os.Getenv(name)
	if value == "" {
		t.Fatalf("%s is required", name)
	}
	return value
}

func TestExternalNotesPackageCompletesCanonicalLifecycle(t *testing.T) {
	packagePath := mustEnv(t, "ORDAX_NOTES_PACKAGE")
	releasePath := mustEnv(t, "ORDAX_NOTES_RELEASE")
	compatibilityPath := mustEnv(t, "ORDAX_NOTES_COMPATIBILITY")

	fixture := t.TempDir()
	root := filepath.Join(fixture, "slots")
	privatePath := filepath.Join(fixture, "ephemeral-private.pem")
	trustPath := filepath.Join(fixture, "ephemeral-trust.json")
	envelopePath := filepath.Join(fixture, "notes.envelope.json")
	keyID := "notes-ci-ephemeral-1"

	if _, err := generateKey(privatePath, trustPath, keyID); err != nil {
		t.Fatalf("generate ephemeral CI trust: %v", err)
	}
	t.Cleanup(func() { allowTestTreeCleanup(root) })

	release, err := signReleaseV2(
		releasePath,
		compatibilityPath,
		privatePath,
		trustPath,
		envelopePath,
		keyID,
	)
	if err != nil {
		t.Fatalf("sign canonical Notes release/2: %v", err)
	}
	if release.SourceRepository != appsSourceRepository {
		t.Fatalf("Notes source repository = %q", release.SourceRepository)
	}
	if release.Component.ID != "notes" {
		t.Fatalf("unexpected Notes release identity: %+v", release.Component)
	}
	version := release.Component.Version
	sourceCommit := release.SourceCommit

	verified, _, _, _, err := verifyEnvelopeV2Files(envelopePath, trustPath, compatibilityPath)
	if err != nil {
		t.Fatalf("verify Notes envelope: %v", err)
	}
	if !sameReleaseV2(verified, release) {
		t.Fatal("verified Notes release differs from signed release")
	}

	staged, slot, changed, err := stageComponentV2(
		envelopePath,
		trustPath,
		packagePath,
		compatibilityPath,
		root,
	)
	if err != nil {
		t.Fatalf("stage Notes release/2: %v", err)
	}
	if !changed {
		t.Fatal("first Notes stage unexpectedly reused an existing slot")
	}
	if !sameReleaseV2(staged, release) {
		t.Fatal("staged Notes release differs from signed release")
	}

	trustBytes, err := os.ReadFile(trustPath)
	if err != nil {
		t.Fatal(err)
	}
	installed, err := verifySlotV2WithTrustBytes(slot, trustBytes)
	if err != nil {
		t.Fatalf("verify staged Notes slot: %v", err)
	}
	if !sameReleaseV2(installed, release) {
		t.Fatal("installed Notes slot identity changed")
	}

	state, err := armPendingState(slot, trustPath, root)
	if err != nil {
		t.Fatalf("arm Notes pending state: %v", err)
	}
	if state.Revision != 1 || state.Pending == nil || state.PendingHealth != "unknown" {
		t.Fatalf("unexpected Notes pending state: %+v", state)
	}
	pending := *state.Pending

	probationRevision := state.Revision
	state, err = recordPendingHealthAtRevision(
		root,
		"notes",
		pending,
		"healthy",
		&probationRevision,
	)
	if err != nil {
		t.Fatalf("record Notes healthy probation: %v", err)
	}
	if state.Revision != 2 || state.PendingHealth != "healthy" {
		t.Fatalf("unexpected Notes probation state: %+v", state)
	}

	state, err = promotePendingStateAtRevision(
		root,
		"notes",
		pending,
		state.Revision,
		trustPath,
	)
	if err != nil {
		t.Fatalf("promote Notes pending state: %v", err)
	}
	if state.Revision != 3 || state.Current == nil || state.Pending != nil {
		t.Fatalf("unexpected promoted Notes state: %+v", state)
	}
	if state.Current.Version != version || state.Current.SourceCommit != sourceCommit {
		t.Fatalf("promoted Notes identity drifted: %+v", state.Current)
	}

	resolved, resolvedSlot, manifest, bundled, err := resolveRuntimeSlot(
		root,
		"notes",
		trustPath,
		"current",
	)
	if err != nil {
		t.Fatalf("resolve promoted Notes slot: %v", err)
	}
	if bundled || resolved.Current == nil || resolvedSlot != slot {
		t.Fatalf("Notes did not resolve from promoted slot: bundled=%t slot=%q state=%+v", bundled, resolvedSlot, resolved)
	}
	if manifest.Entrypoint != "system/apps/notes/src/runtime.mjs" {
		t.Fatalf("Notes entrypoint = %q", manifest.Entrypoint)
	}

	runtimeBytes, err := readVerifiedRuntimeFile(
		root,
		"notes",
		trustPath,
		"current",
		manifest.Entrypoint,
	)
	if err != nil {
		t.Fatalf("read verified Notes runtime: %v", err)
	}
	canonicalRuntime, err := os.ReadFile(mustEnv(t, "ORDAX_NOTES_RUNTIME"))
	if err != nil {
		t.Fatal(err)
	}
	if string(runtimeBytes) != string(canonicalRuntime) {
		t.Fatal("promoted Notes runtime bytes differ from canonical source")
	}

	_, restagedSlot, restagedChanged, err := stageComponentV2(
		envelopePath,
		trustPath,
		packagePath,
		compatibilityPath,
		root,
	)
	if err != nil {
		t.Fatalf("restage verified local Notes artifact: %v", err)
	}
	if restagedChanged || restagedSlot != slot {
		t.Fatalf("verified local Notes artifact was not idempotently reusable: changed=%t slot=%q", restagedChanged, restagedSlot)
	}
}
