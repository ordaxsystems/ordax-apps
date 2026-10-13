#include "ordax/mobile/elf_a64.hpp"

#include <cassert>
#include <cstdint>
#include <iostream>
#include <fstream>
#include <string>
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

    // ADRP X1, PC+2 pages; LDR X0,[X1]; RET X30.
    // Position independent: vaddr 0x1000 -> vaddr 0x3000 at any guest bias.
    put32(elf, 0x200, 0xd0000001u);
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

std::vector<std::uint8_t> relrFixture(bool android) {
    auto elf = makePieImage();
    // Two implicit-addend relocations: direct 0x3000 and bitmap bit#2 0x3010.
    // Both point to code virtual address 0x1000 before bias is applied.
    put64(elf, 0x300, 0x1000);
    put64(elf, 0x310, 0x1000);
    put64(elf, 0x320, android ? 0x6fffe000 : 36);
    put64(elf, 0x328, 0x30a0);
    put64(elf, 0x330, android ? 0x6fffe001 : 35);
    put64(elf, 0x338, 16);
    put64(elf, 0x340, android ? 0x6fffe003 : 37);
    put64(elf, 0x348, 8);
    put64(elf, 0x350, 0); put64(elf, 0x358, 0);
    put64(elf, 0x3a0, 0x3000);
    put64(elf, 0x3a8, 5); // bit[2] relocates 0x3010 (base + 8)
    return elf;
}
std::vector<std::uint8_t> relaPlusRelrFixture() {
    auto elf = makePieImage();
    put64(elf, 208, 112); put64(elf, 216, 112);
    // RELA at 0x30b0, RELR at 0x30d0, dynamic tags fit 0x320..0x38f.
    put64(elf, 0x328, 0x30b0); // DT_RELA
    put64(elf, 0x338, 24); // DT_RELASZ
    put64(elf, 0x348, 24); // DT_RELAENT
    put64(elf, 0x350, 36); put64(elf, 0x358, 0x30d0);
    put64(elf, 0x360, 35); put64(elf, 0x368, 8);
    put64(elf, 0x370, 37); put64(elf, 0x378, 8);
    put64(elf, 0x380, 0); put64(elf, 0x388, 0); // DT_NULL
    put64(elf, 0x3b0, 0x3000); // R_AARCH64_RELATIVE (explicit addend)
    put64(elf, 0x3b8, 1027);
    put64(elf, 0x3c0, 0x1000);
    put64(elf, 0x3d0, 0x3010); // RELR direct, implicit addend
    put64(elf, 0x310, 0x1000);
    return elf;
}
template <typename F> void mustReject(F&& fn) {
    bool rejected = false;
    try { fn(); } catch (const GuestFault&) { rejected = true; }
    assert(rejected);
}
}

