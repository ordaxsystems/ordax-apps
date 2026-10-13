#include "ordax/mobile/elf_a64.hpp"

#include <cassert>
#include <cstdint>
#include <iostream>
#include <vector>

using ordax::mobile::CpuA64;
using ordax::mobile::GuestFault;
using ordax::mobile::loadRelocatableElfA64;

namespace {
void put16(std::vector<std::uint8_t>& b, std::size_t p, std::uint16_t value) {
    for (unsigned i = 0; i < 2; i++) b[p + i] = static_cast<std::uint8_t>(value >> (8 * i));
}
void put32(std::vector<std::uint8_t>& b, std::size_t p, std::uint32_t value) {
    for (unsigned i = 0; i < 4; i++) b[p + i] = static_cast<std::uint8_t>(value >> (8 * i));
}
void put64(std::vector<std::uint8_t>& b, std::size_t p, std::uint64_t value) {
    for (unsigned i = 0; i < 8; i++) b[p + i] = static_cast<std::uint8_t>(value >> (8 * i));
}
std::vector<std::uint8_t> makePieImage() {
    std::vector<std::uint8_t> elf(0x400, 0);
    elf[0] = 0x7f; elf[1] = 'E'; elf[2] = 'L'; elf[3] = 'F';
    elf[4] = 2; elf[5] = 1; elf[6] = 1;
    put16(elf, 16, 3); put16(elf, 18, 183); put32(elf, 20, 1);
    put64(elf, 24, 0x1000); put64(elf, 32, 64);
    put16(elf, 52, 64); put16(elf, 54, 56); put16(elf, 56, 3);

    // Executable PT_LOAD at virtual address 0x1000 (host-selected bias 0x2000).
    put32(elf, 64, 1); put32(elf, 68, 5);
    put64(elf, 72, 0x200); put64(elf, 80, 0x1000);
    put64(elf, 96, 12); put64(elf, 104, 12);

    // Writable PT_LOAD: relocated pointer at vaddr=0x3000.
    put32(elf, 120, 1); put32(elf, 124, 6);
    put64(elf, 128, 0x300); put64(elf, 136, 0x3000);
    put64(elf, 152, 0x100); put64(elf, 160, 0x100);

    // Dynamic section contained inside the writable file-backed region.
    put32(elf, 176, 2); put32(elf, 180, 6);
    put64(elf, 184, 0x320); put64(elf, 192, 0x3020);
    put64(elf, 208, 64); put64(elf, 216, 64);

    // MOVZ X1,#0x5000; LDR X0,[X1]; RET X30.
    put32(elf, 0x200, 0xd2800001u | (0x5000u << 5));
    put32(elf, 0x204, 0xf9400020);
    put32(elf, 0x208, 0xd65f03c0);

    // Dynamic table: DT_RELA, DT_RELASZ, DT_RELAENT, DT_NULL.
    put64(elf, 0x320, 7); put64(elf, 0x328, 0x3080);
    put64(elf, 0x330, 8); put64(elf, 0x338, 24);
    put64(elf, 0x340, 9); put64(elf, 0x348, 24);
    // x350 and x358 already zero (terminator).

    // Elf64_Rela: r_offset=0x3000, R_AARCH64_RELATIVE=1027,
    // r_addend=0x1000. After bias 0x2000: guest[0x5000] == 0x3000.
    put64(elf, 0x380, 0x3000);
    put64(elf, 0x388, 1027);
    put64(elf, 0x390, 0x1000);
    return elf;
}
template <typename F> void mustReject(F&& fn) {
    bool rejected = false;
    try { fn(); } catch (const GuestFault&) { rejected = true; }
    assert(rejected);
}
}

int main() {
    auto elf = makePieImage();
    {
        CpuA64 cpu(0x10000);
        const auto loaded = loadRelocatableElfA64(cpu, elf, 0x2000);
        assert(loaded.entry == 0x3000);
        assert(loaded.load_bias == 0x2000);
        assert(loaded.relative_relocations == 1);
        assert(loaded.load_segments == 2);
        assert(loaded.has_entry);
        assert(cpu.run(loaded.entry, 10) == 0x3000);
    }
    {
        CpuA64 cpu(0x10000);
        mustReject([&] { (void)loadRelocatableElfA64(cpu, elf, 0x2001); });
        // An Android symbol dependency is not a "best effort" zero pointer.
        put64(elf, 0x320, 1); // DT_NEEDED
        mustReject([&] { (void)loadRelocatableElfA64(cpu, elf, 0x2000); });
        put64(elf, 0x320, 7);
        // Symbol-bearing relocation requires real Android symbol resolution.
        put64(elf, 0x388, (std::uint64_t(1) << 32) | 1027u);
        mustReject([&] { (void)loadRelocatableElfA64(cpu, elf, 0x2000); });
        put64(elf, 0x388, 1027);
        // Writable-only relocation target.
        put64(elf, 0x380, 0x1000);
        mustReject([&] { (void)loadRelocatableElfA64(cpu, elf, 0x2000); });
        put64(elf, 0x380, 0x3000);
        // Rejected dynamic interpreter dependency.
        put32(elf, 176, 3); // PT_INTERP
        mustReject([&] { (void)loadRelocatableElfA64(cpu, elf, 0x2000); });
        put32(elf, 176, 2);
        // Reject out-of-range table metadata before mapping.
        put64(elf, 0x328, 0xffffffffffffffffull);
        mustReject([&] { (void)loadRelocatableElfA64(cpu, elf, 0x2000); });
    }
    std::cout << "ET_DYN AArch64 RELATIVE-only guest execution passed\n";
}
