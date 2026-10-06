package main

import (
	"bytes"
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
	failedUpdatePackagePath := mustEnv(t, "ORDAX_NOTES_FAILED_UPDATE_PACKAGE")
	failedUpdateReleasePath := mustEnv(t, "ORDAX_NOTES_FAILED_UPDATE_RELEASE")
	failedUpdateCompatibilityPath := mustEnv(t, "ORDAX_NOTES_FAILED_UPDATE_COMPATIBILITY")
	healthyUpdatePackagePath := mustEnv(t, "ORDAX_NOTES_HEALTHY_UPDATE_PACKAGE")
	healthyUpdateReleasePath := mustEnv(t, "ORDAX_NOTES_HEALTHY_UPDATE_RELEASE")
	healthyUpdateCompatibilityPath := mustEnv(t, "ORDAX_NOTES_HEALTHY_UPDATE_COMPATIBILITY")

	fixture := t.TempDir()
	root := filepath.Join(fixture, "slots")
	privatePath := filepath.Join(fixture, "ephemeral-private.pem")
	trustPath := filepath.Join(fixture, "ephemeral-trust.json")
	envelopePath := filepath.Join(fixture, "notes.envelope.json")
	failedUpdateEnvelopePath := filepath.Join(fixture, "notes.failed-update.envelope.json")
	healthyUpdateEnvelopePath := filepath.Join(fixture, "notes.healthy-update.envelope.json")
	keyID := "notes-ci-ephemeral-1"

	appDataRoot := filepath.Join(fixture, "app-data", "ordax-official", "notes")
	if err := os.MkdirAll(appDataRoot, 0o700); err != nil {
		t.Fatalf("create Notes App Data sentinel root: %v", err)
	}
	appDataPath := filepath.Join(appDataRoot, "document.snapshot")
	appDataBytes := []byte(`{"$schema":"ordax.notes-app-data-sentinel/1","body":"preserve-across-uninstall"}`)
	if err := os.WriteFile(appDataPath, appDataBytes, 0o600); err != nil {
		t.Fatalf("write Notes App Data sentinel: %v", err)
	}

	assertAppDataPreserved := func(stage string) {
		t.Helper()
		payload, err := os.ReadFile(appDataPath)
		if err != nil {
			t.Fatalf("%s: read Notes App Data sentinel: %v", stage, err)
		}
		if !bytes.Equal(payload, appDataBytes) {
			t.Fatalf("%s: Notes App Data changed across component lifecycle mutation", stage)
		}
	}

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
	assertAppDataPreserved("initial promotion")

	failedUpdateRelease, err := signReleaseV2(
		failedUpdateReleasePath,
		failedUpdateCompatibilityPath,
		privatePath,
		trustPath,
		failedUpdateEnvelopePath,
		keyID,
	)
	if err != nil {
		t.Fatalf("sign failed-update Notes release/2: %v", err)
	}
	_, failedUpdateSlot, failedUpdateChanged, err := stageComponentV2(
		failedUpdateEnvelopePath,
		trustPath,
		failedUpdatePackagePath,
		failedUpdateCompatibilityPath,
		root,
	)
	if err != nil {
		t.Fatalf("stage failed-update Notes candidate: %v", err)
	}
	if !failedUpdateChanged || failedUpdateSlot == slot {
		t.Fatalf("failed-update Notes candidate did not create a distinct slot: changed=%t slot=%q", failedUpdateChanged, failedUpdateSlot)
	}
	state, err = armPendingState(failedUpdateSlot, trustPath, root)
	if err != nil {
		t.Fatalf("arm failed-update Notes candidate: %v", err)
	}
	failedPending := *state.Pending
	failedProbationRevision := state.Revision
	state, err = recordPendingHealthAtRevision(root, "notes", failedPending, "failed", &failedProbationRevision)
	if err != nil {
		t.Fatalf("record failed Notes update health: %v", err)
	}
	state, err = rejectPendingStateAtRevision(root, "notes", failedPending, state.Revision)
	if err != nil {
		t.Fatalf("reject failed Notes update: %v", err)
	}
	if state.Current == nil || state.Current.Version != version || state.Current.SourceCommit != sourceCommit {
		t.Fatalf("failed Notes update replaced last-known-good: %+v", state)
	}
	if state.Rejected == nil || state.Rejected.SourceCommit != failedUpdateRelease.SourceCommit {
		t.Fatalf("failed Notes update rejection identity drifted: %+v", state)
	}
	assertAppDataPreserved("failed update rejection")

	healthyUpdateRelease, err := signReleaseV2(
		healthyUpdateReleasePath,
		healthyUpdateCompatibilityPath,
		privatePath,
		trustPath,
		healthyUpdateEnvelopePath,
		keyID,
	)
	if err != nil {
		t.Fatalf("sign healthy-update Notes release/2: %v", err)
	}
	_, healthyUpdateSlot, healthyUpdateChanged, err := stageComponentV2(
		healthyUpdateEnvelopePath,
		trustPath,
		healthyUpdatePackagePath,
		healthyUpdateCompatibilityPath,
		root,
	)
	if err != nil {
		t.Fatalf("stage healthy-update Notes candidate: %v", err)
	}
	if !healthyUpdateChanged || healthyUpdateSlot == slot || healthyUpdateSlot == failedUpdateSlot {
		t.Fatalf("healthy-update Notes candidate did not create a distinct slot: changed=%t slot=%q", healthyUpdateChanged, healthyUpdateSlot)
	}
	state, err = armPendingState(healthyUpdateSlot, trustPath, root)
	if err != nil {
		t.Fatalf("arm healthy-update Notes candidate: %v", err)
	}
	healthyPending := *state.Pending
	healthyProbationRevision := state.Revision
	state, err = recordPendingHealthAtRevision(root, "notes", healthyPending, "healthy", &healthyProbationRevision)
	if err != nil {
		t.Fatalf("record healthy Notes update probation: %v", err)
	}
	state, err = promotePendingStateAtRevision(root, "notes", healthyPending, state.Revision, trustPath)
	if err != nil {
		t.Fatalf("promote healthy Notes update: %v", err)
	}
	if state.Current == nil || state.Current.SourceCommit != healthyUpdateRelease.SourceCommit || state.Previous == nil || state.Previous.SourceCommit != sourceCommit {
		t.Fatalf("healthy Notes update did not retain previous last-known-good: %+v", state)
	}

	promotedUpdate := *state.Current
	state, err = rollbackCurrentStateAtRevision(root, "notes", promotedUpdate, state.Revision, trustPath)
	if err != nil {
		t.Fatalf("rollback healthy Notes update: %v", err)
	}
	if state.Current == nil || state.Current.Version != version || state.Current.SourceCommit != sourceCommit {
		t.Fatalf("Notes rollback did not restore last-known-good: %+v", state)
	}
	if state.Previous != nil || state.Rejected == nil || state.Rejected.SourceCommit != healthyUpdateRelease.SourceCommit {
		t.Fatalf("Notes rollback bookkeeping drifted: %+v", state)
	}
	assertAppDataPreserved("rollback")

	installedBeforeUninstall := *state.Current
	uninstallRevision := state.Revision
	state, err = uninstallCurrentStateAtRevision(
		root,
		"notes",
		installedBeforeUninstall,
		uninstallRevision,
		trustPath,
	)
	if err != nil {
		t.Fatalf("uninstall Notes current slot: %v", err)
	}
	if state.Revision != uninstallRevision+1 || state.Current != nil || state.Previous != nil || state.Pending != nil || state.Rejected != nil || state.PendingHealth != "unknown" {
		t.Fatalf("unexpected Notes uninstall state: %+v", state)
	}

	retryState, err := uninstallCurrentStateAtRevision(
		root,
		"notes",
		installedBeforeUninstall,
		uninstallRevision,
		trustPath,
	)
	if err != nil {
		t.Fatalf("idempotent Notes uninstall retry: %v", err)
	}
	if retryState.Revision != state.Revision || retryState.Current != nil {
		t.Fatalf("Notes uninstall retry changed state: before=%+v after=%+v", state, retryState)
	}

	absentState, absentSlot, absentManifest, absentBundled, err := resolveRuntimeSlot(
		root,
		"notes",
		trustPath,
		"current",
	)
	if err != nil {
		t.Fatalf("resolve uninstalled Notes: %v", err)
	}
	if absentBundled || absentState.Current != nil || absentSlot != "" || absentManifest.Entrypoint != "" {
		t.Fatalf("uninstalled external Notes did not resolve as absent: bundled=%t slot=%q state=%+v manifest=%+v", absentBundled, absentSlot, absentState, absentManifest)
	}
	assertAppDataPreserved("uninstall")

	if _, err := verifySlotV2WithTrustBytes(slot, trustBytes); err != nil {
		t.Fatalf("verified Notes slot cache was damaged by uninstall: %v", err)
	}

	_, restagedSlot, restagedChanged, err := stageComponentV2(
		envelopePath,
		trustPath,
		packagePath,
		compatibilityPath,
		root,
	)
	if err != nil {
		t.Fatalf("offline restage verified local Notes artifact: %v", err)
	}
	if restagedChanged || restagedSlot != slot {
		t.Fatalf("offline Notes reinstall did not reuse verified local artifact: changed=%t slot=%q", restagedChanged, restagedSlot)
	}

	state, err = armPendingState(restagedSlot, trustPath, root)
	if err != nil {
		t.Fatalf("arm offline Notes reinstall: %v", err)
	}
	reinstallPending := *state.Pending
	reinstallProbationRevision := state.Revision
	state, err = recordPendingHealthAtRevision(root, "notes", reinstallPending, "healthy", &reinstallProbationRevision)
	if err != nil {
		t.Fatalf("record offline Notes reinstall health: %v", err)
	}
	state, err = promotePendingStateAtRevision(root, "notes", reinstallPending, state.Revision, trustPath)
	if err != nil {
		t.Fatalf("promote offline Notes reinstall: %v", err)
	}
	if state.Current == nil || state.Current.Version != version || state.Current.SourceCommit != sourceCommit {
		t.Fatalf("offline Notes reinstall identity drifted: %+v", state)
	}
	if state.Previous != nil || state.Pending != nil {
		t.Fatalf("offline Notes reinstall retained invalid activation references: %+v", state)
	}

	reinstalledRuntime, err := readVerifiedRuntimeFile(
		root,
		"notes",
		trustPath,
		"current",
		manifest.Entrypoint,
	)
	if err != nil {
		t.Fatalf("read offline-reinstalled Notes runtime: %v", err)
	}
	if !bytes.Equal(reinstalledRuntime, canonicalRuntime) {
		t.Fatal("offline-reinstalled Notes runtime differs from canonical source")
	}
	assertAppDataPreserved("offline reinstall")
}
