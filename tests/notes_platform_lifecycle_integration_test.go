package main

import (
    "os"
    "path/filepath"
    "strings"
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

// Real signed Notes is stateful. The Native activation writer intentionally
// fails closed on upgrades and uninstall without a durable recovery transaction.
// Prove the complete AVAILABLE lifecycle (install and mount) plus every fence.
// The separately signed stateless cases below prove upgrade/rollback/uninstall
// without pretending Notes' persistent state is already recoverable.
func TestExternalNotesPackageRespectsStatefulRecoveryFence(t *testing.T) {
    packagePath := mustEnv(t, "ORDAX_NOTES_PACKAGE")
    releasePath := mustEnv(t, "ORDAX_NOTES_RELEASE")
    compatibilityPath := mustEnv(t, "ORDAX_NOTES_COMPATIBILITY")
    fixture := t.TempDir()
    root := filepath.Join(fixture, "slots")
    privatePath := filepath.Join(fixture, "ephemeral-private.pem")
    trustPath := filepath.Join(fixture, "ephemeral-trust.json")
    envelopePath := filepath.Join(fixture, "notes.envelope.json")
    const keyID = "notes-ci-ephemeral-1"
    if _, err := generateKey(privatePath, trustPath, keyID); err != nil {
        t.Fatalf("generate ephemeral signing key: %v", err)
    }
    t.Cleanup(func() { allowTestTreeCleanup(root) })
    release, err := signReleaseV2(releasePath, compatibilityPath, privatePath, trustPath, envelopePath, keyID)
    if err != nil {
        t.Fatalf("sign real Notes stateful release/2: %v", err)
    }
    if release.SourceRepository != appsSourceRepository || release.Component.ID != "notes" {
        t.Fatalf("signed Notes owner or ID drifted: %+v", release)
    }
    verified, _, _, _, err := verifyEnvelopeV2Files(envelopePath, trustPath, compatibilityPath)
    if err != nil || !sameReleaseV2(verified, release) {
        t.Fatalf("real Notes signature/compatibility verification failed: %v", err)
    }
    staged, slot, changed, err := stageComponentV2(envelopePath, trustPath, packagePath, compatibilityPath, root)
    if err != nil || !changed || !sameReleaseV2(staged, release) {
        t.Fatalf("Notes stage under ephemeral Ed25519 trust failed: %v", err)
    }
    trustBytes, err := os.ReadFile(trustPath)
    if err != nil {
        t.Fatal(err)
    }
    slotRelease, err := verifySlotV2WithTrustBytes(slot, trustBytes)
    if err != nil || !sameReleaseV2(slotRelease, release) {
        t.Fatalf("Notes staged slot lost signed identity: %v", err)
    }
    state, err := armPendingState(slot, trustPath, root)
    if err != nil || state.Revision != 1 || state.Pending == nil || state.PendingHealth != "unknown" {
        t.Fatalf("Notes initial pending installation failed: %v state=%+v", err, state)
    }
    revision := state.Revision
    state, err = recordPendingHealthAtRevision(root, "notes", *state.Pending, "healthy", &revision)
    if err != nil || state.Revision != 2 || state.PendingHealth != "healthy" {
        t.Fatalf("Notes probation failed: %v state=%+v", err, state)
    }
    state, err = promotePendingStateAtRevision(root, "notes", *state.Pending, state.Revision, trustPath)
    if err != nil || state.Current == nil || state.Revision != 3 || state.Pending != nil {
        t.Fatalf("Notes first promotion failed: %v state=%+v", err, state)
    }
    current := *state.Current
    resolved, selectedSlot, manifest, bundled, err := resolveRuntimeSlot(root, "notes", trustPath, "current")
    if err != nil || bundled || selectedSlot != slot || resolved.Current == nil {
        t.Fatalf("Notes did not resolve from verified external slot: %v", err)
    }
    if manifest.Entrypoint != "system/apps/notes/src/runtime.mjs" {
        t.Fatalf("unrecognized Notes signed runtime path: %s", manifest.Entrypoint)
    }
    runtimeBytes, err := readVerifiedRuntimeFile(root, "notes", trustPath, "current", manifest.Entrypoint)
    if err != nil {
        t.Fatal(err)
    }
    sourceBytes, err := os.ReadFile(mustEnv(t, "ORDAX_NOTES_RUNTIME"))
    if err != nil || string(runtimeBytes) != string(sourceBytes) {
        t.Fatalf("Notes signed runtime differs from canonical app code: %v", err)
    }
    dataRoot := filepath.Join(fixture, "app-data", "ordax-official", "notes")
    if err := os.MkdirAll(dataRoot, 0o700); err != nil {
        t.Fatal(err)
    }
    sentinel := filepath.Join(dataRoot, "preserved.bin")
    const originalData = "notes-durable-app-data-cannot-be-stranded"
    if err := os.WriteFile(sentinel, []byte(originalData), 0o600); err != nil {
        t.Fatal(err)
    }
    for _, variant := range []struct {
        label, packageEnv, releaseEnv, compatibilityEnv string
    }{
        {"failed candidate", "ORDAX_NOTES_FAILED_UPDATE_PACKAGE", "ORDAX_NOTES_FAILED_UPDATE_RELEASE", "ORDAX_NOTES_FAILED_UPDATE_COMPATIBILITY"},
        {"healthy candidate", "ORDAX_NOTES_HEALTHY_UPDATE_PACKAGE", "ORDAX_NOTES_HEALTHY_UPDATE_RELEASE", "ORDAX_NOTES_HEALTHY_UPDATE_COMPATIBILITY"},
    } {
        t.Run(variant.label, func(t *testing.T) {
            envelope := filepath.Join(fixture, "notes-update-"+variant.label+".envelope.json")
            updateRelease, err := signReleaseV2(
                mustEnv(t, variant.releaseEnv), mustEnv(t, variant.compatibilityEnv),
                privatePath, trustPath, envelope, keyID,
            )
            if err != nil {
                t.Fatalf("sign real Notes candidate update: %v", err)
            }
            _, updateSlot, changed, err := stageComponentV2(
                envelope, trustPath, mustEnv(t, variant.packageEnv),
                mustEnv(t, variant.compatibilityEnv), root,
            )
            if err != nil || !changed || updateRelease.Component.ID != "notes" {
                t.Fatalf("stage signed Notes update candidate failed: %v", err)
            }
            if _, err = armPendingState(updateSlot, trustPath, root); err == nil ||
                !strings.Contains(err.Error(), "verified device-state recovery checkpoint") {
                t.Fatalf("stateful Notes upgrade bypassed the recovery fence: %v", err)
            }
            after, err := readActivationState(root, "notes")
            if err != nil || after.Revision != state.Revision || after.Pending != nil ||
                after.Current == nil || !sameSlotIdentity(after.Current, &current) {
                t.Fatalf("rejected stateful update mutated Native activation state: %v %+v", err, after)
            }
        })
    }
    if _, err := uninstallCurrentStateAtRevision(root, "notes", current, state.Revision, trustPath); err == nil {
        t.Fatal("Notes stateful uninstall bypassed process/data quiescence")
    }
    persisted, err := readActivationState(root, "notes")
    if err != nil || persisted.Revision != state.Revision || persisted.Current == nil ||
        !sameSlotIdentity(persisted.Current, &current) || persisted.UserRemoved {
        t.Fatalf("blocked Notes uninstall changed canonical activation state: %v %+v", err, persisted)
    }
    afterData, err := os.ReadFile(sentinel)
    if err != nil || string(afterData) != originalData {
        t.Fatalf("Notes stateful fences modified preserved App Data: %v", err)
    }
    cached, err := verifySlotV2WithTrustBytes(slot, trustBytes)
    if err != nil || !sameReleaseV2(cached, release) {
        t.Fatalf("Native recovery fence damaged signed Notes package cache: %v", err)
    }
}
