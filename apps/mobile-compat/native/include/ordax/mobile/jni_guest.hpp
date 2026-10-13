#pragma once

#include "ordax/mobile/cpu_a64.hpp"

#include <array>
#include <cstdint>
#include <unordered_map>

namespace ordax::mobile {

// First JNI ABI-compatible *table and invocation* boundary for AArch64.
// Only three documented function slots exist; all other entries are NULL and
// must fail closed. Local references are opaque guest handles, not host ptrs.
// No actual JNI class loader, GC, threads, Java exception or Bionic linker.
class JniGuestEnvironment final {
public:
    static constexpr std::uint64_t kEnvAddress = 0x3f0000;
    static constexpr std::uint64_t kTableAddress = 0x3f1000;
    static constexpr std::uint64_t kClassHandle = 0x20000001;
    static constexpr std::uint32_t kVersion = 0x00010006; // JNI_VERSION_1_6

    // The actual JNI JNINativeInterface index numbers (8-byte slots).
    static constexpr unsigned kGetVersionIndex = 4;
    static constexpr unsigned kGetArrayLengthIndex = 171;
    static constexpr unsigned kExceptionCheckIndex = 228;

    void install(CpuA64& cpu);
    [[nodiscard]] std::uint64_t createIntArray(std::int32_t length);

private:
    std::unordered_map<std::uint64_t, std::int32_t> array_lengths_;
    std::uint64_t next_handle_ = 0x30000001;
    [[nodiscard]] std::uint64_t dispatch(
        std::uint64_t target, const std::array<std::uint64_t, 8>& args) const;
};
} // namespace ordax::mobile
