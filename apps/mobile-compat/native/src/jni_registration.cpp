#include "ordax/mobile/jni_guest.hpp"
#include "ordax/mobile/elf_a64.hpp"

#include <algorithm>
#include <utility>

namespace ordax::mobile {
namespace {
bool validName(const std::string& text, bool allow_slash) {
    if (text.empty() || text.size() > 96 ||
        text.front() == '/' || text.back() == '/') return false;
    for (char c : text) {
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
            (c >= '0' && c <= '9') || c == '_' || c == '$') continue;
        if (allow_slash && c == '/') continue;
        return false;
    }
    return !allow_slash || text.find("//") == std::string::npos;
}
bool validMethod(const JniDeclaredMethod& m) {
    return validName(m.name, false) &&
        (m.signature == "()I" || m.signature == "()V" ||
         m.signature == "(I)I" || m.signature == "([I)I" ||
         m.signature == "()[I");
}
std::string readAscii(CpuA64& cpu, std::uint64_t at, std::size_t cap) {
    if (!at || at >= cpu.memory_size()) throw GuestFault("Invalid JNI string pointer");
    std::string result;
    for (std::size_t i = 0; i <= cap; ++i) {
        if (i >= cpu.memory_size() - at) throw GuestFault("Truncated JNI string");
        const auto c = cpu.guest_read_u8(at + i);
        if (!c) {
            if (result.empty()) throw GuestFault("Empty JNI string");
            return result;
        }
        if (i == cap || c < 33 || c > 126) {
            throw GuestFault("Non-ASCII or unterminated JNI string");
        }
        result.push_back(static_cast<char>(c));
    }
    throw GuestFault("Overlong JNI string");
}
bool ownExecutable(const LoadedGuestElf& image, std::uint64_t pc) {
    return pc % 4 == 0 && std::any_of(
        image.executable_regions.begin(), image.executable_regions.end(),
        [pc](const GuestRegion& r) {
            return (r.permissions & 1u) && pc >= r.address &&
                   pc - r.address < r.length &&
                   4 <= r.length - (pc - r.address);
        });
}
}

void JniGuestEnvironment::declareNativeClass(
    std::string owner, std::span<const JniDeclaredMethod> methods) {
    if (cpu_ || !declared_owner_.empty() || !validName(owner, true) ||
        methods.empty() || methods.size() > 16) {
        throw GuestFault("JNI class declaration must come from trusted DEX owner");
    }
    std::vector<JniDeclaredMethod> checked;
    for (const auto& m : methods) {
        if (!validMethod(m) ||
            std::any_of(checked.begin(), checked.end(), [&](const auto& v) {
                return m.name == v.name && m.signature == v.signature;
            })) {
            throw GuestFault("Unsupported or duplicate JNI DEX declaration");
        }
        checked.push_back(m);
    }
    declared_owner_ = std::move(owner);
    declared_methods_ = std::move(checked);
}

std::uint64_t JniGuestEnvironment::dispatchRegistration(
    std::uint64_t target, const std::array<std::uint64_t, 8>& args) {
    if (!cpu_ || !registering_image_ || !registration_getenv_succeeded_ ||
        declared_owner_.empty()) {
        throw GuestFault("JNI class operations require authorized JNI_OnLoad");
    }
    if (target == (CpuA64::kHostCallPrefix | kFindClassIndex)) {
        if (readAscii(*cpu_, args[1], 96) != declared_owner_) {
            throw GuestFault("JNI FindClass is not a verified DEX class");
        }
        return kClassHandle;
    }
    if (target != (CpuA64::kHostCallPrefix | kRegisterNativesIndex) ||
        args[1] != kClassHandle || !args[2] || args[2] % 8 ||
        !args[3] || args[3] > 16 || args[3] > declared_methods_.size()) {
        throw GuestFault("Invalid JNI RegisterNatives class, table or count");
    }
    const auto count = static_cast<std::size_t>(args[3]);
    cpu_->require_guest_access(args[2], count * 24, 4);
    std::vector<JniRegisteredMethod> staged;
    for (std::size_t i = 0; i < count; ++i) {
        const auto slot = args[2] + i * 24;
        const auto name = readAscii(*cpu_, cpu_->guest_read_u64(slot), 96);
        const auto signature = readAscii(*cpu_, cpu_->guest_read_u64(slot + 8), 32);
        const auto function = cpu_->guest_read_u64(slot + 16);
        const auto permitted = std::any_of(
            declared_methods_.begin(), declared_methods_.end(), [&](const auto& d) {
                return d.name == name && d.signature == signature;
            });
        if (!permitted || !ownExecutable(*registering_image_, function)) {
            throw GuestFault("JNI native method is not authorized by DEX or ELF");
        }
        cpu_->require_guest_access(function, 4, 1);
        const auto same = [&](const auto& v) {
            return v.owner == declared_owner_ && v.name == name &&
                   v.signature == signature;
        };
        if (std::any_of(staged.begin(), staged.end(), same) ||
            std::any_of(registered_methods_.begin(), registered_methods_.end(), same)) {
            throw GuestFault("Duplicate JNI native binding");
        }
        staged.push_back({declared_owner_, name, signature, function});
    }
    registered_methods_.insert(
        registered_methods_.end(), staged.begin(), staged.end());
    return 0; // JNI_OK, only after full table validation.
}
} // namespace ordax::mobile
