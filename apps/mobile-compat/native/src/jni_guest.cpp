#include "ordax/mobile/jni_guest.hpp"
#include "ordax/mobile/elf_a64.hpp"

#include <array>
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <vector>

namespace ordax::mobile {
namespace {
constexpr std::size_t kTableSlots = JniGuestEnvironment::kExceptionCheckIndex + 1;
constexpr std::size_t kTableBytes = kTableSlots * 8;
constexpr std::size_t kVmTableBytes = 8 * 8;
constexpr std::uint64_t kVmGetEnvTrap = CpuA64::kHostCallPrefix | 0x106;
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
    if (cpu.memory_size() < kVmTableAddress + kVmTableBytes ||
        cpu.memory_size() < kTableAddress + kTableBytes) {
        throw GuestFault("JNI environment requires larger guest memory");
    }
    std::array<std::uint8_t, 8> env{};
    store64(env, 0, kTableAddress);
    std::array<std::uint8_t, kTableBytes> table{};
    store64(table, kGetVersionIndex * 8, trap(kGetVersionIndex));
    store64(table, kFindClassIndex * 8, trap(kFindClassIndex));
    store64(table, kRegisterNativesIndex * 8, trap(kRegisterNativesIndex));
    store64(table, kGetArrayLengthIndex * 8, trap(kGetArrayLengthIndex));
    store64(table, kNewIntArrayIndex * 8, trap(kNewIntArrayIndex));
    store64(table, kGetIntArrayRegionIndex * 8, trap(kGetIntArrayRegionIndex));
    store64(table, kSetIntArrayRegionIndex * 8, trap(kSetIntArrayRegionIndex));
    store64(table, kExceptionCheckIndex * 8, trap(kExceptionCheckIndex));
    // The CPU enforces that these pages do not overlap guest PT_LOAD and
    // remain read-only after installation. All unsupported slots remain NULL.
    cpu.install_host_readonly(kEnvAddress, env);
    cpu.install_host_readonly(kTableAddress, table);
    std::array<std::uint8_t, 8> vm{};
    store64(vm, 0, kVmTableAddress);
    std::array<std::uint8_t, kVmTableBytes> vm_table{};
    store64(vm_table, kVmGetEnvIndex * 8, kVmGetEnvTrap);
    cpu.install_host_readonly(kVmAddress, vm);
    cpu.install_host_readonly(kVmTableAddress, vm_table);
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
    if (!cpu_) throw GuestFault("Uninstalled JNI/JavaVM host function table");
    if (target == kVmGetEnvTrap) {
        if (args[0] != kVmAddress) throw GuestFault("Forged JavaVM pointer");
        // JNI_GetEnv returns JNI_EVERSION for unsupported versions. It must
        // not overwrite the caller's pointer on failure.
        if (args[2] != kVersion) return kErrVersion;
        if (args[1] == 0 || args[1] % 8) {
            throw GuestFault("JavaVM GetEnv output pointer invalid");
        }
        cpu_->guest_write_u64(args[1], kEnvAddress);
        if (registering_image_) registration_getenv_succeeded_ = true;
        return 0; // JNI_OK
    }
    if (args[0] != kEnvAddress) {
        throw GuestFault("JNI call has incorrect JNIEnv pointer");
    }
    if (target == trap(kFindClassIndex) || target == trap(kRegisterNativesIndex)) {
        return dispatchRegistration(target, args);
    }
    if (target == trap(kGetVersionIndex)) return kVersion;
    if (target == trap(kExceptionCheckIndex)) return 0;
    if (target == trap(kNewIntArrayIndex)) {
        if (args[1] > 65536) throw GuestFault("JNI NewIntArray length outside bounded subset");
        return createIntArray(static_cast<std::int32_t>(args[1]));
    }
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

std::uint32_t JniGuestEnvironment::runOnLoad(
    CpuA64& cpu, LoadedGuestElf& image,
    std::span<const std::uint8_t> elf, const std::string& soname,
    std::uint64_t instruction_budget) {
    if (cpu_ != &cpu || !image.initializers_started ||
        image.jni_onload_started || !instruction_budget ||
        instruction_budget > 1000000) {
        throw GuestFault("JNI_OnLoad requires initialized library and installed JavaVM");
    }
    // Source of truth: the same ELF dynsym/DT_SONAME parser used by DT_NEEDED.
    const auto exports = inspectGuestDynamicExports(elf, image.load_bias, soname);
    std::uint64_t onload = 0;
    for (const auto& entry : exports) {
        if (entry.symbol == "JNI_OnLoad") {
            if (onload) throw GuestFault("Duplicate ELF JNI_OnLoad export");
            onload = entry.address;
        }
    }
    if (!onload || onload % 4) throw GuestFault("Guest JNI_OnLoad not exported");
    const auto owned = std::any_of(
        image.executable_regions.begin(), image.executable_regions.end(),
        [&](const auto& region) {
            return (region.permissions & 1u) &&
                   onload >= region.address &&
                   onload - region.address <= region.length &&
                   4 <= region.length - (onload - region.address);
        });
    if (!owned) throw GuestFault("JNI_OnLoad export not part of loaded guest ELF");
    cpu.require_guest_access(onload, 4, 1);
    // The guest call can have side effects. Failure leaves lifecycle terminal;
    // retrying a partially executed JNI_OnLoad is never safe.
    image.jni_onload_started = true;
    const auto previous = registered_methods_;
    registering_image_ = &image;
    registration_getenv_succeeded_ = false;
    try {
        for (unsigned i = 0; i < 8; ++i) cpu.set_register(i, 0);
        cpu.set_register(0, kVmAddress);
        cpu.set_register(1, 0); // reserved must be NULL
        const auto raw_version = cpu.run(onload, instruction_budget);
        if (raw_version != kVersion) {
            throw GuestFault("JNI_OnLoad returned unsupported JNI version");
        }
        registering_image_ = nullptr;
        registration_getenv_succeeded_ = false;
        return static_cast<std::uint32_t>(raw_version);
    } catch (...) {
        registering_image_ = nullptr;
        registration_getenv_succeeded_ = false;
        registered_methods_ = previous;
        throw;
    }
}

} // namespace ordax::mobile
