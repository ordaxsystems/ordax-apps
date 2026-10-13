#include "ordax/mobile/jni_guest.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <vector>

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
    store64(table, kGetIntArrayRegionIndex * 8, trap(kGetIntArrayRegionIndex));
    store64(table, kSetIntArrayRegionIndex * 8, trap(kSetIntArrayRegionIndex));
    store64(table, kExceptionCheckIndex * 8, trap(kExceptionCheckIndex));
    // The CPU enforces that these pages do not overlap guest PT_LOAD and
    // remain read-only after installation. All unsupported slots remain NULL.
    cpu.install_host_readonly(kEnvAddress, env);
    cpu.install_host_readonly(kTableAddress, table);
    cpu_ = &cpu;
    cpu.set_host_call([this](std::uint64_t address, const auto& args) {
        return dispatch(address, args);
    });
}
std::uint64_t JniGuestEnvironment::createIntArray(std::int32_t length) {
    if (length < 0 || length > 65536 || arrays_.size() >= 4096 ||
        static_cast<std::size_t>(length) > 262144 - array_cells_) {
        throw GuestFault("JNI array allocation exceeds quota");
    }
    const auto handle = next_handle_++;
    arrays_.emplace(handle, std::vector<std::int32_t>(static_cast<std::size_t>(length), 0));
    array_cells_ += static_cast<std::size_t>(length);
    return handle;
}
std::uint64_t JniGuestEnvironment::importIntArray(std::span<const std::int32_t> values) {
    if (values.size() > 1024) throw GuestFault("JNI imported array exceeds transport budget");
    const auto handle = createIntArray(static_cast<std::int32_t>(values.size()));
    auto& data = arrays_.at(handle);
    data.assign(values.begin(), values.end());
    return handle;
}
const std::vector<std::int32_t>& JniGuestEnvironment::exportIntArray(
    std::uint64_t handle) const {
    const auto it = arrays_.find(handle);
    if (it == arrays_.end()) throw GuestFault("JNI invalid array reference");
    return it->second;
}
std::uint64_t JniGuestEnvironment::dispatch(
    std::uint64_t target, const std::array<std::uint64_t, 8>& args) {
    if (args[0] != kEnvAddress || !cpu_) {
        throw GuestFault("JNI call has incorrect JNIEnv pointer");
    }
    if (target == trap(kGetVersionIndex)) return kVersion;
    if (target == trap(kExceptionCheckIndex)) return 0;
    if (target == trap(kGetArrayLengthIndex)) {
        return static_cast<std::uint32_t>(exportIntArray(args[1]).size());
    }
    if (target == trap(kGetIntArrayRegionIndex) ||
        target == trap(kSetIntArrayRegionIndex)) {
        const auto& data = exportIntArray(args[1]);
        if (args[2] > std::numeric_limits<std::int32_t>::max() ||
            args[3] > std::numeric_limits<std::int32_t>::max() ||
            args[4] == 0 || args[4] % 4 != 0) {
            throw GuestFault("JNI invalid int array region arguments");
        }
        const auto first = static_cast<std::size_t>(args[2]);
        const auto count = static_cast<std::size_t>(args[3]);
        if (first > data.size() || count > data.size() - first ||
            count > 1024) {
            throw GuestFault("JNI int array region out of bounds");
        }
        const bool writing_guest = target == trap(kGetIntArrayRegionIndex);
        cpu_->require_guest_access(args[4], count * 4, writing_guest ? 2 : 4);
        if (writing_guest) {
            for (std::size_t i = 0; i < count; ++i) {
                cpu_->guest_write_i32(args[4] + 4 * i, data[first + i]);
            }
        } else {
            // Validate and copy all values before mutating the Java array.
            std::vector<std::int32_t> replacement;
            replacement.reserve(count);
            for (std::size_t i = 0; i < count; ++i) {
                replacement.push_back(cpu_->guest_read_i32(args[4] + 4 * i));
            }
            auto& writable = arrays_.at(args[1]);
            for (std::size_t i = 0; i < count; ++i) {
                writable[first + i] = replacement[i];
            }
        }
        return 0; // JNI void return
    }
    throw GuestFault("Unimplemented JNI interface table function");
}
} // namespace ordax::mobile
