#pragma once

#include "ordax/mobile/cpu_a64.hpp"

#include <array>
#include <cstdint>
#include <span>
#include <string>
#include <cstddef>
#include <vector>
#include <unordered_map>
#include <utility>

namespace ordax::mobile {
struct LoadedGuestElf;

struct JniDeclaredMethod {
    std::string name;
    std::string signature;
};
struct JniRegisteredMethod {
    std::string owner;
    std::string name;
    std::string signature;
    std::uint64_t guest_address = 0;
};

// First JNI ABI-compatible *table and invocation* boundary for AArch64.
// Only explicitly supported JNIEnv and JavaVM slots exist; all other entries are NULL and
// must fail closed. Local references are opaque guest handles, not host ptrs.
// No actual JNI class loader, GC, threads, Java exception or Bionic linker.
class JniGuestEnvironment final {
public:
    static constexpr std::uint64_t kEnvAddress = 0x3f0000;
    static constexpr std::uint64_t kTableAddress = 0x3f1000;
    static constexpr std::uint64_t kVmAddress = 0x3f2000;
    static constexpr std::uint64_t kVmTableAddress = 0x3f3000;
    static constexpr unsigned kVmGetEnvIndex = 6;
    static constexpr std::uint32_t kErrVersion = static_cast<std::uint32_t>(-3);
    static constexpr std::uint64_t kClassHandle = 0x20000001;
    static constexpr std::uint32_t kVersion = 0x00010006; // JNI_VERSION_1_6

    // The actual JNI JNINativeInterface index numbers (8-byte slots).
    static constexpr unsigned kGetVersionIndex = 4;
    static constexpr unsigned kFindClassIndex = 6;
    static constexpr unsigned kRegisterNativesIndex = 215;
    static constexpr unsigned kGetArrayLengthIndex = 171;
    static constexpr unsigned kNewIntArrayIndex = 179;
    static constexpr unsigned kGetIntArrayRegionIndex = 203;
    static constexpr unsigned kSetIntArrayRegionIndex = 211;
    static constexpr unsigned kExceptionCheckIndex = 228;

    // Class/method declarations originate from a verified DEX owner, never
    // from JNI_OnLoad or an untrusted native library. One class is currently
    // supported; registration only binds functions to these existing names.
    void declareNativeClass(std::string owner,
        std::span<const JniDeclaredMethod> methods);
    [[nodiscard]] const std::vector<JniRegisteredMethod>& registeredMethods() const noexcept {
        return registered_methods_;
    }
    void install(CpuA64& cpu);
    // JNI_OnLoad(JavaVM*, void*) is discovered through the validated ELF
    // dynsym and executed only after DT_INIT/DT_INIT_ARRAY. This is not an
    // ART bootstrap or a general VM implementation.
    [[nodiscard]] std::uint32_t runOnLoad(CpuA64& cpu, LoadedGuestElf& image,
        std::span<const std::uint8_t> elf, const std::string& soname,
        std::uint64_t instruction_budget);
    [[nodiscard]] std::uint64_t createIntArray(std::int32_t length);
    [[nodiscard]] std::uint64_t importIntArray(std::span<const std::int32_t> values);
    [[nodiscard]] const std::vector<std::int32_t>& exportIntArray(std::uint64_t handle) const;

private:
    std::unordered_map<std::uint64_t, std::vector<std::int32_t>> arrays_;
    CpuA64* cpu_ = nullptr;
    std::uint64_t next_handle_ = 0x30000001;
    std::size_t array_cells_ = 0;
    std::string declared_owner_;
    std::vector<JniDeclaredMethod> declared_methods_;
    std::vector<JniRegisteredMethod> registered_methods_;
    LoadedGuestElf* registering_image_ = nullptr;
    bool registration_getenv_succeeded_ = false;
    [[nodiscard]] std::uint64_t dispatchRegistration(
        std::uint64_t target, const std::array<std::uint64_t, 8>& args);
    [[nodiscard]] std::uint64_t dispatch(
        std::uint64_t target, const std::array<std::uint64_t, 8>& args);
};
} // namespace ordax::mobile
