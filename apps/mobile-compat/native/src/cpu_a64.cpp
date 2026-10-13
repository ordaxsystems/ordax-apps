#include "ordax/mobile/cpu_a64.hpp"

#include <algorithm>
#include <limits>

namespace ordax::mobile {
namespace {
constexpr std::uint64_t kReturnToHost = std::numeric_limits<std::uint64_t>::max();
constexpr std::size_t kMaximumMemory = 64u * 1024u * 1024u;
}

CpuA64::CpuA64(std::size_t memory_bytes) {
    if (memory_bytes < 4096 || memory_bytes > kMaximumMemory) {
        throw GuestFault("Invalid guest memory allocation");
    }
    memory_.resize(memory_bytes);
}
void CpuA64::assert_range(std::uint64_t address, std::size_t count) const {
    if (address > memory_.size() || count > memory_.size() - static_cast<std::size_t>(address)) {
        throw GuestFault("Guest memory access outside allocation");
    }
}
void CpuA64::load(std::uint64_t address, std::span<const std::uint8_t> bytes) {
    assert_range(address, bytes.size());
    std::copy(bytes.begin(), bytes.end(), memory_.begin() + static_cast<std::ptrdiff_t>(address));
}
std::uint32_t CpuA64::read32(std::uint64_t address) const {
    assert_range(address, 4);
    std::uint32_t value = 0;
    for (int shift = 0; shift < 32; shift += 8) {
        value |= std::uint32_t(memory_[static_cast<std::size_t>(address) + shift / 8]) << shift;
    }
    return value;
}
std::uint64_t CpuA64::read64(std::uint64_t address) const {
    assert_range(address, 8);
    std::uint64_t value = 0;
    for (int shift = 0; shift < 64; shift += 8) {
        value |= std::uint64_t(memory_[static_cast<std::size_t>(address) + shift / 8]) << shift;
    }
    return value;
}
void CpuA64::write64(std::uint64_t address, std::uint64_t value) {
    assert_range(address, 8);
    for (int shift = 0; shift < 64; shift += 8) {
        memory_[static_cast<std::size_t>(address) + shift / 8] = static_cast<std::uint8_t>(value >> shift);
    }
}
std::uint64_t CpuA64::reg(unsigned index) const {
    if (index > 31) throw GuestFault("Invalid register index");
    return index == 31 ? 0 : registers_[index];
}
void CpuA64::store_register(unsigned index, std::uint64_t value) {
    if (index > 31) throw GuestFault("Invalid register index");
    if (index != 31) registers_[index] = value;
}
void CpuA64::set_register(unsigned index, std::uint64_t value) {
    if (index >= 31) throw GuestFault("Only x0-x30 supported for host input");
    registers_[index] = value;
}
std::uint64_t CpuA64::run(std::uint64_t entry, std::uint64_t max_instructions) {
    if (!max_instructions || max_instructions > 1000000) {
        throw GuestFault("Invalid instruction budget");
    }
    if (entry % 4 != 0) throw GuestFault("Unaligned guest entry");
    registers_[30] = kReturnToHost;
    std::uint64_t pc = entry;
    for (std::uint64_t tick = 0; tick < max_instructions; ++tick) {
        if (pc % 4 != 0) throw GuestFault("Unaligned guest program counter");
        const std::uint32_t opcode = read32(pc);
        const unsigned rd = opcode & 31u;
        const unsigned rn = (opcode >> 5) & 31u;
        std::uint64_t next = pc + 4;
        if ((opcode & 0xff800000u) == 0xd2800000u) { // MOVZ Xd, #imm, LSL #shift
            const unsigned shift = ((opcode >> 21) & 3u) * 16u;
            store_register(rd, std::uint64_t((opcode >> 5) & 0xffffu) << shift);
        } else if ((opcode & 0xff800000u) == 0xf2800000u) { // MOVK Xd, #imm, LSL #shift
            const unsigned shift = ((opcode >> 21) & 3u) * 16u;
            const std::uint64_t mask = std::uint64_t(0xffffu) << shift;
            store_register(rd, (reg(rd) & ~mask) | (std::uint64_t((opcode >> 5) & 0xffffu) << shift));
        } else if ((opcode & 0x9f000000u) == 0x90000000u) { // ADRP Xd, PC-relative page
            const std::uint32_t imm = ((opcode >> 29) & 3u) |
                                      (((opcode >> 5) & 0x7ffffu) << 2);
            const std::int64_t pages = (imm & (1u << 20))
                ? std::int64_t(imm) - (1ll << 21) : std::int64_t(imm);
            const auto page = pc & ~std::uint64_t(4095);
            store_register(rd, page + static_cast<std::uint64_t>(pages * 4096));
        } else if ((opcode & 0xff000000u) == 0x91000000u ||
                   (opcode & 0xff000000u) == 0xd1000000u) { // ADD/SUB immediate
            if (rn == 31 || (opcode & 0x00800000u)) throw GuestFault("Unsupported stack/shift mode");
            const unsigned shift = (opcode >> 22) & 1u;
            const std::uint64_t immediate = std::uint64_t((opcode >> 10) & 0xfffu) << (shift ? 12u : 0u);
            const auto lhs = reg(rn);
            const auto result = (opcode & 0x40000000u) ? lhs - immediate : lhs + immediate;
            store_register(rd, result);
        } else if ((opcode & 0xffc00000u) == 0xf9000000u ||
                   (opcode & 0xffc00000u) == 0xf9400000u) { // STR/LDR Xt, [Xn, #imm]
            if (rn == 31) throw GuestFault("SP addressing not implemented");
            const std::uint64_t offset = std::uint64_t((opcode >> 10) & 0xfffu) * 8u;
            const std::uint64_t address = reg(rn) + offset;
            if ((opcode & 0x00400000u) != 0) store_register(rd, read64(address));
            else write64(address, reg(rd));
        } else if ((opcode & 0xfc000000u) == 0x14000000u) { // B immediate
            const std::int32_t field = static_cast<std::int32_t>(opcode & 0x03ffffffu);
            const std::int64_t signed_offset = (field & (1 << 25)) ? std::int64_t(field) - (1 << 26) : field;
            next = pc + static_cast<std::uint64_t>(signed_offset * 4);
        } else if ((opcode & 0xfffffc1fu) == 0xd65f0000u) { // RET Xn
            if (rn == 31) throw GuestFault("RET XZR invalid");
            next = reg(rn);
            if (next == kReturnToHost) return reg(0);
        } else if (opcode == 0xd503201fu) { // NOP
            // This is an actual architectural NOP.
        } else {
            throw GuestFault("Unsupported AArch64 instruction");
        }
        pc = next;
    }
    throw GuestFault("Guest instruction budget exhausted");
}
} // namespace ordax::mobile
