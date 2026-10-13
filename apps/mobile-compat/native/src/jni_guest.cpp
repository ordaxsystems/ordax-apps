#include "ordax/mobile/jni_guest.hpp"

#include <array>
#include <cstddef>
#include <cstdint>

namespace ordax::mobile {
namespace {
constexpr std::size_t kTableSlots = JniGuestEnvironment::kExceptionCheckIndex + 1;
constexpr std::size_t kTableBytes = kTableSlots * 8;
void store64(std::span<std::uint8_t> bytes, std::size_t pos, std::uint64_t value) {
    if (pos > bytes.size() || 8 > bytes.size() - pos) {
        throw GuestFault("JNI table memory out of bounds");
    }
    for (unsigned i = 0; i < 8; ++i) {
        bytes[pos + i] = static_cast<std::uint8_t>(value >> (8 * i));
    }
}
std::uint64_t trap(unsigned index) {
    return CpuA64::kHostCallPrefix | index;
}
}

void JniGuestEnvironment::install(CpuA64& cpu) {
    if (cpu.memory_size() < kTableAddress + kTableBytes) {
        throw GuestFault("JNI environment requires larger guest memory");
    }
    std::array<std::uint8_t, 8> env{};
    store64(env, 0, kTableAddress);
    std::array<std::uint8_t, kTableBytes> table{};
    store64(table, kGetVersionIndex * 8, trap(kGetVersionIndex));
    store64(table, kGetArrayLengthIndex * 8, trap(kGetArrayLengthIndex));
    store64(table, kExceptionCheckIndex * 8, trap(kExceptionCheckIndex));
    // The CPU enforces that these pages do not overlap guest PT_LOAD and
    // remain read-only after installation. All unsupported slots remain NULL.
    cpu.install_host_readonly(kEnvAddress, env);
    cpu.install_host_readonly(kTableAddress, table);
    cpu.set_host_call([this](std::uint64_t address, const auto& args) {
        return dispatch(address, args);
    });
}
std::uint64_t JniGuestEnvironment::createIntArray(std::int32_t length) {
    if (length < 0 || length > 65536 || array_lengths_.size() >= 4096) {
        throw GuestFault("JNI array allocation exceeds quota");
    }
    const auto handle = next_handle_++;
    array_lengths_.emplace(handle, length);
    return handle;
}
std::uint64_t JniGuestEnvironment::dispatch(
    std::uint64_t target, const std::array<std::uint64_t, 8>& args) const {
    if (args[0] != kEnvAddress) throw GuestFault("JNI call has incorrect JNIEnv pointer");
    if (target == trap(kGetVersionIndex)) return kVersion;
    if (target == trap(kGetArrayLengthIndex)) {
        const auto item = array_lengths_.find(args[1]);
        if (item == array_lengths_.end()) {
            throw GuestFault("JNI GetArrayLength received invalid local array handle");
        }
        return static_cast<std::uint32_t>(item->second);
    }
    if (target == trap(kExceptionCheckIndex)) {
        // No Java exception state exists in this subset. No exception may be
        // silently synthesized; the only valid state is "none pending".
        return 0;
    }
    throw GuestFault("Unimplemented JNI interface table function");
}
} // namespace ordax::mobile