int main(int argc, char** argv) {
    if (argc == 3 && std::string(argv[1]) == "--emit-fixture") {
        const auto bytes = makePieImage();
        std::ofstream out(argv[2], std::ios::binary | std::ios::trunc);
        if (!out.write(reinterpret_cast<const char*>(bytes.data()),
                       static_cast<std::streamsize>(bytes.size()))) return 3;
        return 0;
    }
    if (argc != 1) return 2;
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
        // The SAME instruction bytes and relocation table must work under
        // a different guest load bias, without patching the source image.
        CpuA64 cpu(0x800000);
        const auto loaded = loadRelocatableElfA64(cpu, elf, 0x400000);
        assert(loaded.entry == 0x401000);
        assert(cpu.run(loaded.entry, 10) == 0x401000);
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
    // Guest STR cannot mutate the executable RX mapping.
    {
        auto guest = makePieImage();
        put32(guest, 0x200, 0x90000001u); // ADRP X1, current executable page
        put32(guest, 0x204, 0xf9000020u); // STR X0, [X1]
        CpuA64 cpu(0x10000);
        const auto image = loadRelocatableElfA64(cpu, guest, 0x2000);
        mustReject([&] { (void)cpu.run(image.entry, 10); });
    }
    // Branch into non-executable RW data must fail before fetching instructions.
    {
        auto guest = makePieImage();
        put32(guest, 0x200, 0x14000800u); // B from code page to data page
        CpuA64 cpu(0x10000);
        const auto image = loadRelocatableElfA64(cpu, guest, 0x2000);
        mustReject([&] { (void)cpu.run(image.entry, 10); });
    }

    // Both standardized ELF RELR and Android legacy tags encode the same
    // absolute + 63-bit bitmap instruction stream. Relocations are applied
    // only after validating every target, addend and writable mapping.
    for (const bool android : {false, true}) {
        const auto relr = relrFixture(android);
        for (const auto bias : {std::uint64_t(0x2000), std::uint64_t(0x400000)}) {
            CpuA64 cpu(0x800000);
            const auto image = loadRelocatableElfA64(cpu, relr, bias);
            assert(image.relative_relocations == 2);
            assert(cpu.run(image.entry, 10) == bias + 0x1000);
            assert(cpu.guest_read_i32(bias + 0x3010) == bias + 0x1000);
        }
        if (android) {
            auto legacy = relr;
            // Bionic permits a count hint, which its linker ignores.
            put64(legacy, 208, 80); put64(legacy, 216, 80);
            put64(legacy, 0x350, 0x6fffe005); // DT_ANDROID_RELRCOUNT
            put64(legacy, 0x358, 2);
            CpuA64 cpu(0x10000);
            const auto image = loadRelocatableElfA64(cpu, legacy, 0x2000);
            assert(image.relative_relocations == 2);
            assert(cpu.guest_read_i32(0x5010) == 0x3000);
        }
        // Corrupted RELR metadata/bitmaps must never be silently ignored.
        {
            auto bad = relr;
            put64(bad, 0x3a0, 1); // bitmap cannot precede anchor
            CpuA64 cpu(0x10000);
            mustReject([&] { (void)loadRelocatableElfA64(cpu, bad, 0x2000); });
        }
        {
            auto bad = relr;
            put64(bad, 0x3a8, 0x3000); // duplicate direct relocation
            CpuA64 cpu(0x10000);
            mustReject([&] { (void)loadRelocatableElfA64(cpu, bad, 0x2000); });
        }
        {
            auto bad = relr;
            put64(bad, 0x3a0, 0x1000); // RX mapping, cannot relocate
            CpuA64 cpu(0x10000);
            mustReject([&] { (void)loadRelocatableElfA64(cpu, bad, 0x2000); });
        }
        {
            auto bad = relr;
            put64(bad, 0x338, 0xffffffffull); // unbounded table
            CpuA64 cpu(0x10000);
            mustReject([&] { (void)loadRelocatableElfA64(cpu, bad, 0x2000); });
        }
        {
            auto bad = relr;
            put64(bad, 0x348, 4); // bad RELRENT
            CpuA64 cpu(0x10000);
            mustReject([&] { (void)loadRelocatableElfA64(cpu, bad, 0x2000); });
        }
        {
            auto bad = relr;
            put64(bad, 0x310, 0x9000); // implicit pointer escapes image
            CpuA64 cpu(0x10000);
            mustReject([&] { (void)loadRelocatableElfA64(cpu, bad, 0x2000); });
        }
        {
            auto bad = relr;
            put64(bad, 0x330, android ? 35 : 0x6fffe001); // mixed tag families
            CpuA64 cpu(0x10000);
            mustReject([&] { (void)loadRelocatableElfA64(cpu, bad, 0x2000); });
        }
        {
            auto bad = relr;
            put64(bad, 0x330, 0); // no size metadata -> malformed
            CpuA64 cpu(0x10000);
            mustReject([&] { (void)loadRelocatableElfA64(cpu, bad, 0x2000); });
        }
    }
    {
        const auto elf = relaPlusRelrFixture();
        CpuA64 cpu(0x10000);
        const auto image = loadRelocatableElfA64(cpu, elf, 0x2000);
        assert(image.relative_relocations == 2);
        assert(cpu.guest_read_i32(0x5000) == 0x3000);
        assert(cpu.guest_read_i32(0x5010) == 0x3000);
    }
    {
        auto elf = relaPlusRelrFixture();
        put64(elf, 0x3d0, 0x3000); // RELR collides with RELA patch
        CpuA64 cpu(0x10000);
        mustReject([&] { (void)loadRelocatableElfA64(cpu, elf, 0x2000); });
    }
    std::cout << "ET_DYN AArch64 RELATIVE-only guest execution passed\n";
}
