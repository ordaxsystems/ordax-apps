#include "ordax/mobile/cpu_a64.hpp"

#include <array>
#include <cassert>
#include <cstdint>
#include <iostream>

using ordax::mobile::CpuA64;
using ordax::mobile::GuestFault;

static void encode(std::array<std::uint8_t, 32>& code, std::size_t slot, std::uint32_t ins) {
    for (unsigned j = 0; j < 4; ++j) code[slot * 4 + j] = static_cast<std::uint8_t>(ins >> (j * 8));
}
template <typename F> static void must_fault(F&& fn) {
    bool thrown = false;
    try { fn(); } catch (const GuestFault&) { thrown = true; }
    assert(thrown);
}
int main() {
    // Return 42 from actual decoded MOVZ/ADD/RET instructions.
    {
        CpuA64 cpu(4096);
        std::array<std::uint8_t, 32> code{};
        encode(code, 0, 0xd2800000u | (40u << 5)); // movz x0,#40
        encode(code, 1, 0x91000000u | (2u << 10)); // add x0,x0,#2
        encode(code, 2, 0xd65f03c0u); // ret x30
        cpu.load(0, code);
        assert(cpu.run(0, 20) == 42);
    }
    // Store/load a 64-bit value in a guest allocation, never a host pointer.
    {
        CpuA64 cpu(4096);
        std::array<std::uint8_t, 32> code{};
        encode(code, 0, 0xd2800000u | (42u << 5)); // movz x0,#42
        encode(code, 1, 0xd2800001u | (256u << 5)); // movz x1,#256
        encode(code, 2, 0xf9000020u); // str x0,[x1]
        encode(code, 3, 0xd2800000u); // movz x0,#0
        encode(code, 4, 0xf9400020u); // ldr x0,[x1]
        encode(code, 5, 0xd65f03c0u); // ret
        cpu.load(0, code);
        assert(cpu.run(0, 20) == 42);
    }
    // Branch loop MUST stop on instruction budget (no hang).
    {
        CpuA64 cpu(4096);
        std::array<std::uint8_t, 4> code{0, 0, 0, 0x14}; // b .
        cpu.load(0, code);
        must_fault([&] { (void)cpu.run(0, 8); });
    }
    // Unknown instructions and out-of-bounds access fail closed.
    {
        CpuA64 cpu(4096);
        std::array<std::uint8_t, 4> code{0xff, 0xff, 0xff, 0xff};
        cpu.load(0, code);
        must_fault([&] { (void)cpu.run(0, 8); });
        must_fault([&] { cpu.load(4094, code); });
        must_fault([&] { (void)cpu.run(4096, 8); });
    }
    std::cout << "AArch64 bounded instruction proof passed\n";
}
