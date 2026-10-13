#include "ordax/mobile/elf_a64.hpp"
#include "ordax/mobile/jni_guest.hpp"

#include <array>
#include <cassert>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <span>
#include <string>
#include <vector>

namespace {
using ordax::mobile::CpuA64;
using ordax::mobile::GuestFault;
using ordax::mobile::JniGuestEnvironment;

void put16(std::vector<std::uint8_t>& b, std::size_t p, std::uint16_t value) {
    for (unsigned i = 0; i < 2; ++i) b[p + i] = static_cast<std::uint8_t>(value >> (i * 8));
}
void put32(std::vector<std::uint8_t>& b, std::size_t p, std::uint32_t value) {
    for (unsigned i = 0; i < 4; ++i) b[p + i] = static_cast<std::uint8_t>(value >> (i * 8));
}
void put64(std::vector<std::uint8_t>& b, std::size_t p, std::uint64_t value) {
    for (unsigned i = 0; i < 8; ++i) b[p + i] = static_cast<std::uint8_t>(value >> (i * 8));
}
std::vector<std::uint8_t> makeElf(std::span<const std::uint32_t> opcodes) {
    std::vector<std::uint8_t> b(0x100 + opcodes.size() * 4, 0);
    b[0] = 0x7f; b[1] = 'E'; b[2] = 'L'; b[3] = 'F';
    b[4] = 2; b[5] = 1; b[6] = 1;
    put16(b, 16, 2); put16(b, 18, 183); put32(b, 20, 1);
    put64(b, 24, 0x1000); put64(b, 32, 64);
    put16(b, 52, 64); put16(b, 54, 56); put16(b, 56, 1);
    put32(b, 64, 1); put32(b, 68, 5);
    put64(b, 72, 0x100); put64(b, 80, 0x1000);
    put64(b, 88, 0x1000);
    put64(b, 96, opcodes.size() * 4);
    put64(b, 104, opcodes.size() * 4);
    put64(b, 112, 0x1000);
    for (std::size_t i = 0; i < opcodes.size(); ++i) put32(b, 0x100 + i * 4, opcodes[i]);
    return b;
}
constexpr std::array<std::uint32_t, 8> kGetVersionPlusArg = {
    0x910003d3, // add x19,x30,#0: preserve original LR
    0x91000054, // add x20,x2,#0: preserve jint native argument
    0xf9400009, // ldr x9,[x0]: JNI function table pointer
    0xf9401129, // ldr x9,[x9,#32]: slot 4 GetVersion
    0xd63f0120, // blr x9: native guest -> JNI host gateway
    0x91000280, // add x0,x0,x20: JNI_VERSION_1_6 + jint arg
    0x9100027e, // add x30,x19,#0: restore original LR
    0xd65f03c0, // ret x30
};
constexpr std::array<std::uint32_t, 6> kGetArrayLength = {
    0x910003d3, 0xf9400009,
    0xf942ad29, // ldr x9,[x9,#1368] (slot 171 GetArrayLength)
    0xd63f0120, 0x9100027e, 0xd65f03c0,
};
constexpr std::array<std::uint32_t, 6> kExceptionCheck = {
    0x910003d3, 0xf9400009,
    0xf9439129, // ldr x9,[x9,#1824] (slot 228 ExceptionCheck)
    0xd63f0120, 0x9100027e, 0xd65f03c0,
};
template <class Fn> void reject(Fn&& run) {
    bool failed = false;
    try { run(); } catch (const GuestFault&) { failed = true; }
    assert(failed);
}
std::uint64_t runFixture(std::span<const std::uint32_t> code,
                         std::int32_t argument = 0, std::uint64_t array_handle = 0) {
    CpuA64 cpu(0x800000);
    const auto bytes = makeElf(code);
    const auto image = ordax::mobile::loadStaticElfA64(cpu, bytes);
    JniGuestEnvironment environment;
    environment.install(cpu);
    cpu.set_register(0, JniGuestEnvironment::kEnvAddress);
    cpu.set_register(1, array_handle ? array_handle : JniGuestEnvironment::kClassHandle);
    cpu.set_register(2, static_cast<std::uint64_t>(static_cast<std::int64_t>(argument)));
    return cpu.run(image.entry, 64);
}
}
int main(int argc, char** argv) {
    if (argc == 3 && std::string(argv[1]) == "--emit-jni-fixture") {
        const auto bytes = makeElf(kGetVersionPlusArg);
        std::ofstream out(argv[2], std::ios::binary | std::ios::trunc);
        return out.write(reinterpret_cast<const char*>(bytes.data()),
                         static_cast<std::streamsize>(bytes.size())).good() ? 0 : 3;
    }
    if (argc != 1) return 2;

    // Native ELF makes genuine AArch64 indirect calls via JNIEnv function table.
    assert(runFixture(kGetVersionPlusArg, 5) == 0x1000b);
    assert(runFixture(kGetVersionPlusArg, -5) == 0x10001);
    assert(runFixture(kExceptionCheck) == 0);

    {
        CpuA64 cpu(0x800000);
        const auto bytes = makeElf(kGetArrayLength);
        const auto loaded = ordax::mobile::loadStaticElfA64(cpu, bytes);
        JniGuestEnvironment env;
        env.install(cpu);
        const auto array = env.createIntArray(42);
        cpu.set_register(0, JniGuestEnvironment::kEnvAddress);
        cpu.set_register(1, array);
        assert(cpu.run(loaded.entry, 64) == 42);
    }
    reject([] { (void)runFixture(kGetArrayLength, 0, 0x30001234); });
    reject([] {
        CpuA64 cpu(0x800000);
        const auto bytes = makeElf(kGetVersionPlusArg);
        const auto loaded = ordax::mobile::loadStaticElfA64(cpu, bytes);
        JniGuestEnvironment env;
        env.install(cpu);
        cpu.set_register(0, JniGuestEnvironment::kEnvAddress + 8);
        (void)cpu.run(loaded.entry, 64);
    });
    reject([] {
        CpuA64 cpu(0x800000);
        const auto bytes = makeElf(kGetVersionPlusArg);
        const auto loaded = ordax::mobile::loadStaticElfA64(cpu, bytes);
        JniGuestEnvironment env;
        env.install(cpu);
        // After mapping guest JNIEnv, a host cannot overlap ELF/data regions.
        std::array<std::uint8_t, 8> replacement{};
        cpu.install_host_readonly(JniGuestEnvironment::kEnvAddress, replacement);
        (void)loaded;
    });
    reject([] {
        CpuA64 cpu(0x800000);
        const auto bytes = makeElf(kGetVersionPlusArg);
        const auto loaded = ordax::mobile::loadStaticElfA64(cpu, bytes);
        // JNI callback absent. Even with a forged trap address, dispatch is denied.
        cpu.set_register(9, CpuA64::kHostCallPrefix | 4);
        cpu.set_register(0, JniGuestEnvironment::kEnvAddress);
        (void)cpu.run(loaded.entry, 64);
    });
    reject([] {
        JniGuestEnvironment env;
        (void)env.createIntArray(-1);
    });
    reject([] {
        JniGuestEnvironment env;
        (void)env.createIntArray(65537);
    });
    std::cout << "JNI table GetVersion/GetArrayLength/ExceptionCheck ABI proof passed\n";
}
